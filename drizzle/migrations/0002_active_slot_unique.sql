-- One pending or paid booking per driving-test slot.
-- The centre column keeps the text the worker sent. Only the index expression
-- folds case, repeated whitespace, and NBSP (U+00A0), which Postgres \s misses.
-- That expression matches canonicalCentre() in src/lib/bot-event-contract.ts.
--
-- Dedupe keeps a paid booking over a pending one, a live hold over a lapsed one,
-- then the earliest created_at, then the lowest id. Lapsed pending rows are
-- marked expired first so the cron can notify the worker. Statuses outside the
-- allowed list are mapped to released so the CHECK does not abort the deploy.

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ;

UPDATE public.bookings
SET
  status = 'released',
  released_at = COALESCE(released_at, now())
WHERE status IS NULL
   OR status NOT IN ('pending', 'paid', 'expired', 'released');

UPDATE public.bookings
SET
  status = 'expired',
  released_at = COALESCE(released_at, now())
WHERE status = 'pending'
  AND expires_at <= now();

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        lower(btrim(regexp_replace(test_centre, '[[:space:]' || chr(160) || ']+', ' ', 'g'))),
        test_date,
        test_time
      ORDER BY (status = 'paid') DESC, (expires_at > now()) DESC, created_at ASC, id ASC
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
    lower(btrim(regexp_replace(test_centre, '[[:space:]' || chr(160) || ']+', ' ', 'g'))),
    test_date,
    test_time
  )
  WHERE status IN ('pending', 'paid');
