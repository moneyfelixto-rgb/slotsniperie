import {
  BOT_EVENT_MAX_BYTES,
  BOT_SIGNATURE_HEADER,
  BotEvent,
  canonicalCentre,
  canonicalSlotTime,
  timestampFreshness,
  type BotEvent as BotEventT,
} from "@/lib/bot-event-contract";
import { hmacHex, safeEqual } from "@/lib/hmac";
import { holdExpiresAt, SERVICE_FEE_CENTS, slotHeldWhatsAppText } from "@/lib/offer";

type JsonObject = Record<string, unknown>;

type StoredResult = { status: number; body: JsonObject };

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/** A claim with no stored result can be taken over after this long. */
export const CLAIM_STALE_MS = 60_000;

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

function siteBase(): string | null {
  const raw = process.env["PUBLIC_SITE_URL"]?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

function byteLength(raw: string): number {
  return new TextEncoder().encode(raw).byteLength;
}

/**
 * POST /api/public/bot-event.
 * See docs/bot-event-contract.md. OTP, login and browser automation stay on the worker.
 */
export async function handleBotEvent(request: Request): Promise<Response> {
  const secret = process.env["BOT_WEBHOOK_SECRET"];
  if (!secret) return json({ ok: false, reason: "not_configured" }, 503);

  const raw = await request.text();
  if (byteLength(raw) > BOT_EVENT_MAX_BYTES) return json({ ok: false, reason: "too_large" }, 413);

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

  if (ev.status !== "SESSION_ACTIVE" && ev.status !== "SLOT_FOUND" && !siteBase()) {
    return json({ ok: false, reason: "not_configured" }, 503);
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const claim = await supabaseAdmin.from("bot_events").insert({
    source: "worker",
    event: ev.status,
    delivery_id: ev.event_id,
    received_at: new Date().toISOString(),
    payload: { event: ev } as never,
  });
  if (claim.error) {
    if (claim.error.code === "23505") return resumeClaim(supabaseAdmin, ev);
    return json({ ok: false, reason: "db_error" }, 500);
  }

  try {
    return await dispatch(supabaseAdmin, ev, false);
  } catch {
    await supabaseAdmin.from("bot_events").delete().eq("delivery_id", ev.event_id);
    return json({ ok: false, reason: "db_error" }, 500);
  }
}

async function resumeClaim(supabaseAdmin: Admin, ev: BotEventT) {
  const { data, error } = await supabaseAdmin
    .from("bot_events")
    .select("payload, received_at")
    .eq("delivery_id", ev.event_id)
    .maybeSingle();
  if (error || !data) return json({ ok: false, reason: "db_error" }, 500);

  const stored = readStored(data.payload);
  if (stored) return json(withDuplicate(stored.body), stored.status);

  const receivedAt = Date.parse(String(data.received_at ?? ""));
  const age = Number.isNaN(receivedAt) ? 0 : Date.now() - receivedAt;
  if (age < CLAIM_STALE_MS) return json({ ok: false, reason: "in_progress" }, 425);

  const now = new Date().toISOString();
  const stolen = await supabaseAdmin
    .from("bot_events")
    .update({ received_at: now, payload: { event: ev } as never })
    .eq("delivery_id", ev.event_id)
    .eq("received_at", data.received_at)
    .select("delivery_id")
    .maybeSingle();
  if (stolen.error) return json({ ok: false, reason: "db_error" }, 500);
  if (!stolen.data) {
    const again = await supabaseAdmin
      .from("bot_events")
      .select("payload")
      .eq("delivery_id", ev.event_id)
      .maybeSingle();
    const completed = readStored(again.data?.payload);
    if (completed) return json(withDuplicate(completed.body), completed.status);
    return json({ ok: false, reason: "in_progress" }, 425);
  }

  try {
    return await dispatch(supabaseAdmin, ev, true);
  } catch {
    await supabaseAdmin.from("bot_events").delete().eq("delivery_id", ev.event_id);
    return json({ ok: false, reason: "db_error" }, 500);
  }
}

async function remember(supabaseAdmin: Admin, ev: BotEventT, status: number, body: JsonObject) {
  const saved = await supabaseAdmin
    .from("bot_events")
    .update({
      processed_at: new Date().toISOString(),
      processing_error: null,
      payload: { event: ev, result: { status, body } } as never,
    })
    .eq("delivery_id", ev.event_id);
  if (saved.error) return json({ ok: false, reason: "db_error" }, 500);
  return json(body, status);
}

async function expireStaleHold(
  supabaseAdmin: Admin,
  slot: { centre: string; date: string; time: string },
) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("id, test_centre, expires_at, status")
    .eq("test_date", slot.date)
    .eq("test_time", slot.time)
    .eq("status", "pending");
  if (error) throw error;
  const now = Date.now();
  for (const row of data ?? []) {
    if (canonicalCentre(row.test_centre) !== slot.centre) continue;
    if (Date.parse(row.expires_at) > now) continue;
    const updated = await supabaseAdmin
      .from("bookings")
      .update({ status: "expired", released_at: new Date(now).toISOString() })
      .eq("id", row.id)
      .eq("status", "pending");
    if (updated.error) throw updated.error;
  }
}

async function dispatch(supabaseAdmin: Admin, ev: BotEventT, resuming: boolean) {
  if (ev.status === "SESSION_ACTIVE") return remember(supabaseAdmin, ev, 200, { ok: true });

  const slot = {
    phone: ev.phone.trim(),
    centre: canonicalCentre(ev.centre),
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

  const base = siteBase();
  if (!base) return remember(supabaseAdmin, ev, 503, { ok: false, reason: "not_configured" });

  await expireStaleHold(supabaseAdmin, slot);

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
      if (resuming) {
        const { data: held, error: heldErr } = await supabaseAdmin
          .from("bookings")
          .select("id, phone, status")
          .eq("test_centre", slot.centre)
          .eq("test_date", slot.date)
          .eq("test_time", slot.time)
          .eq("status", "pending")
          .maybeSingle();
        if (heldErr) throw heldErr;
        if (held && held.phone === slot.phone) {
          const payUrl = `${base}/pay/${held.id}`;
          return remember(supabaseAdmin, ev, 200, {
            ok: true,
            duplicate: true,
            booking_id: held.id,
            pay_url: payUrl,
            whatsapp: "duplicate",
          });
        }
      }
      return remember(supabaseAdmin, ev, 409, { ok: false, reason: "slot_taken" });
    }
    throw inserted.error;
  }

  const payUrl = `${base}/pay/${id}`;
  let whatsapp = "sent";
  let status = 200;
  try {
    await sendWhatsAppText(slot.phone, slotHeldWhatsAppText(slot, payUrl));
  } catch (e) {
    whatsapp = String(e);
    status = 202;
  }
  return remember(supabaseAdmin, ev, status, {
    ok: true,
    booking_id: id,
    pay_url: payUrl,
    whatsapp,
  });
}
