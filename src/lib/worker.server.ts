/**
 * Signed outbound events from this site to the external Python worker.
 * Body is JSON, header `x-site-signature` = hex HMAC-SHA256(body, BOT_WEBHOOK_SECRET).
 * Events: RELEASE_SLOT (hold expired unpaid → worker cancels/re-assigns on RSA),
 *         PAYMENT_SUCCESS (fee paid → worker finalises on RSA).
 */
import { hmacHex } from "@/lib/hmac";

export { hmacHex };
export type WorkerEvent =
  | {
      event: "RELEASE_SLOT";
      booking_id: string;
      candidate_id: string | null;
      centre: string;
      date: string;
      time: string;
      reason: "expired_unpaid";
    }
  | {
      event: "PAYMENT_SUCCESS";
      booking_id: string;
      candidate_id: string | null;
      centre: string;
      date: string;
      time: string;
      paid_at: string;
    };

export async function notifyWorker(ev: WorkerEvent): Promise<void> {
  const url = process.env["WORKER_WEBHOOK_URL"];
  const secret = process.env["BOT_WEBHOOK_SECRET"];
  if (!url || !secret) throw new Error("Worker webhook not configured");
  const body = JSON.stringify({ ...ev, sent_at: new Date().toISOString() });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-site-signature": await hmacHex(secret, body),
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok)
    throw new Error(`Worker responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export type MarkPaidResult = { result: "paid" } | { result: "expired" } | { result: "not_pending" };

/** Marks a pending, unexpired booking paid and tells the worker. Call from the payment webhook. */
export async function markBookingPaid(bookingId: string): Promise<MarkPaidResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const paidAt = new Date().toISOString();
  const { data: current, error: readErr } = await supabaseAdmin
    .from("bookings")
    .select("id, status, expires_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!current || current.status !== "pending") return { result: "not_pending" };
  if (Date.parse(current.expires_at) <= Date.parse(paidAt)) return { result: "expired" };

  const { data: b, error } = await supabaseAdmin
    .from("bookings")
    .update({ status: "paid", paid_at: paidAt })
    .eq("id", bookingId)
    .eq("status", "pending")
    .gt("expires_at", paidAt)
    .select("id, candidate_id, test_centre, test_date, test_time")
    .maybeSingle();
  if (error) throw error;
  if (!b) {
    const { data: again, error: againErr } = await supabaseAdmin
      .from("bookings")
      .select("status, expires_at")
      .eq("id", bookingId)
      .maybeSingle();
    if (againErr) throw againErr;
    if (again?.status === "pending" && Date.parse(again.expires_at) <= Date.now()) {
      return { result: "expired" };
    }
    return { result: "not_pending" };
  }
  try {
    await notifyWorker({
      event: "PAYMENT_SUCCESS",
      booking_id: b.id,
      candidate_id: b.candidate_id,
      centre: b.test_centre,
      date: b.test_date,
      time: b.test_time,
      paid_at: paidAt,
    });
    await supabaseAdmin
      .from("bookings")
      .update({ worker_notified_at: new Date().toISOString(), worker_error: null })
      .eq("id", b.id);
  } catch (e) {
    await supabaseAdmin
      .from("bookings")
      .update({ worker_error: String(e) })
      .eq("id", b.id);
  }
  return { result: "paid" };
}
