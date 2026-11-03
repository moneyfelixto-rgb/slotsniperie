import { createFileRoute } from "@tanstack/react-router";
import { BookingNotFound, PayPageView } from "@/components/pay-page";
import { loadPayPage } from "@/lib/load-pay-page";
import { HOLD_HOURS, SERVICE_FEE_EUR } from "@/lib/offer";

export const Route = createFileRoute("/pay/$id")({
  loader: ({ params }) => loadPayPage(params.id),
  notFoundComponent: BookingNotFound,
  head: ({ params }) => ({
    meta: [
      { title: `Your held test slot — ${params.id.toUpperCase()}` },
      {
        name: "description",
        content: `Your driving test slot is held for ${HOLD_HOURS} hours. The fee is €${SERVICE_FEE_EUR} when payment is available.`,
      },
      { property: "og:title", content: "Your driving test slot is held" },
      {
        property: "og:description",
        content: `Held for ${HOLD_HOURS} hours. €${SERVICE_FEE_EUR} when you pay to confirm.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PayPage,
});

function PayPage() {
  const booking = Route.useLoaderData();
  return <PayPageView booking={booking} />;
}
