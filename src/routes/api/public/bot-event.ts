import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/bot-event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleBotEvent } = await import("@/lib/bot-event.server");
        return handleBotEvent(request);
      },
    },
  },
});
