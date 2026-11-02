# Roadmap

## Done
- Landing page + checkout UI (black/red theme)
- Lovable Cloud: `bookings` + `bot_events` tables (bookings expire 2h after creation)
- POST /api/public/bot-event (HMAC-signed): SESSION_ACTIVE, SLOT_FOUND, SLOT_LOCKED / BOOKING_CONFIRMED → booking_id + /pay/:id + WhatsApp link
- POST /api/public/whatsapp-webhook (incoming messages stored)
- Server-side WhatsApp send helper
- Checkout page reads the real booking from DB, 2h expiry from DB
- Tests: routing for / and /pay/:id, bot-event payload validation (SLOT_LOCKED accepted, unknown/missing fields rejected)

- Expiry cron (every 5 min): unpaid holds → expired + signed RELEASE_SLOT to worker; PAYMENT_SUCCESS signal helper (markBookingPaid) + retries
- RSA disclaimer in footer of landing and checkout

## Final split (agreed with user, Nov 2026)
- OTP collection and user interaction live entirely on the external backend; the frontend only receives final SLOT_LOCKED events (centre, date, time, candidate_id).
- No OTP relay or session endpoints here. Browser automation stays on the external worker.

## Blocked on user
- WORKER_WEBHOOK_URL (worker endpoint that accepts RELEASE_SLOT / PAYMENT_SUCCESS)
- Stripe webhook → markBookingPaid (after Stripe is enabled)
- WhatsApp Business connector + business number (landing CTA is a placeholder number)
- BOT_WEBHOOK_SECRET for the external worker (endpoint returns 503 until it is set)
- Stripe / Revolut Pay enablement (needs Pro plan + account form); pay buttons are demo-only
