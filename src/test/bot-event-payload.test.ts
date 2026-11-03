import { describe, expect, it } from "vitest";

import { Event } from "@/lib/bot-event-contract";

const base = {
  event_id: "evt-1",
  timestamp: "2026-11-03T18:00:00.000Z",
  phone: "+353861234567",
  centre: "Finglas",
  date: "2026-11-10",
  time: "10:30",
};

describe("bot-event payloads", () => {
  it("accepts a SLOT_LOCKED payload with booking data and candidate id", () => {
    const parsed = Event.safeParse({
      status: "SLOT_LOCKED",
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
      expect(parsed.data.event_id).toBe("evt-1");
    }
  });

  it("rejects a SLOT_LOCKED payload missing the booking fields", () => {
    const parsed = Event.safeParse({
      status: "SLOT_LOCKED",
      event_id: "evt-1",
      timestamp: "2026-11-03T18:00:00.000Z",
      phone: "+353861234567",
      centre: "Finglas",
    });

    expect(parsed.success).toBe(false);
  });

  it("requires event_id and timestamp", () => {
    expect(Event.safeParse({ status: "SESSION_ACTIVE" }).success).toBe(false);
    expect(Event.safeParse({ status: "SESSION_ACTIVE", event_id: "evt-1" }).success).toBe(false);
    expect(
      Event.safeParse({ status: "SESSION_ACTIVE", timestamp: "2026-11-03T18:00:00.000Z" }).success,
    ).toBe(false);
  });

  it("rejects unknown statuses", () => {
    expect(Event.safeParse({ status: "OTP_REQUIRED", ...base }).success).toBe(false);
  });
});
