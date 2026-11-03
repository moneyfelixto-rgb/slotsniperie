-- One pending or paid booking per driving-test slot.
-- Expired and released rows stay in the table but no longer block a new hold.
-- Price and hold defaults are in 0000 and must match src/lib/offer.ts
-- (SERVICE_FEE_CENTS = 6000, HOLD_HOURS = 2).
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot_uidx
  ON public.bookings (test_centre, test_date, test_time)
  WHERE status IN ('pending', 'paid');
