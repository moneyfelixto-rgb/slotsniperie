import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SIGNATURE_MAX_SKEW_MS } from "@/lib/bot-event-contract";
import { hmacHex } from "@/lib/hmac";
import { HOLD_HOURS, SERVICE_FEE_CENTS, SERVICE_FEE_EUR } from "@/lib/offer";
import { toPayView } from "@/lib/pay-booking";
import { PayPageView } from "@/components/pay-page";
import { createFakeSupabase, type FakeSupabase } from "./fake-supabase";
import {
  freshTimestamp,
  lockedEvent,
  signedBotEventRequest,
  TEST_WEBHOOK_SECRET,
} from "./sign-bot-event";

const state = vi.hoisted(() => ({ fake: null as FakeSupabase | null }));
const sendWhatsAppText = vi.hoisted(() =>
  vi.fn(async (_to: string, _body: string) => "wamid.test"),
);

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    if (!state.fake) throw new Error("fake supabase is not ready");
    return state.fake.admin;
  },
}));

vi.mock("@/lib/whatsapp.server", () => ({
  sendWhatsAppText,
}));

import { handleBotEvent } from "@/lib/bot-event.server";
import { fetchBookingById } from "@/lib/pay-booking.server";

const originalSecret = process.env["BOT_WEBHOOK_SECRET"];
const originalSite = process.env["PUBLIC_SITE_URL"];

state.fake = createFakeSupabase();

beforeEach(() => {
  state.fake?.reset();
  sendWhatsAppText.mockClear();
  sendWhatsAppText.mockResolvedValue("wamid.test");
  process.env["BOT_WEBHOOK_SECRET"] = TEST_WEBHOOK_SECRET;
  process.env["PUBLIC_SITE_URL"] = "https://slotsniper.test";
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env["BOT_WEBHOOK_SECRET"];
  else process.env["BOT_WEBHOOK_SECRET"] = originalSecret;
  if (originalSite === undefined) delete process.env["PUBLIC_SITE_URL"];
  else process.env["PUBLIC_SITE_URL"] = originalSite;
});

describe("POST /api/public/bot-event", () => {
  it("creates one booking from a valid signed SLOT_LOCKED event", async () => {
    const response = await handleBotEvent(await signedBotEventRequest(lockedEvent()));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.pay_url).toBe(`https://slotsniper.test/pay/${body.booking_id}`);
    const bookings = state.fake?.bookings() ?? [];
    expect(bookings).toHaveLength(1);
    const booking = bookings[0];
    expect(booking).toMatchObject({
      id: body.booking_id,
      phone: "+353861234567",
      test_centre: "Tallaght",
      test_date: "2026-11-10",
      test_time: "10:30",
      amount_cents: SERVICE_FEE_CENTS,
      status: "pending",
      reference: "RSA-123",
      candidate_id: "C-77",
    });
    const heldFor = Date.parse(String(booking?.["expires_at"])) - Date.now();
    expect(heldFor).toBeGreaterThan(HOLD_HOURS * 60 * 60 * 1000 - 5_000);
    expect(heldFor).toBeLessThan(HOLD_HOURS * 60 * 60 * 1000 + 5_000);

    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    const text = String(sendWhatsAppText.mock.calls[0]?.[1] ?? "");
    expect(text).toContain("HELD");
    expect(text).toContain(`${HOLD_HOURS}h`);
    expect(text).toContain(`€${SERVICE_FEE_EUR}`);
    expect(text).toContain("to confirm");
    expect(text.toLowerCase()).not.toContain("confirmed");
    expect(text).toContain(body.pay_url);
  });

  it("deduplicates a replay of the same event_id", async () => {
    const event = lockedEvent({ event_id: "evt-replay" });
    const first = await handleBotEvent(await signedBotEventRequest(event));
    const firstBody = await first.json();
    const second = await handleBotEvent(await signedBotEventRequest(event));

    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.duplicate).toBe(true);
    expect(secondBody.booking_id).toBe(firstBody.booking_id);
    expect(secondBody.whatsapp).toBe("duplicate");
    expect(state.fake?.bookings()).toHaveLength(1);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale timestamp", async () => {
    const response = await handleBotEvent(
      await signedBotEventRequest(
        lockedEvent({ timestamp: freshTimestamp(-(SIGNATURE_MAX_SKEW_MS + 1000)) }),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, reason: "timestamp_stale" });
    expect(state.fake?.bookings()).toHaveLength(0);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("rejects a timestamp too far in the future", async () => {
    const response = await handleBotEvent(
      await signedBotEventRequest(
        lockedEvent({ timestamp: freshTimestamp(SIGNATURE_MAX_SKEW_MS + 1000) }),
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, reason: "timestamp_future" });
    expect(state.fake?.bookings()).toHaveLength(0);
  });

  it("rejects a forged signature", async () => {
    const response = await handleBotEvent(
      await signedBotEventRequest(lockedEvent(), { signature: "ab".repeat(32) }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, reason: "invalid_signature" });
    expect(state.fake?.bookings()).toHaveLength(0);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("rejects a missing signature", async () => {
    const request = new Request("https://slotsniper.test/api/public/bot-event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(lockedEvent()),
    });
    const response = await handleBotEvent(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, reason: "missing_signature" });
  });

  it("returns 409 when the slot is already held", async () => {
    const first = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "evt-a" })),
    );
    expect(first.status).toBe(200);

    const conflictEvent = lockedEvent({ event_id: "evt-b", phone: "+353871111111" });
    const conflict = await handleBotEvent(await signedBotEventRequest(conflictEvent));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ ok: false, reason: "slot_taken" });

    const replay = await handleBotEvent(await signedBotEventRequest(conflictEvent));
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ ok: false, reason: "slot_taken", duplicate: true });
    expect(state.fake?.bookings()).toHaveLength(1);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  });

  it("treats 9:05 and 09:05 as the same slot", async () => {
    const first = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "evt-time-a", time: "9:05" })),
    );
    expect(first.status).toBe(200);
    expect((state.fake?.bookings() ?? [])[0]?.["test_time"]).toBe("09:05");

    const second = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "evt-time-b", time: "09:05" })),
    );
    expect(second.status).toBe(409);
  });

  it("returns 401 when the webhook secret is missing", async () => {
    delete process.env["BOT_WEBHOOK_SECRET"];
    const response = await handleBotEvent(await signedBotEventRequest(lockedEvent()));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, reason: "invalid_signature" });
    expect(state.fake?.bookings()).toHaveLength(0);
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("signs the documented Python vector the same way", async () => {
    const raw =
      '{"event_id":"evt-1","timestamp":"2026-11-03T18:00:00.000Z","status":"SESSION_ACTIVE"}';
    await expect(hmacHex("test-secret", raw)).resolves.toBe(
      "2b49d08ddcda82da8b73689e5f951bd98c4783bd9faaae3b62991f2c99648836",
    );
  });
});

describe("signed bot event → booking → /pay/:id", () => {
  it("shows the held booking and a disabled payment button", async () => {
    const response = await handleBotEvent(
      await signedBotEventRequest(
        lockedEvent({ event_id: "evt-pay-page", centre: "Tallaght", time: "14:15" }),
      ),
    );
    const { booking_id: bookingId } = await response.json();
    const row = await fetchBookingById(bookingId);

    expect(row?.test_centre).toBe("Tallaght");
    expect(row?.amount_cents).toBe(SERVICE_FEE_CENTS);
    const view = toPayView(row!);
    render(<PayPageView booking={view} />);

    expect(screen.getByText("Tallaght")).toBeInTheDocument();
    expect(screen.getByText("14:15")).toBeInTheDocument();
    expect(screen.getByText(`€${SERVICE_FEE_EUR}.00`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /holding your slot/i })).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /payment coming soon/i });
    expect(button).toBeDisabled();
    expect(screen.queryByText(/slot confirmed/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /revolut|apple pay|pay by card/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an expired hold that cannot be paid", async () => {
    const response = await handleBotEvent(
      await signedBotEventRequest(lockedEvent({ event_id: "evt-expired" })),
    );
    const { booking_id: bookingId } = await response.json();
    const row = await fetchBookingById(bookingId);
    row!.status = "pending";
    row!.expires_at = new Date(Date.now() - 60_000).toISOString();

    render(<PayPageView booking={toPayView(row!)} />);

    expect(screen.getByRole("heading", { name: /hold has expired/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hold expired/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /payment coming soon/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/slot confirmed/i)).not.toBeInTheDocument();
  });
});

describe("offer and migration", () => {
  it("keeps the €60 / 2 hour database defaults and the active-slot index", () => {
    const defaults = readFileSync(
      path.resolve("drizzle/migrations/0000_bookings_and_events.sql"),
      "utf8",
    );
    const slotIndex = readFileSync(
      path.resolve("drizzle/migrations/0002_active_slot_unique.sql"),
      "utf8",
    );

    expect(defaults).toContain(`DEFAULT ${SERVICE_FEE_CENTS}`);
    expect(defaults).toContain(`interval '${HOLD_HOURS} hours'`);
    expect(slotIndex).toContain("bookings_active_slot_uidx");
    expect(slotIndex).toContain("status = 'released'");
    expect(slotIndex).toContain("bookings_status_check");
    expect(slotIndex).toContain("status IN ('pending', 'paid', 'expired', 'released')");
    expect(slotIndex).toContain("status IN ('pending', 'paid')");
  });
});
