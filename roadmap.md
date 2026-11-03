# Roadmap

## Done
- Landing page + checkout UI (black/red theme)
- Lovable Cloud: `bookings` + `bot_events` tables (bookings expire 2h after creation)
- POST /api/public/bot-event: one HMAC contract (`docs/bot-event-contract.md`, zod `BotEvent`). Required `event_id` + `timestamp` inside the signed body (reject older than 5 minutes or more than 5 minutes ahead). Missing or bad `x-bot-signature` → 401. Missing secret → 401. Missing `PUBLIC_SITE_URL` on a signed hold → 503. A finished `event_id` replays the stored `booking_id` and `pay_url`. A claim with no result yet is 425 `in_progress`; claims older than about 60s are taken over. Centres are matched case-insensitively. A pending hold past `expires_at` is expired before a new hold. Partial unique index on active slots (migration releases older duplicates first); conflict → 409. WhatsApp failure on a hold is 202. SLOT_LOCKED text says the slot is HELD for 2h and €60 is required to confirm. `markBookingPaid` returns `expired` when the hold has lapsed.
- POST /api/public/whatsapp-webhook (incoming messages stored)
- Server-side WhatsApp send helper
- Checkout page reads a real booking only. Unknown id → 404. Expired hold cannot be paid. Pay button is disabled ("Payment coming soon") and never fakes success. Stripe is not integrated. €60 and the 2-hour hold come from `src/lib/offer.ts`.
- Tests: routing, payload schema, signed event → booking, replay, stale timestamp, forged signature, slot 409, missing secret 503, unknown `/pay/:id` not-found, pay page shows the held booking with payment disabled

- Expiry cron (every 5 min): unpaid holds → expired + signed RELEASE_SLOT to worker; PAYMENT_SUCCESS signal helper (markBookingPaid) + retries
- RSA disclaimer in footer of landing and checkout

## Final split (agreed with user, Nov 2026)
- OTP collection and user interaction live entirely on the external backend; the frontend only receives final SLOT_LOCKED events (centre, date, time, candidate_id).
- No OTP relay or session endpoints here. Browser automation stays on the external worker.

## Blocked on user
- WORKER_WEBHOOK_URL (worker endpoint that accepts RELEASE_SLOT / PAYMENT_SUCCESS)
- WhatsApp Business connector + business number (landing CTA is a placeholder number)
- BOT_WEBHOOK_SECRET for the external worker (until it is set, bot-event answers 401). The worker must follow `docs/bot-event-contract.md`: path `/api/public/bot-event`, HMAC `x-bot-signature`, `centre`, required `event_id` and `timestamp`, €60, 2 hour hold. `PUBLIC_SITE_URL` must be set or a signed hold returns 503.
- A real payment provider. The pay button stays disabled until then. Do not fake a paid state. When a provider is added, its webhook should call `markBookingPaid`. A result of `expired` means the hold lapsed and the charge must be refunded. `paid` means the worker was told.
