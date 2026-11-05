/**
 * @vitest-environment node
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = (name: string) => readFileSync(path.resolve("drizzle/migrations", name), "utf8");

async function fresh() {
  const db = new PGlite();
  await db.exec("CREATE ROLE service_role;");
  await db.exec(migration("0000_bookings_and_events.sql"));
  await db.exec(migration("0001_booking_worker_signals.sql"));
  return db;
}

function ins(
  id: string,
  status: string,
  expires = "now() + interval '2 hours'",
  centre = "Tallaght",
  created = "now()",
) {
  return `INSERT INTO bookings (id, phone, test_centre, test_date, test_time, status, expires_at, created_at)
    VALUES ('${id}', '+353800000000', '${centre}', '2026-11-10', '10:30', '${status}', ${expires}, ${created})`;
}

describe("0002 active slot migration on Postgres", () => {
  it("releases every active duplicate except the earliest, then creates the index", async () => {
    const db = await fresh();
    await db.exec(ins("A1", "pending", undefined, "Tallaght", "'2026-11-01T00:00:00Z'"));
    await db.exec(ins("A2", "pending", undefined, " tallaght ", "'2026-11-02T00:00:00Z'"));

    await db.exec(migration("0002_active_slot_unique.sql"));

    const rows = await db.query<{ id: string; status: string; test_centre: string }>(
      "SELECT id, status, test_centre FROM bookings ORDER BY id",
    );
    expect(rows.rows).toEqual([
      { id: "A1", status: "pending", test_centre: "Tallaght" },
      { id: "A2", status: "released", test_centre: " tallaght " },
    ]);
    expect(rows.rows.find((row) => row.id === "A2")?.status).toBe("released");
  });

  it("enforces one active booking, a status check, and idempotent re-runs", async () => {
    const db = await fresh();
    await db.exec(migration("0002_active_slot_unique.sql"));
    await db.exec(migration("0002_active_slot_unique.sql"));

    await db.exec(ins("B1", "pending"));
    await expect(db.exec(ins("B2", "pending"))).rejects.toThrow(/duplicate key|unique/i);
    await expect(db.exec(ins("B3", "paid"))).rejects.toThrow(/duplicate key|unique/i);
    await db.exec(ins("B4", "expired"));
    await db.exec(ins("B5", "released"));
    await expect(db.exec(ins("B6", "pending", undefined, "tallaght"))).rejects.toThrow(
      /duplicate key|unique/i,
    );
    await expect(db.exec(ins("B7", "pending", undefined, "  TALLAGHT  "))).rejects.toThrow(
      /duplicate key|unique/i,
    );
    await db.exec(ins("B8", "pending", undefined, "Tallaght Test Centre"));
    await expect(db.exec(ins("D1", "Pending"))).rejects.toThrow(/check|bookings_status_check/i);
    await expect(db.exec(ins("D2", "cancelled"))).rejects.toThrow(/check|bookings_status_check/i);

    await db.exec(ins("C1", "pending", "now() - interval '1 minute'", "Finglas"));
    await expect(db.exec(ins("C2", "pending", undefined, "Finglas"))).rejects.toThrow(
      /duplicate key|unique/i,
    );
    const paid = await db.query<{ id: string }>(
      "UPDATE bookings SET status = 'paid', paid_at = now() WHERE id = 'C1' AND status = 'pending' AND expires_at > now() RETURNING id",
    );
    expect(paid.rows).toHaveLength(0);
    await db.exec(
      "UPDATE bookings SET status = 'expired', released_at = now() WHERE status = 'pending' AND expires_at < now()",
    );
    await db.exec(ins("C3", "pending", undefined, "Finglas"));
    await expect(db.exec("UPDATE bookings SET status = 'pending' WHERE id = 'B4'")).rejects.toThrow(
      /duplicate key|unique/i,
    );

    await db.exec(
      "INSERT INTO bot_events (source, event, delivery_id, payload) VALUES ('worker', 'X', 'e1', '{}')",
    );
    await expect(
      db.exec(
        "INSERT INTO bot_events (source, event, delivery_id, payload) VALUES ('worker', 'X', 'e1', '{}')",
      ),
    ).rejects.toThrow(/duplicate key|unique/i);

    const index = await db.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'bookings_active_slot_uidx'",
    );
    expect(index.rows[0]?.indexdef).toContain("UNIQUE INDEX");
    expect(index.rows[0]?.indexdef.toLowerCase()).toContain("pending");
  });

  it("keeps a paid booking, a live hold, and the lowest id on a timestamp tie", async () => {
    const db = await fresh();
    const tie = "'2026-11-01T10:00:00Z'";
    await db.exec(ins("TIE_B", "pending", undefined, "Tallaght", tie));
    await db.exec(ins("TIE_A", "pending", undefined, " tallaght ", tie));
    await db.exec(ins("TIE_C", "pending", undefined, "TALLAGHT", tie));
    await db.exec(ins("F1_PEND", "pending", undefined, "Finglas", "'2026-11-01T09:00:00Z'"));
    await db.exec(ins("F2_PAID", "paid", undefined, "finglas", "'2026-11-01T09:30:00Z'"));
    await db.exec(
      ins("R1_LAPSED", "pending", "now() - interval '1 hour'", "Raheny", "'2026-11-01T08:00:00Z'"),
    );
    await db.exec(ins("R2_LIVE", "pending", undefined, "Raheny  ", "'2026-11-01T08:30:00Z'"));
    await db.exec(ins("L3", "cancelled", undefined, "Naas"));

    await db.exec(migration("0002_active_slot_unique.sql"));

    const rows = await db.query<{ id: string; status: string; test_centre: string }>(
      "SELECT id, status, test_centre FROM bookings ORDER BY id",
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row]));
    expect(byId["TIE_A"]?.status).toBe("pending");
    expect(byId["TIE_A"]?.test_centre).toBe(" tallaght ");
    expect(byId["TIE_B"]?.status).toBe("released");
    expect(byId["TIE_C"]?.status).toBe("released");
    expect(byId["F2_PAID"]).toMatchObject({ status: "paid", test_centre: "finglas" });
    expect(byId["F1_PEND"]?.status).toBe("released");
    expect(byId["R1_LAPSED"]?.status).toBe("expired");
    expect(byId["R2_LIVE"]).toMatchObject({ status: "pending", test_centre: "Raheny  " });
    expect(byId["L3"]?.status).toBe("released");

    await db.exec(migration("0002_active_slot_unique.sql"));
    await db.exec(ins("N2", "pending", undefined, "tallaght test"));
    await db.exec(
      "INSERT INTO bookings (id, phone, test_centre, test_date, test_time, status) VALUES ('N1', '+353800000000', 'Tallaght' || chr(160) || 'Test', '2026-11-11', '09:00', 'pending')",
    );
    await expect(
      db.exec(
        "INSERT INTO bookings (id, phone, test_centre, test_date, test_time, status) VALUES ('N3', '+353800000000', 'tallaght test', '2026-11-11', '09:00', 'pending')",
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
