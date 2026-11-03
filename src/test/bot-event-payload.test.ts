import { describe, expect, it } from "vitest";

import { Event } from "@/routes/api/public/bot-event";

const base = { phone: "+353861234567", centre: "Finglas", date: "2026-11-10", time: "10:30" };

describe("bot-event payloads", () => {
  it("accepts a SLOT_LOCKED payload with booking data and candidate id", () => {
    const parsed = Event.safeParse({
      status: "SLOT_LOCKED",
      event_id: "evt-1",
      ...base,
      reference: "RSA-123",
      candidate_id: "C-77",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.status === "SLOT_LOCKED") {
      expect(parsed.data.centre).toBe("Finglas");
      expect(parsed.data.date).toBe("2026-11-10");
      expect(parsed.data.time).toBe("10:30");
      expect(parsed.data.candidate_id).toBe("C-77");
    }
  });

  it("rejects a SLOT_LOCKED payload missing the booking fields", () => {
    const parsed = Event.safeParse({
      status: "SLOT_LOCKED",
      phone: "+353861234567",
      centre: "Finglas",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(Event.safeParse({ status: "OTP_REQUIRED", ...base }).success).toBe(false);
  });
});
