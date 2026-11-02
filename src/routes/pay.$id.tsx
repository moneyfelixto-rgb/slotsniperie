import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

const FEE = 60;
const HOLD_SECONDS = 2 * 60 * 60 - 60; // 01:59:00

// Demo booking lookup — replace with a real server lookup once the bot backend exists.
function getBooking(id: string) {
  const centres = ["Finglas", "Tallaght", "Raheny", "Churchtown", "Mulhuddart"];
  const n = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    ref: id.toUpperCase(),
    centre: centres[n % centres.length] ?? "Finglas",
    date: "Tue, 10 Nov 2026",
    time: `${9 + (n % 7)}:${n % 2 ? "30" : "00"}`,
    driver: "S. Murphy",
    licence: "•••• 4821",
  };
}

export const Route = createFileRoute("/pay/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Confirm your test slot — ${params.id.toUpperCase()}` },
      { name: "description", content: "Your driving test slot is held. Pay the €60 service fee to confirm." },
      { property: "og:title", content: "Your driving test slot is held" },
      { property: "og:description", content: "Pay €60 to confirm before auto-release." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PayPage,
});

const fmt = (s: number) =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, "0")).join(":");

function PayPage() {
  const { id } = Route.useParams();
  const b = getBooking(id);
  const [left, setLeft] = useState(HOLD_SECONDS);
  const [state, setState] = useState<"idle" | "revolut" | "stripe" | "paid">("idle");

  useEffect(() => {
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const pay = (m: "revolut" | "stripe") => {
    setState(m);
    setTimeout(() => setState("paid"), 1600); // demo — wire to real payment provider
  };

  const rows: [string, string][] = [
    ["Test centre", b.centre],
    ["Date", b.date],
    ["Time", b.time],
    ["Driver", b.driver],
    ["Licence", b.licence],
    ["Reference", b.ref],
  ];

  if (state === "paid") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-8 animate-in fade-in zoom-in-95">
        <div className="glow mb-8 flex size-16 items-center justify-center bg-primary text-3xl font-bold text-primary-foreground">✓</div>
        <h1 className="text-4xl font-bold leading-tight">Slot confirmed.</h1>
        <p className="mt-4 text-muted-foreground">
          €{FEE} received. Your test at <span className="text-foreground">{b.centre}</span> on {b.date} at {b.time} is locked in.
        </p>
        <div className="mt-8 border border-primary p-4 text-sm">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Next step</p>
          <p className="mt-2">Check your inbox for the official RSA confirmation email. It can take up to 30 minutes — check spam too.</p>
        </div>
        <button
          onClick={() => window.print()}
          className="mt-6 h-14 border border-border font-bold transition-colors hover:border-primary hover:text-primary"
        >
          Download receipt ↓
        </button>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Ref {b.ref} · Receipt also sent on WhatsApp</p>
      </main>
    );
  }

  const expired = left === 0;
  const busy = state !== "idle";

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 py-6">
      <header className="flex items-center justify-between border-b border-border pb-4 font-mono text-xs uppercase tracking-widest">
        <span>Slot<span className="text-primary">/</span>Sniper</span>
        <span className="text-muted-foreground">🔒 Secure checkout</span>
      </header>

      <div className={`mt-6 border p-4 ${expired ? "border-destructive" : "border-primary"}`}>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {expired ? "Hold expired" : "Slot held before auto-release"}
        </p>
        <p className={`mt-1 font-mono text-4xl font-bold tabular-nums ${expired ? "text-destructive" : "text-primary"}`}>{fmt(left)}</p>
      </div>

      <h1 className="mt-8 text-3xl font-bold leading-tight">We got your slot.</h1>
      <p className="mt-2 text-sm text-muted-foreground">Confirm with a one-time €{FEE} service fee.</p>

      <dl className="mt-6 border border-border bg-card">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-border px-4 py-3 text-sm last:border-b-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-mono font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex items-baseline justify-between border-t-2 border-primary pt-4">
        <span className="font-mono text-xs uppercase tracking-widest">Total</span>
        <span className="text-3xl font-bold">€{FEE}.00</span>
      </div>

      <div className="mt-6 space-y-3">
        <button
          disabled={busy || expired}
          onClick={() => pay("revolut")}
          className="glow flex h-16 w-full items-center justify-center bg-primary text-lg font-bold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {state === "revolut" ? <span className="blink">Processing…</span> : "Pay with Revolut Pay"}
        </button>
        <button
          disabled={busy || expired}
          onClick={() => pay("stripe")}
          className="flex h-16 w-full items-center justify-center border border-foreground text-lg font-bold transition-colors hover:border-primary hover:text-primary active:scale-[0.98] disabled:opacity-40"
        >
          {state === "stripe" ? <span className="blink">Processing…</span> : "Pay by card · Apple Pay"}
        </button>
      </div>
      <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Encrypted · No charge if the slot is lost
      </p>
    </main>
  );
}
