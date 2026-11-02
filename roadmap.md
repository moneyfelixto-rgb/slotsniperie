# Roadmap

## Done
- Landing page + checkout UI (black/red theme)

## In progress
- Lovable Cloud enabled; bookings table
- POST /api/public/bot-event (signed; SLOT_FOUND, BOOKING_CONFIRMED, SESSION_ACTIVE) -> creates booking + /pay/:id link
- POST /api/public/whatsapp-webhook (incoming messages stored)
- Server-side WhatsApp send helper
- Checkout page reads real booking from DB, 2h expiry from DB

## Declined (policy)
- Passing user OTP to a worker to auto-login to RSA, Cloudflare/proxy evasion statuses (RATE_LIMITED_RETRY handling). Bot finds slots; the user books themselves.

## Blocked on user
- WhatsApp Business connection (connector) + business number
- BOT_WEBHOOK_SECRET for the external worker
- Stripe / Revolut Pay enablement (needs Pro plan + account form)
