import { z } from "zod";

/** Header carrying the hex HMAC-SHA256 of the raw request body. */
export const BOT_SIGNATURE_HEADER = "x-bot-signature";

/** Reject timestamps further than this from the server clock, in either direction. */
export const SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

export const BOT_EVENT_MAX_BYTES = 20_000;

const eventId = z.string().min(1).max(100);
const timestamp = z.iso.datetime({ offset: true });

const slot = {
  phone: z.string().regex(/^\+?\d{8,15}$/),
  centre: z.string().trim().min(2).max(60),
  date: z.iso.date(),
  time: z.string().regex(/^(?:[01]?\d|2[0-3]):[0-5]\d$/),
};

const envelope = { event_id: eventId, timestamp };

/**
 * One bot → site event. `event_id` and `timestamp` are always required and
 * travel inside the body, so the HMAC over the raw body covers both.
 * BOOKING_CONFIRMED is an alias of SLOT_LOCKED: the slot is held, not paid.
 */
export const BotEvent = z.discriminatedUnion("status", [
  z.object({ status: z.literal("SESSION_ACTIVE"), ...envelope }),
  z.object({ status: z.literal("SLOT_FOUND"), ...envelope, ...slot }),
  z.object({
    status: z.enum(["SLOT_LOCKED", "BOOKING_CONFIRMED"]),
    ...envelope,
    ...slot,
    reference: z.string().max(40).optional(),
    candidate_id: z.string().max(40).optional(),
  }),
]);

export type BotEvent = z.infer<typeof BotEvent>;

/** Name kept for the original payload tests. */
export const Event = BotEvent;

export function canonicalSlotTime(time: string): string {
  const [hours = "0", minutes = "00"] = time.split(":");
  return `${hours.padStart(2, "0")}:${minutes}`;
}

/** Same key the partial unique index uses: trimmed, internal spaces collapsed, lower case. */
export function canonicalCentre(centre: string): string {
  return centre.trim().replace(/\s+/g, " ").toLowerCase();
}

export function timestampFreshness(
  timestampValue: string,
  now = Date.now(),
): "ok" | "stale" | "future" {
  const ts = Date.parse(timestampValue);
  if (Number.isNaN(ts) || ts < now - SIGNATURE_MAX_SKEW_MS) return "stale";
  if (ts > now + SIGNATURE_MAX_SKEW_MS) return "future";
  return "ok";
}
