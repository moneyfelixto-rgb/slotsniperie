/**
 * Signed outbound events from this site to the external Python worker.
 * Body is JSON, header `x-site-signature` = hex HMAC-SHA256(body, BOT_WEBHOOK_SECRET).
 * Events: RELEASE_SLOT (hold expired unpaid → worker cancels/re-assigns on RSA),
 *         PAYMENT_SUCCESS (fee paid → worker finalises on RSA).
 */
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

export async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

/** Marks a booking paid and tells the worker. Call from the payment webhook. */
export async function markBookingPaid(bookingId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const paidAt = new Date().toISOString();
  const { data: b, error } = await supabaseAdmin
    .from("bookings")
    .update({ status: "paid", paid_at: paidAt })
    .eq("id", bookingId)
    .eq("status", "pending")
    .select("id, candidate_id, test_centre, test_date, test_time")
    .maybeSingle();
  if (error) throw error;
  if (!b) return; // already paid / released
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
}
