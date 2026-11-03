import {
  BOT_EVENT_MAX_BYTES,
  BOT_SIGNATURE_HEADER,
  BotEvent,
  canonicalSlotTime,
  timestampFreshness,
  type BotEvent as BotEventT,
} from "@/lib/bot-event-contract";
import { hmacHex, safeEqual } from "@/lib/hmac";
import { holdExpiresAt, SERVICE_FEE_CENTS, slotHeldWhatsAppText } from "@/lib/offer";

type JsonObject = Record<string, unknown>;

type StoredResult = { status: number; body: JsonObject };

function json(body: JsonObject, status = 200) {
  return Response.json(body, { status });
}

function newId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((n) => alphabet[n % alphabet.length])
    .join("");
}

function errorText(error: { code?: string; message?: string; details?: string | null }) {
  return `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`;
}

function isSlotConflict(error: { code?: string; message?: string; details?: string | null }) {
  if (error.code !== "23505") return false;
  const text = errorText(error);
  if (text.includes("bookings_pkey")) return false;
  return text.includes("bookings_active_slot_uidx") || text.includes("test_centre");
}

function readStored(payload: unknown): StoredResult | null {
  if (!payload || typeof payload !== "object") return null;
  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  const status = (result as { status?: unknown }).status;
  const body = (result as { body?: unknown }).body;
  if (typeof status !== "number" || !body || typeof body !== "object") return null;
  return { status, body: body as JsonObject };
}

function withDuplicate(body: JsonObject): JsonObject {
  const next: JsonObject = { ...body, duplicate: true };
  if (typeof next["whatsapp"] === "string") next["whatsapp"] = "duplicate";
  return next;
}

/**
 * POST /api/public/bot-event.
 * See docs/bot-event-contract.md. OTP, login and browser automation stay on the worker.
 */
export async function handleBotEvent(request: Request): Promise<Response> {
  const secret = process.env["BOT_WEBHOOK_SECRET"];
  if (!secret) return json({ ok: false, reason: "not_configured" }, 503);

  const raw = await request.text();
  if (raw.length > BOT_EVENT_MAX_BYTES) return json({ ok: false, reason: "too_large" }, 413);

  const provided = (request.headers.get(BOT_SIGNATURE_HEADER) ?? "").trim().toLowerCase();
  if (!provided) return json({ ok: false, reason: "missing_signature" }, 401);
  const expected = await hmacHex(secret, raw);
  if (!safeEqual(provided, expected)) return json({ ok: false, reason: "invalid_signature" }, 401);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json({ ok: false, reason: "bad_json" }, 400);
  }

  const parsed = BotEvent.safeParse(parsedJson);
  if (!parsed.success) return json({ ok: false, error: parsed.error.flatten() }, 400);
  const ev = parsed.data;

  const freshness = timestampFreshness(ev.timestamp);
  if (freshness !== "ok") {
    return json(
      { ok: false, reason: freshness === "future" ? "timestamp_future" : "timestamp_stale" },
      401,
    );
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const claim = await supabaseAdmin.from("bot_events").insert({
    source: "worker",
    event: ev.status,
    delivery_id: ev.event_id,
    payload: { event: ev } as never,
  });
  if (claim.error) {
    if (claim.error.code === "23505") return replay(supabaseAdmin, ev.event_id);
    return json({ ok: false, reason: "db_error" }, 500);
  }

  try {
    return await dispatch(supabaseAdmin, request, ev);
  } catch {
    await supabaseAdmin.from("bot_events").delete().eq("delivery_id", ev.event_id);
    return json({ ok: false, reason: "db_error" }, 500);
  }
}

async function replay(
  supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  eventId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("bot_events")
    .select("payload")
    .eq("delivery_id", eventId)
    .maybeSingle();
  if (error) return json({ ok: false, reason: "db_error" }, 500);
  const stored = readStored(data?.payload);
  if (!stored) return json({ ok: true, duplicate: true });
  return json(withDuplicate(stored.body), stored.status);
}

async function remember(
  supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  ev: BotEventT,
  status: number,
  body: JsonObject,
) {
  await supabaseAdmin
    .from("bot_events")
    .update({
      processed_at: new Date().toISOString(),
      processing_error: null,
      payload: { event: ev, result: { status, body } } as never,
    })
    .eq("delivery_id", ev.event_id);
  return json(body, status);
}

async function dispatch(
  supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  request: Request,
  ev: BotEventT,
) {
  if (ev.status === "SESSION_ACTIVE") return remember(supabaseAdmin, ev, 200, { ok: true });

  const slot = {
    phone: ev.phone.trim(),
    centre: ev.centre.trim(),
    date: ev.date,
    time: canonicalSlotTime(ev.time),
  };
  const { sendWhatsAppText } = await import("@/lib/whatsapp.server");

  if (ev.status === "SLOT_FOUND") {
    let whatsapp = "sent";
    try {
      await sendWhatsAppText(
        slot.phone,
        `Slot open: ${slot.centre}, ${slot.date} at ${slot.time}. Book it now on myroadsafety.rsa.ie — slots go fast.`,
      );
    } catch (e) {
      whatsapp = String(e);
      return remember(supabaseAdmin, ev, 202, { ok: true, whatsapp });
    }
    return remember(supabaseAdmin, ev, 200, { ok: true, whatsapp });
  }

  const id = newId();
  const inserted = await supabaseAdmin.from("bookings").insert({
    id,
    phone: slot.phone,
    test_centre: slot.centre,
    test_date: slot.date,
    test_time: slot.time,
    reference: ev.reference?.trim() || null,
    candidate_id: ev.candidate_id?.trim() || null,
    amount_cents: SERVICE_FEE_CENTS,
    expires_at: holdExpiresAt(),
    status: "pending",
  });
  if (inserted.error) {
    if (isSlotConflict(inserted.error)) {
      return remember(supabaseAdmin, ev, 409, { ok: false, reason: "slot_taken" });
    }
    throw inserted.error;
  }

  const base = (process.env["PUBLIC_SITE_URL"] ?? new URL(request.url).origin).replace(/\/$/, "");
  const payUrl = `${base}/pay/${id}`;
  let whatsapp = "sent";
  try {
    await sendWhatsAppText(slot.phone, slotHeldWhatsAppText(slot, payUrl));
  } catch (e) {
    whatsapp = String(e);
  }
  return remember(supabaseAdmin, ev, 200, { ok: true, booking_id: id, pay_url: payUrl, whatsapp });
}
