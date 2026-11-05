import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./fake-supabase";

const state = vi.hoisted(() => ({ fake: null as FakeSupabase | null }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return state.fake!.admin;
  },
}));

import { markBookingPaid } from "@/lib/worker.server";

state.fake = createFakeSupabase();

beforeEach(() => {
  state.fake!.reset();
  delete process.env["WORKER_WEBHOOK_URL"];
});

describe("markBookingPaid", () => {
  it("returns expired and does not mark a hold whose expires_at has passed", async () => {
    await state.fake!.admin.from("bookings").insert({
      id: "HOLD0001",
      phone: "+353800000009",
      test_centre: "tallaght",
      test_date: "2026-11-10",
      test_time: "10:30",
      status: "pending",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    await expect(markBookingPaid("HOLD0001")).resolves.toEqual({ result: "expired" });
    expect(state.fake!.bookings()[0]?.status).toBe("pending");
    expect(state.fake!.bookings()[0]?.["paid_at"]).toBeUndefined();
  });

  it("marks a live pending hold paid", async () => {
    await state.fake!.admin.from("bookings").insert({
      id: "HOLD0002",
      phone: "+353800000009",
      test_centre: "tallaght",
      test_date: "2026-11-10",
      test_time: "11:00",
      status: "pending",
      candidate_id: "C-1",
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    });

    await expect(markBookingPaid("HOLD0002")).resolves.toEqual({ result: "paid" });
    expect(state.fake!.bookings()[0]?.status).toBe("paid");
    expect(state.fake!.bookings()[0]?.["paid_at"]).toEqual(expect.any(String));
  });
});
