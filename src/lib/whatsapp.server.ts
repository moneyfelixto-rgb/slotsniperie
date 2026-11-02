const GATEWAY_URL = "https://connector-gateway.lovable.dev/whatsapp";

/** Sends a free-form WhatsApp text via the Lovable connector gateway. Returns the Meta message id. */
export async function sendWhatsAppText(toDigits: string, body: string): Promise<string> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const waKey = process.env.WHATSAPP_API_KEY;
  if (!lovableKey || !waKey) throw new Error("WhatsApp is not connected yet");
  const res = await fetch(`${GATEWAY_URL}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": waKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toDigits.replace(/\D/g, ""),
      type: "text",
      text: { body },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${text}`);
  return JSON.parse(text)?.messages?.[0]?.id ?? "";
}
