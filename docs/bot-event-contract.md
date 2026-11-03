# Bot → site event contract

The Python worker (and only the worker) tells this site about a session or a slot by posting one JSON object to:

`POST /api/public/bot-event`

There is one envelope. `event_id` and `timestamp` are always required. The HMAC is over the raw body, so the timestamp cannot be changed without breaking the signature.

The machine-readable schema is `BotEvent` in `src/lib/bot-event-contract.ts`. Price and hold length are `SERVICE_FEE_EUR` (60) and `HOLD_HOURS` (2) in `src/lib/offer.ts`.

This site does not collect OTPs, logins, or browser sessions. Those stay on the worker.

## Request

| | |
|---|---|
| Header | `x-bot-signature`: lowercase hex HMAC-SHA256 of the **raw body bytes**, keyed with `BOT_WEBHOOK_SECRET`. No `sha256=` prefix. |
| Body | UTF-8 JSON, at most 20 000 bytes. The server does not re-serialize it before checking the signature. Sign the exact bytes you send. |
| Freshness | `timestamp` must be within 5 minutes of the server clock, past or future. Older or further-ahead requests are rejected even when the signature is valid. |

### Envelope

| Field | Required | Notes |
|---|---|---|
| `event_id` | always | 1–100 characters. Unique per delivery. Retries of the same delivery reuse the same id. |
| `timestamp` | always | ISO-8601 with a timezone, e.g. `2026-11-03T18:04:00.000Z`. |
| `status` | always | `SESSION_ACTIVE`, `SLOT_FOUND`, `SLOT_LOCKED`, or `BOOKING_CONFIRMED`. |
| `phone` | slot events | `+` optional, 8–15 digits. |
| `centre` | slot events | Test centre name, 2–60 characters. Matched exactly, after trim. |
| `date` | slot events | `YYYY-MM-DD`. |
| `time` | slot events | `H:MM` or `HH:MM`, 24-hour. Stored as `HH:MM`, so `9:05` and `09:05` are the same slot. |
| `reference` | no | RSA reference, max 40 characters. `SLOT_LOCKED` / `BOOKING_CONFIRMED` only. |
| `candidate_id` | no | Max 40 characters. Same statuses. |

`BOOKING_CONFIRMED` is an alias of `SLOT_LOCKED`. Both mean the slot is **held** pending the €60 fee. Neither means the customer has paid.

`SESSION_ACTIVE` has no slot fields. `SLOT_FOUND` notifies WhatsApp and does not create a booking. `SLOT_LOCKED` and `BOOKING_CONFIRMED` create one pending booking, a `/pay/:id` link, and one WhatsApp message.

### Example

```json
{
  "event_id": "evt-locked-001",
  "timestamp": "2026-11-03T18:04:00.000Z",
  "status": "SLOT_LOCKED",
  "phone": "+353861234567",
  "centre": "Finglas",
  "date": "2026-11-10",
  "time": "10:30",
  "reference": "RSA-123",
  "candidate_id": "C-77"
}
```

## Responses

| Status | When | Body |
|---|---|---|
| 200 | Accepted. `SLOT_LOCKED` includes `booking_id` and `pay_url`. | `{ "ok": true, ... }` |
| 200 | Same `event_id` seen again inside the 5-minute window. No second booking and no second WhatsApp. | The first body plus `"duplicate": true`. `whatsapp` is `"duplicate"`. |
| 202 | Accepted, but the WhatsApp send failed. The booking, if any, still exists. | `{ "ok": true, "whatsapp": "<error>" }` |
| 400 | Body is not the schema above. | `{ "ok": false, "reason": "bad_json" }` or `{ "ok": false, "error": ... }` |
| 401 | Missing signature, bad signature, stale timestamp, or timestamp too far in the future. | `missing_signature`, `invalid_signature`, `timestamp_stale`, `timestamp_future` |
| 409 | Another pending or paid booking already has this centre, date, and time. | `{ "ok": false, "reason": "slot_taken" }` |
| 413 | Body longer than 20 000 bytes. | `{ "ok": false, "reason": "too_large" }` |
| 503 | `BOT_WEBHOOK_SECRET` is not set. This is not success. Retry later. | `{ "ok": false, "reason": "not_configured" }` |

A replay after the timestamp is older than 5 minutes is **401** `timestamp_stale`. That still does not create a second booking. Do not invent a new `event_id` for a slot you already sent: if the first request created the hold, the new id returns **409** `slot_taken`.

Concurrent duplicates that arrive before the first request finishes return `{ "ok": true, "duplicate": true }` and do not send another WhatsApp.

## Slot uniqueness

Migration `drizzle/migrations/0002_active_slot_unique.sql` adds a partial unique index on `(test_centre, test_date, test_time)` where `status` is `pending` or `paid`. An expired hold no longer blocks that slot.

The pay link is `{PUBLIC_SITE_URL}/pay/{booking_id}`. The page does not take payment yet. The hold lasts 2 hours from creation. The fee is €60.

## Reference signer (Python)

```python
#!/usr/bin/env python3
"""Sign one SLOT_LOCKED event for POST /api/public/bot-event.

The signature is HMAC-SHA256 over the exact request bytes, lowercase hex.
`timestamp` is inside those bytes, so editing it invalidates the signature.
"""

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from urllib.request import Request, urlopen

secret = os.environ["BOT_WEBHOOK_SECRET"].encode()
url = os.environ.get("SITE_URL", "https://slotsniperie.lovable.app").rstrip("/") + "/api/public/bot-event"

body = {
    "event_id": "evt-locked-001",
    "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    "status": "SLOT_LOCKED",
    "phone": "+353861234567",
    "centre": "Finglas",
    "date": "2026-11-10",
    "time": "10:30",
    "reference": "RSA-123",
    "candidate_id": "C-77",
}

raw = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()
signature = hmac.new(secret, raw, hashlib.sha256).hexdigest()

request = Request(
    url,
    data=raw,
    method="POST",
    headers={"Content-Type": "application/json", "x-bot-signature": signature},
)

with urlopen(request, timeout=10) as response:
    print(response.status, response.read().decode())
```

Check the signer against a fixed body:

```python
import hashlib, hmac
raw = b'{"event_id":"evt-1","timestamp":"2026-11-03T18:00:00.000Z","status":"SESSION_ACTIVE"}'
print(hmac.new(b"test-secret", raw, hashlib.sha256).hexdigest())
```

## What the Python backend must change

The worker client audited on 3 Nov 2026 does not speak this contract. Until it does, every event is rejected and no pay page is created.

1. Post to `/api/public/bot-event`, not `/api/bot-event`.
2. Send `x-bot-signature` (hex HMAC of the raw body). Do not use `Authorization: Bearer`.
3. Use `centre`, not `center`. Include `phone`. Put `status` at the top level, not under `metadata`.
4. Send a new `event_id` per delivery and a `timestamp` inside the signed JSON. Retry the same bytes, including the same `event_id`, within 5 minutes.
5. Treat **503** as "not configured", **401** as "bad signature or stale timestamp", and **409** as "this slot is already held or paid". None of those are success.
6. Use **€60** and a **2 hour** hold everywhere (payment links included). This site ignores a `token` query on `/pay/:id`.
7. `SLOT_LOCKED` means held, waiting for €60. The WhatsApp text from this site says HELD, not confirmed. Do not describe the slot as confirmed before the fee is paid.
