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
| Body | UTF-8 JSON, at most 20 000 **bytes** (UTF-8 length, not UTF-16 characters). The server does not re-serialize the JSON before checking the signature. Sign the exact bytes you send. |
| Freshness | `timestamp` must be within 5 minutes of the server clock, past or future. Older or further-ahead requests are rejected even when the signature is valid. |

### Envelope

| Field | Required | Notes |
|---|---|---|
| `event_id` | always | 1–100 characters. Unique per delivery. Retries of the same delivery reuse the same id. |
| `timestamp` | always | ISO-8601 with a timezone, e.g. `2026-11-03T18:04:00.000Z`. |
| `status` | always | `SESSION_ACTIVE`, `SLOT_FOUND`, `SLOT_LOCKED`, or `BOOKING_CONFIRMED`. |
| `phone` | slot events | `+` optional, 8–15 digits. |
| `centre` | slot events | Test centre name, 2–60 characters. Stored with surrounding space removed, repeated spaces collapsed, and letters lower-cased. `Tallaght` and ` tallaght ` are the same slot. |
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
| 200 | Same `event_id` again, after the first attempt stored a result. Deduping is permanent, not limited to 5 minutes. No second booking and no second WhatsApp. | The stored body, including `booking_id` and `pay_url` when a hold was created, plus `"duplicate": true`. |
| 202 | Accepted, but the WhatsApp send failed. For `SLOT_LOCKED` the booking still exists and the body includes `booking_id` and `pay_url`. | `{ "ok": true, "whatsapp": "<error>", ... }` |
| 400 | Body is not the schema above. | `{ "ok": false, "reason": "bad_json" }` or `{ "ok": false, "error": ... }` |
| 401 | Missing signature, bad signature, stale timestamp, or timestamp too far in the future. | `missing_signature`, `invalid_signature`, `timestamp_stale`, `timestamp_future` |
| 409 | Another pending or paid booking already has this centre, date, and time. A pending row whose hold has already passed `expires_at` is expired first, so it does not block. | `{ "ok": false, "reason": "slot_taken" }` |
| 425 | This `event_id` is claimed and the first attempt has not stored a result yet. Not success. Retry the same `event_id`. | `{ "ok": false, "reason": "in_progress" }` |
| 413 | Body longer than 20 000 UTF-8 bytes. | `{ "ok": false, "reason": "too_large" }` |
| 503 | `BOT_WEBHOOK_SECRET` is missing, or `PUBLIC_SITE_URL` is missing for a hold. The site does not invent a pay host from the request. Not success. Retry later. | `{ "ok": false, "reason": "not_configured" }` |

The 5-minute window is only about `timestamp`. It does not expire an `event_id`. Replaying the original bytes after 5 minutes is **401** `timestamp_stale`. Send the **same `event_id` with a new timestamp** (and sign those new bytes). If the first attempt finished, the response is the stored result plus `duplicate: true`, including `booking_id` and `pay_url`. If the first attempt is still in progress and younger than about 60 seconds, the response is **425** `in_progress`. If that claim is older than about 60 seconds and still has no stored result, the site takes it over and finishes it.

Do not invent a new `event_id` for a slot you already sent. A second id for a slot that is already pending or paid is **409** `slot_taken`.

## Slot uniqueness

Migration `drizzle/migrations/0002_active_slot_unique.sql` releases every active duplicate except the earliest, then adds a partial unique index on the normalised centre, date, and time where `status` is `pending` or `paid`. `status` is constrained to `pending`, `paid`, `expired`, or `released`. An expired hold does not block that slot: the handler marks a pending row past `expires_at` as expired before inserting.

`PUBLIC_SITE_URL` is required. The pay link is `{PUBLIC_SITE_URL}/pay/{booking_id}`. The page does not take payment yet. The hold lasts 2 hours from creation. The fee is €60.

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
4. Send one `event_id` per delivery and a `timestamp` inside the signed JSON. A retry keeps that `event_id`. Within 5 minutes the same bytes are fine. After that, keep the `event_id` and put a fresh `timestamp` in newly signed bytes. A finished delivery returns the stored `booking_id` and `pay_url`.
5. Treat **503** as "not configured", **401** `invalid_signature` as a config error, **401** `timestamp_stale` as "resend the same event_id with a fresh timestamp", **425** `in_progress` as "retry shortly", and **409** `slot_taken` as "do not open another hold". None of those are success. **202** means the hold exists and WhatsApp failed; keep `booking_id` and `pay_url`.
6. Use **€60** and a **2 hour** hold everywhere (payment links included). This site ignores a `token` query on `/pay/:id`.
7. `SLOT_LOCKED` means held, waiting for €60. The WhatsApp text from this site says HELD, not confirmed. Do not describe the slot as confirmed before the fee is paid.
