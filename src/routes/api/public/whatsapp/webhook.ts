import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhookRequest } from "@lovable.dev/webhooks-js";

// Receives WhatsApp messages and delivery statuses forwarded by the Lovable connector.
export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.WHATSAPP_API_KEY;
        if (!secret) return new Response("Not configured", { status: 503 });
        let payload: unknown;
        try {
          ({ payload } = await verifyWebhookRequest({ req: request, secret, maxBodyBytes: 4 * 1024 * 1024 }));
        } catch {
          return new Response("Invalid signature", { status: 401 });
        }
        const deliveryId = request.headers.get("x-lovable-delivery");
        const event = request.headers.get("x-lovable-event");
        if (!deliveryId || !event) return new Response("Missing headers", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("bot_events")
          .upsert(
            { source: "whatsapp", event, delivery_id: deliveryId, payload: payload as never, processed_at: new Date().toISOString() },
            { onConflict: "delivery_id", ignoreDuplicates: true },
          );
        if (error) return new Response("DB error", { status: 500 });
        return new Response("ok");
      },
    },
  },
});
