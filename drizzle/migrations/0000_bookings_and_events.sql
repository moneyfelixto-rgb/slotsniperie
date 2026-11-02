CREATE TABLE public.bookings (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  test_centre TEXT NOT NULL,
  test_date DATE NOT NULL,
  test_time TEXT NOT NULL,
  reference TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 6000,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '2 hours',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.bot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  event TEXT NOT NULL,
  delivery_id TEXT UNIQUE,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.bot_events TO service_role;
ALTER TABLE public.bot_events ENABLE ROW LEVEL SECURITY;