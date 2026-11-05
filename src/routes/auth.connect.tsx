import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { backendConnectUrl } from "@/lib/backend";

// Handoff only: the live login session runs entirely on the external backend's own page.
export const Route = createFileRoute("/auth/connect")({
  validateSearch: z.object({ token: z.string().max(500).optional() }),
  head: () => ({
    meta: [
      { title: "Connect your MyRoadSafety account — Slot Sniper" },
      { name: "description", content: "Securely connect your account to enable optional auto-book." },
      { property: "og:title", content: "Connect your account — Slot Sniper" },
      { property: "og:description", content: "Enable optional auto-book from WhatsApp." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Connect,
});

function Connect() {
  const { token } = Route.useSearch();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-8">
      <div className="font-display text-2xl font-bold uppercase"><span className="text-primary">Slot</span> Sniper</div>
      <h1 className="mt-8 font-display text-4xl font-extrabold uppercase leading-none">Connect your account</h1>
      {token ? (
        <>
          <p className="mt-4 text-muted-foreground">Auto-book is optional. Alerts keep working without it. You'll continue on our secure connection page.</p>
          <a href={backendConnectUrl(token)} className="bg-cta glow mt-8 flex h-14 items-center justify-center rounded-full font-semibold uppercase tracking-wide text-primary-foreground">
            Continue →
          </a>
        </>
      ) : (
        <p className="mt-4 text-muted-foreground">This link is missing its token. Open the latest "Auto-book ⚡" link from our WhatsApp bot.</p>
      )}
      <p className="mt-8 text-[11px] text-muted-foreground">Independent service. Not affiliated with the Road Safety Authority (RSA).</p>
    </main>
  );
}
