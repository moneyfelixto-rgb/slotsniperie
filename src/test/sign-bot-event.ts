import { BOT_SIGNATURE_HEADER } from "@/lib/bot-event-contract";
import { hmacHex } from "@/lib/hmac";

export const TEST_WEBHOOK_SECRET = "test-secret";

export function freshTimestamp(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function lockedEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "evt-locked-1",
    timestamp: freshTimestamp(),
    status: "SLOT_LOCKED" as const,
    phone: "+353861234567",
    centre: "Tallaght",
    date: "2026-11-10",
    time: "10:30",
    reference: "RSA-123",
    candidate_id: "C-77",
    ...overrides,
  };
}

export async function signedBotEventRequest(
  body: unknown,
  options: { secret?: string; signature?: string } = {},
) {
  const raw = JSON.stringify(body);
  const secret = options.secret ?? TEST_WEBHOOK_SECRET;
  const signature = options.signature ?? (await hmacHex(secret, raw));
  return new Request("https://slotsniper.test/api/public/bot-event", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [BOT_SIGNATURE_HEADER]: signature,
    },
    body: raw,
  });
}
