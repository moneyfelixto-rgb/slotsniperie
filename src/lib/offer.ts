/**
 * The customer offer. Every price and hold in the app reads these values.
 *
 * The bookings defaults in drizzle/migrations/0000_bookings_and_events.sql
 * (amount_cents 6000, expires_at + 2 hours) must stay equal to
 * SERVICE_FEE_CENTS and HOLD_HOURS. Inserts also set both columns from here.
 */
export const SERVICE_FEE_EUR = 60;
export const SERVICE_FEE_CENTS = SERVICE_FEE_EUR * 100;
export const HOLD_HOURS = 2;
export const HOLD_MS = HOLD_HOURS * 60 * 60 * 1000;

export function holdExpiresAt(from = Date.now()): string {
  return new Date(from + HOLD_MS).toISOString();
}

/** WhatsApp copy for a slot that is held, not paid. Must not say the test is confirmed. */
export function slotHeldWhatsAppText(
  slot: { centre: string; date: string; time: string },
  payUrl: string,
): string {
  return `Your test at ${slot.centre} on ${slot.date} at ${slot.time} is HELD for ${HOLD_HOURS}h. Pay €${SERVICE_FEE_EUR} to confirm: ${payUrl}`;
}
