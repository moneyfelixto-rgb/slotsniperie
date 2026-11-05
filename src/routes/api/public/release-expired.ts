import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Runs every few minutes. Pending bookings past expires_at → status "expired" + RELEASE_SLOT to the worker.
 * Also retries worker notifications that failed earlier (expired or paid rows without worker_notified_at).
 */
export const Route = createFileRoute("/api/public/release-expired")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { notifyWorker } = await import("@/lib/worker.server");
        const now = new Date().toISOString();

        const { error: expErr } = await supabaseAdmin
          .from("bookings")
          .update({ status: "expired", released_at: now })
          .eq("status", "pending")
          .lt("expires_at", now);
        if (expErr) return new Response("DB error", { status: 500 });

        const { data: todo, error } = await supabaseAdmin
          .from("bookings")
          .select("id, status, candidate_id, test_centre, test_date, test_time, paid_at")
          .in("status", ["expired", "paid"])
          .is("worker_notified_at", null)
          .order("worker_error", { ascending: true, nullsFirst: true })
          .limit(25);
        if (error) return new Response("DB error", { status: 500 });

        let sent = 0;
        for (const b of todo ?? []) {
          const common = {
            booking_id: b.id,
            candidate_id: b.candidate_id,
            centre: b.test_centre,
            date: b.test_date,
            time: b.test_time,
          };
          try {
            await notifyWorker(
              b.status === "paid"
                ? { event: "PAYMENT_SUCCESS", ...common, paid_at: b.paid_at ?? now }
                : { event: "RELEASE_SLOT", ...common, reason: "expired_unpaid" },
            );
            await supabaseAdmin
              .from("bookings")
              .update({ worker_notified_at: new Date().toISOString(), worker_error: null })
              .eq("id", b.id);
            sent++;
          } catch (e) {
            await supabaseAdmin
              .from("bookings")
              .update({ worker_error: String(e).slice(0, 500) })
              .eq("id", b.id);
          }
        }
        return Response.json({ ok: true, pending_notifications: todo?.length ?? 0, sent });
      },
    },
  },
});
