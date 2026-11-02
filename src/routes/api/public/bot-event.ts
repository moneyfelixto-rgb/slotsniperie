import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Slot = {
  phone: z.string().regex(/^\+?\d{8,15}$/),
  centre: z.string().min(2).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{1,2}:\d{2}$/),
};

export const Event = z.discriminatedUnion("status", [
  z.object({ status: z.literal("SESSION_ACTIVE"), event_id: z.string().max(100).optional() }),

  z.object({ status: z.literal("SLOT_FOUND"), event_id: z.string().max(100).optional(), ...Slot }),
  z.object({
    status: z.enum(["BOOKING_CONFIRMED", "SLOT_LOCKED"]),
    event_id: z.string().max(100).optional(),
    ...Slot,
    reference: z.string().max(40).optional(),
    candidate_id: z.string().max(40).optional(),
  }),
]);

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function newId() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(8))].map((n) => abc[n % abc.length]).join("");
}

export const Route = createFileRoute("/api/public/bot-event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env['BOT_WEBHOOK_SECRET'];
        // 2xx while the secret is missing: 5xx here reads as a crashed handler in previews,
        // and no worker can authenticate anyway until the key is set.
        if (!secret) return Response.json({ ok: false, reason: "not_configured" }, { status: 200 });

        const raw = await request.text();
        if (raw.length > 20_000) return new Response("Too large", { status: 413 });
        const sig = request.headers.get("x-bot-signature") ?? "";
        if (!safeEqual(sig, await hmacHex(secret, raw))) return new Response("Invalid signature", { status: 401 });

        let json: unknown;
        try { json = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
        const parsed = Event.safeParse(json);
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const ev = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error: logErr } = await supabaseAdmin
          .from("bot_events")
          .insert({ source: "worker", event: ev.status, delivery_id: ev.event_id ?? null, payload: ev as never });
        if (logErr?.code === "23505") return Response.json({ ok: true, duplicate: true });
        if (logErr) return new Response("DB error", { status: 500 });

        if (ev.status === "SESSION_ACTIVE") return Response.json({ ok: true });

        const { sendWhatsAppText } = await import("@/lib/whatsapp.server");

        if (ev.status === "SLOT_FOUND") {
          try {
            await sendWhatsAppText(ev.phone, `🚗 Slot open: ${ev.centre}, ${ev.date} at ${ev.time}. Book it now on myroadsafety.rsa.ie — slots go fast.`);
          } catch (e) {
            return Response.json({ ok: true, whatsapp: String(e) }, { status: 202 });
          }
          return Response.json({ ok: true });
        }

        const id = newId();
        const { error } = await supabaseAdmin.from("bookings").insert({
          id, phone: ev.phone, test_centre: ev.centre, test_date: ev.date, test_time: ev.time, reference: ev.reference ?? null,
        });
        if (error) return new Response("DB error", { status: 500 });
        const base = process.env['PUBLIC_SITE_URL'] ?? new URL(request.url).origin;
        const payUrl = `${base}/pay/${id}`;
        let whatsapp = "sent";
        try {
          await sendWhatsAppText(ev.phone, `✅ Your test at ${ev.centre} on ${ev.date} at ${ev.time} is confirmed. Pay the €60 fee within 2 hours: ${payUrl}`);
        } catch (e) { whatsapp = String(e); }
        return Response.json({ ok: true, booking_id: id, pay_url: payUrl, whatsapp });
      },
    },
  },
});
