// QA v2 attack suite for slotsniperie PR #1 @ d7db296. Local only; not committed or pushed.
// Copy into src/test/ of a local clone and run `bunx vitest run src/test/zz-v2-attacks.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hmacHex } from "@/lib/hmac";
import { createFakeSupabase, type FakeSupabase } from "./fake-supabase";
import {
  freshTimestamp,
  lockedEvent,
  signedBotEventRequest,
  TEST_WEBHOOK_SECRET,
} from "./sign-bot-event";

type QueryBuilder = {
  then: (
    onFulfilled: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
  maybeSingle: () => Promise<unknown>;
};
type Hook = (table: string, builder: QueryBuilder) => QueryBuilder;
const state = vi.hoisted(() => ({
  fake: null as FakeSupabase | null,
  hook: null as null | Hook,
}));
const sendWhatsAppText = vi.hoisted(() => vi.fn(async (_t: string, _b: string) => "wamid.test"));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return {
      from: (t: string) => {
        const b = state.fake!.admin.from(t as "bookings" | "bot_events");
        return state.hook ? state.hook(t, b) : b;
      },
    };
  },
}));
vi.mock("@/lib/whatsapp.server", () => ({ sendWhatsAppText }));
import { CLAIM_STALE_MS, handleBotEvent } from "@/lib/bot-event.server";
import { markBookingPaid } from "@/lib/worker.server";

state.fake = createFakeSupabase();
const fake = () => state.fake as FakeSupabase;
beforeEach(() => {
  fake().reset();
  state.hook = null;
  sendWhatsAppText.mockReset();
  sendWhatsAppText.mockResolvedValue("wamid.test");
  process.env["BOT_WEBHOOK_SECRET"] = TEST_WEBHOOK_SECRET;
  process.env["PUBLIC_SITE_URL"] = "https://slotsniper.test";
});
const send = async (ev: Record<string, unknown>) => handleBotEvent(await signedBotEventRequest(ev));
const body = async (r: Response) => ({ status: r.status, ...(await r.json()) });
const age = (id: string, ms: number) => {
  const row = fake()
    .events()
    .find((e) => e.delivery_id === id)!;
  row.received_at = new Date(Date.now() - ms).toISOString();
};
/** Make the n-th call on `table` (0-based) wait for the returned release(). */
function gateCall(table: string, n = 0) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let seen = 0;
  const hook: Hook = (t, b) => {
    if (t !== table) return b;
    if (seen++ !== n) return b;
    const realThen = b.then.bind(b);
    const realMaybe = b.maybeSingle.bind(b);
    b.then = (onFulfilled, onRejected) => gate.then(() => realThen(onFulfilled, onRejected));
    b.maybeSingle = () => gate.then(() => realMaybe());
    return b;
  };
  state.hook = hook;
  return () => release();
}

describe("A. concurrent identical events", () => {
  it("2 parallel identical deliveries => exactly one hold, one WhatsApp, loser 425 (not ok)", async () => {
    let go!: () => void;
    const gate = new Promise<void>((r) => (go = r));
    sendWhatsAppText.mockImplementation(async () => {
      await gate;
      return "wamid";
    });
    const raw = lockedEvent({ event_id: "cc1" });
    let finished = 0;
    const run = async () => {
      const response = await send(raw);
      finished += 1;
      return response;
    };
    const pa = run();
    const pb = run();
    await vi.waitFor(() => {
      expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
      expect(finished).toBe(1);
    });
    go();
    const [a, b] = await Promise.all([pa, pb]).then((rs) => Promise.all(rs.map(body)));
    expect(fake().bookings()).toHaveLength(1);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect([a.status, b.status].sort()).toEqual([200, 425]);
    const loser = a.status === 425 ? a : b;
    expect(loser.ok).toBe(false);
  });
  it("10 parallel, different event_ids, same slot => one hold", async () => {
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        send(lockedEvent({ event_id: "cs" + i, phone: "+3538600000" + (10 + i) })),
      ),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      fake()
        .bookings()
        .filter((b) => b.status === "pending"),
    ).toHaveLength(1);
  });
});

describe("B. stale-claim takeover race", () => {
  it("two concurrent retries on a >60s stale claim: only one dispatches", async () => {
    await fake()
      .admin.from("bot_events")
      .insert({
        source: "worker",
        event: "SLOT_LOCKED",
        delivery_id: "st1",
        payload: { event: {} },
      });
    age("st1", CLAIM_STALE_MS + 1_000);
    let go!: () => void;
    const gate = new Promise<void>((r) => (go = r));
    sendWhatsAppText.mockImplementation(async () => {
      await gate;
      return "wamid";
    });
    const ev = lockedEvent({ event_id: "st1" });
    let finished = 0;
    const run = async () => {
      const response = await send(ev);
      finished += 1;
      return response;
    };
    const p1 = run();
    const p2 = run();
    await vi.waitFor(() => {
      expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
      expect(finished).toBe(1);
    });
    go();
    const rs = await Promise.all([p1, p2]).then((x) => Promise.all(x.map(body)));
    console.log(
      "[v2] takeover race statuses",
      rs.map((r) => r.status),
    );
    expect(fake().bookings()).toHaveLength(1);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 425]);
  });
  it("claim aged exactly 59s is NOT taken over (425); 61s is", async () => {
    await fake()
      .admin.from("bot_events")
      .insert({
        source: "worker",
        event: "SLOT_LOCKED",
        delivery_id: "st2",
        payload: { event: {} },
      });
    age("st2", 59_000);
    expect((await send(lockedEvent({ event_id: "st2" }))).status).toBe(425);
    age("st2", 61_000);
    expect((await send(lockedEvent({ event_id: "st2" }))).status).toBe(200);
  });
  it("slow original cannot overwrite a takeover's stored success with 409", async () => {
    // A0 claims, then stalls in expireStaleHold's bookings select (first bookings call).
    const release = gateCall("bookings", 0);
    const ev = lockedEvent({ event_id: "ov1" });
    const a0 = send(ev);
    await new Promise((r) => setTimeout(r, 10));
    state.hook = null; // later calls are not gated (the gated builder still waits)
    age("ov1", CLAIM_STALE_MS + 1_000);
    const b = await body(await send(lockedEvent({ event_id: "ov1" })));
    expect(b.status).toBe(200); // takeover created the hold and sent WhatsApp
    release();
    const a = await body(await a0);
    const replay = await body(await send(lockedEvent({ event_id: "ov1" })));
    expect(fake().bookings()).toHaveLength(1);
    expect(a.status).toBe(200);
    expect(a.booking_id).toBe(b.booking_id);
    expect(replay.status).toBe(200);
    expect(replay.booking_id).toBe(b.booking_id);
    expect(replay.pay_url).toBe(b.pay_url);
  });
  it("takeover sends the WhatsApp when the hold exists but the message was never sent", async () => {
    const ev = lockedEvent({ event_id: "cr1" });
    await fake()
      .admin.from("bot_events")
      .insert({
        source: "worker",
        event: "SLOT_LOCKED",
        delivery_id: "cr1",
        payload: { event: ev },
      });
    age("cr1", CLAIM_STALE_MS + 1_000);
    fake()
      .bookings()
      .push({
        id: "HELD0001",
        phone: ev.phone,
        test_centre: "tallaght",
        test_date: ev.date,
        test_time: ev.time,
        status: "pending",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    const r = await body(await send(lockedEvent({ event_id: "cr1" })));
    expect(r.status).toBe(200);
    expect(r.pay_url).toBe("https://slotsniper.test/pay/HELD0001");
    expect(r.whatsapp).toBe("sent");
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(
      fake()
        .bookings()
        .find((row) => row.id === "HELD0001")?.whatsapp_sent_at,
    ).toEqual(expect.any(String));
  });
  it("resume when the hold was already paid returns that booking, not slot_taken", async () => {
    const ev = lockedEvent({ event_id: "cr2" });
    await fake()
      .admin.from("bot_events")
      .insert({
        source: "worker",
        event: "SLOT_LOCKED",
        delivery_id: "cr2",
        payload: { event: ev },
      });
    age("cr2", CLAIM_STALE_MS + 1_000);
    fake()
      .bookings()
      .push({
        id: "PAID0001",
        phone: ev.phone,
        test_centre: "tallaght",
        test_date: ev.date,
        test_time: ev.time,
        status: "paid",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    const paid = await body(await send(lockedEvent({ event_id: "cr2" })));
    expect(paid.status).toBe(200);
    expect(paid.pay_url).toBe("https://slotsniper.test/pay/PAID0001");
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });
  it("takeover dispatches the stored body, not the new one", async () => {
    const first = lockedEvent({ event_id: "db1", centre: "Finglas" });
    await fake()
      .admin.from("bot_events")
      .insert({
        source: "worker",
        event: "SLOT_LOCKED",
        delivery_id: "db1",
        payload: { event: first },
      });
    age("db1", CLAIM_STALE_MS + 1_000);
    const r = await body(await send(lockedEvent({ event_id: "db1", centre: "Tallaght" })));
    expect(r.status).toBe(200);
    expect(fake().bookings()[0]?.test_centre).toBe("Finglas");
    expect(sendWhatsAppText.mock.calls[0]?.[1]).toContain("Finglas");
  });
});

describe("C. can 425 loop forever?", () => {
  it("a crashed claim moves 425 -> takeover once it is 60s old (bounded)", async () => {
    await fake()
      .admin.from("bot_events")
      .insert({
        source: "worker",
        event: "SLOT_LOCKED",
        delivery_id: "lp1",
        payload: { event: {} },
      });
    const statuses: number[] = [];
    for (const a of [0, 20_000, 40_000, 61_000]) {
      age("lp1", a);
      statuses.push((await send(lockedEvent({ event_id: "lp1" }))).status);
    }
    expect(statuses).toEqual([425, 425, 425, 200]);
  });
  it("an unparseable received_at is treated as stale and taken over once", async () => {
    await fake()
      .admin.from("bot_events")
      .insert({
        source: "worker",
        event: "SLOT_LOCKED",
        delivery_id: "lp2",
        payload: { event: {} },
      });
    fake().events()[0]!.received_at = "garbage";
    expect((await send(lockedEvent({ event_id: "lp2" }))).status).toBe(200);
    expect((await send(lockedEvent({ event_id: "lp2" }))).status).toBe(200);
    expect(fake().bookings()).toHaveLength(1);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });
  it("a claim whose takeover dispatch throws is deleted, so the next retry starts fresh (no wedge)", async () => {
    await fake()
      .admin.from("bot_events")
      .insert({
        source: "worker",
        event: "SLOT_LOCKED",
        delivery_id: "lp3",
        payload: { event: {} },
      });
    age("lp3", CLAIM_STALE_MS + 1_000);
    let n = 0;
    state.hook = (t, b) => {
      if (t === "bookings" && n++ === 0) {
        b.then = (onFulfilled) =>
          Promise.resolve({ data: null, error: { code: "57014", message: "timeout" } }).then(
            onFulfilled,
          );
      }
      return b;
    };
    expect((await send(lockedEvent({ event_id: "lp3" }))).status).toBe(500);
    expect(fake().events()).toHaveLength(0);
    state.hook = null;
    expect((await send(lockedEvent({ event_id: "lp3" }))).status).toBe(200);
  });
  it("a stored 5xx result is not replayed forever", async () => {
    await fake()
      .admin.from("bot_events")
      .insert({
        source: "worker",
        event: "SLOT_LOCKED",
        delivery_id: "lp4",
        payload: {
          event: {},
          result: { status: 503, body: { ok: false, reason: "not_configured" } },
        },
      });
    expect((await send(lockedEvent({ event_id: "lp4" }))).status).toBe(425);
    age("lp4", CLAIM_STALE_MS + 1_000);
    expect((await send(lockedEvent({ event_id: "lp4" }))).status).toBe(200);
    expect(fake().bookings()).toHaveLength(1);
  });
});

describe("D. replay after success", () => {
  it("same bytes, and same event_id with a fresh timestamp after 5 min, both return the same booking_id and pay_url", async () => {
    const ev = lockedEvent({ event_id: "rp1" });
    const a = await body(await send(ev));
    const b = await body(await send(ev));
    const c = await body(await send({ ...ev, timestamp: freshTimestamp(1_000) }));
    expect(a.pay_url).toMatch(/^https:\/\/slotsniper\.test\/pay\/[A-Z2-9]{8}$/);
    expect([b.pay_url, c.pay_url]).toEqual([a.pay_url, a.pay_url]);
    expect([b.status, c.status]).toEqual([200, 200]);
    expect(b.duplicate && c.duplicate).toBe(true);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });
  it("replay after a 202 (WhatsApp failed) is 202 with the same pay_url, and does not retry WhatsApp", async () => {
    sendWhatsAppText.mockRejectedValueOnce(new Error("WhatsApp send failed (500): boom"));
    const ev = lockedEvent({ event_id: "rp2" });
    const a = await body(await send(ev));
    const b = await body(await send(ev));
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(b.pay_url).toBe(a.pay_url);
    expect(b.whatsapp).toBe("duplicate");
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });
  it("replay uses the stored pay_url even if PUBLIC_SITE_URL changed (stable)", async () => {
    const ev = lockedEvent({ event_id: "rp3" });
    const a = await body(await send(ev));
    process.env["PUBLIC_SITE_URL"] = "https://other.test";
    expect((await body(await send(ev))).pay_url).toBe(a.pay_url);
  });
});

describe("E. centre normalisation side effects", () => {
  it("stores the centre as given and still treats a case variant as the same slot", async () => {
    const r = await body(
      await send(lockedEvent({ event_id: "cn1", centre: "Baile Átha Cliath  (Raheny)" })),
    );
    expect(r.status).toBe(200);
    expect(fake().bookings()[0]?.test_centre).toBe("Baile Átha Cliath  (Raheny)");
    expect(sendWhatsAppText.mock.calls[0]?.[1]).toContain("Baile Átha Cliath  (Raheny)");
    expect(
      (await send(lockedEvent({ event_id: "cn1b", centre: "baile átha cliath (raheny)" }))).status,
    ).toBe(409);
  });
  it("keeps an NBSP in the stored centre and still collides with the normalised slot", async () => {
    await send(lockedEvent({ event_id: "cn2", centre: "Tallaght\u00a0Test" }));
    expect(fake().bookings()[0]?.test_centre).toBe("Tallaght\u00a0Test");
    expect((await send(lockedEvent({ event_id: "cn2b", centre: "tallaght test" }))).status).toBe(
      409,
    );
  });
});

describe("F. 503 path", () => {
  it("PUBLIC_SITE_URL unset: signed SLOT_LOCKED => 503 {ok,reason} only, no claim row, no booking, no WhatsApp; retry after fix works", async () => {
    delete process.env["PUBLIC_SITE_URL"];
    const ev = lockedEvent({ event_id: "ns1" });
    const r = await send(ev);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, reason: "not_configured" });
    expect(fake().events()).toHaveLength(0);
    expect(fake().bookings()).toHaveLength(0);
    process.env["PUBLIC_SITE_URL"] = "  https://slotsniper.test/  ";
    const ok = await body(await send(ev));
    expect(ok.pay_url).toMatch(/^https:\/\/slotsniper\.test\/pay\//);
  });
  it("PUBLIC_SITE_URL unset: unsigned/forged request still gets 401 (no config disclosure pre-auth)", async () => {
    delete process.env["PUBLIC_SITE_URL"];
    const r = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "ns2" }), { signature: "00".repeat(32) }),
    );
    expect(r.status).toBe(401);
  });
  it("PUBLIC_SITE_URL whitespace-only => 503; SLOT_FOUND / SESSION_ACTIVE still work", async () => {
    process.env["PUBLIC_SITE_URL"] = "   ";
    expect((await send(lockedEvent({ event_id: "ns3" }))).status).toBe(503);
    expect(
      (await send({ event_id: "ns4", timestamp: freshTimestamp(), status: "SESSION_ACTIVE" }))
        .status,
    ).toBe(200);
    expect(
      (
        await send({
          ...lockedEvent({ event_id: "ns5" }),
          status: "SLOT_FOUND",
          reference: undefined,
          candidate_id: undefined,
        })
      ).status,
    ).toBe(200);
  });
  it("missing BOT_WEBHOOK_SECRET answers 401 and does not disclose that the secret is unset", async () => {
    delete process.env["BOT_WEBHOOK_SECRET"];
    const r = await handleBotEvent(
      new Request("https://x/api/public/bot-event", { method: "POST", body: "{}" }),
    );
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ ok: false, reason: "missing_signature" });
  });
});

describe("G. HMAC / timestamp regressions", () => {
  it("size check: exactly 20 000 UTF-8 bytes passes the limit, 20 001 is 413 (multi-byte padding)", async () => {
    const base = lockedEvent({ event_id: "sz1", pad: "" });
    const baseLen = new TextEncoder().encode(JSON.stringify(base)).length;
    const n = 20_000 - baseLen; // fill with 2-byte é plus one ascii if odd
    const pad = "é".repeat(Math.floor(n / 2)) + (n % 2 ? "a" : "");
    const raw = JSON.stringify({ ...base, pad });
    expect(new TextEncoder().encode(raw).length).toBe(20_000);
    const s = await hmacHex(TEST_WEBHOOK_SECRET, raw);
    const mk = (x: string, sig: string) =>
      new Request("https://slotsniper.test/api/public/bot-event", {
        method: "POST",
        headers: { "x-bot-signature": sig },
        body: x,
      });
    expect((await handleBotEvent(mk(raw, s))).status).not.toBe(413);
    const raw2 = JSON.stringify({ ...base, event_id: "sz2", pad: pad + "a" });
    expect((await handleBotEvent(mk(raw2, await hmacHex(TEST_WEBHOOK_SECRET, raw2)))).status).toBe(
      413,
    );
  });
  it("signature header with surrounding whitespace / uppercase is accepted; 63/65 chars and non-hex rejected", async () => {
    const ev = lockedEvent({ event_id: "hs1" });
    const good = await hmacHex(TEST_WEBHOOK_SECRET, JSON.stringify(ev));
    for (const [sig, want] of [
      ["  " + good.toUpperCase() + " ", 200],
      [good.slice(1), 401],
      [good + "a", 401],
      ["g" + good.slice(1), 401],
    ] as const) {
      fake().reset();
      expect(
        (await handleBotEvent(await signedBotEventRequest(ev, { signature: sig }))).status,
      ).toBe(want);
    }
  });
  it("signature verified BEFORE JSON parse / schema / freshness (no oracle): bad sig on bad JSON => 401", async () => {
    const r = await handleBotEvent(
      new Request("https://x/api/public/bot-event", {
        method: "POST",
        headers: { "x-bot-signature": "ab".repeat(32) },
        body: "not json",
      }),
    );
    expect(r.status).toBe(401);
  });
  it("freshness boundaries: 4m59s past/future ok, 5m01s rejected, invalid date 400 by schema", async () => {
    expect(
      (await send(lockedEvent({ event_id: "t1", timestamp: freshTimestamp(-299_000) }))).status,
    ).toBe(200);
    expect(
      (
        await send(
          lockedEvent({ event_id: "t2", time: "11:00", timestamp: freshTimestamp(299_000) }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await body(await send(lockedEvent({ event_id: "t3", timestamp: freshTimestamp(-301_000) }))))
        .reason,
    ).toBe("timestamp_stale");
    expect(
      (await body(await send(lockedEvent({ event_id: "t4", timestamp: freshTimestamp(301_000) }))))
        .reason,
    ).toBe("timestamp_future");
    expect(
      (await send(lockedEvent({ event_id: "t5", timestamp: "2026-13-45T99:00:00Z" }))).status,
    ).toBe(400);
  });
  it("stale/forged requests leave no claim row (cannot pre-poison an event_id)", async () => {
    await send(lockedEvent({ event_id: "pz1", timestamp: freshTimestamp(-400_000) }));
    await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "pz1" }), { secret: "wrong" }),
    );
    expect(fake().events()).toHaveLength(0);
  });
});

describe("H. markBookingPaid", () => {
  it("two overlapping payment webhooks: the loser is not_pending, not expired", async () => {
    fake()
      .bookings()
      .push({
        id: "PAY00001",
        phone: "+353861234567",
        test_centre: "tallaght",
        test_date: "2026-11-10",
        test_time: "10:30",
        status: "pending",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    await markBookingPaid("WARM0000");
    // A reads 'pending', then its conditional UPDATE is held back until B has finished.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    state.hook = (t, b) => {
      if (t === "bookings" && ++calls === 2) {
        const realMaybe = b.maybeSingle.bind(b);
        b.maybeSingle = () => gate.then(() => realMaybe());
      }
      return b;
    };
    const a = markBookingPaid("PAY00001");
    await new Promise((r) => setTimeout(r, 10));
    const b = await markBookingPaid("PAY00001");
    release();
    const ra = await a;
    expect(fake().bookings()[0]?.status).toBe("paid");
    expect([ra, b]).toEqual([{ result: "not_pending" }, { result: "paid" }]);
  });
});
