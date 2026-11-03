-- One pending or paid booking per driving-test slot.
-- Centre is compared case-insensitively, with surrounding and repeated spaces collapsed,
-- matching canonicalCentre() in src/lib/bot-event-contract.ts.
-- If production already has two active rows for one slot, keep the earliest and release the rest
-- so CREATE UNIQUE INDEX can succeed.

UPDATE public.bookings
SET test_centre = lower(btrim(regexp_replace(test_centre, '\s+', ' ', 'g')))
WHERE status IN ('pending', 'paid');

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY test_centre, test_date, test_time
      ORDER BY created_at ASC, id ASC
    ) AS n
  FROM public.bookings
  WHERE status IN ('pending', 'paid')
)
UPDATE public.bookings AS b
SET
  status = 'released',
  released_at = COALESCE(b.released_at, now())
FROM ranked AS r
WHERE b.id = r.id
  AND r.n > 1;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'paid', 'expired', 'released'));

CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot_uidx
  ON public.bookings (
    lower(btrim(regexp_replace(test_centre, '\s+', ' ', 'g'))),
    test_date,
    test_time
  )
  WHERE status IN ('pending', 'paid');
