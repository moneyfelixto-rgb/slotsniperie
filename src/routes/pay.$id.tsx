import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getBooking } from "@/lib/bookings.functions";

const FEE = 60;

export const Route = createFileRoute("/pay/$id")({
  loader: async ({ params }) => {
    const b = await getBooking({ data: { id: params.id } }).catch(() => null);
    if (b) {
      return {
        demo: false,
        ref: b.reference ?? b.id,
        centre: b.test_centre,
        date: new Date(b.test_date).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
        time: b.test_time,
        expiresAt: new Date(b.expires_at).getTime(),
        paid: b.status === "paid",
      };
    }
    return {
      demo: true,
      ref: params.id.toUpperCase(),
      centre: "Finglas",
      date: "Tue, 10 Nov 2026",
      time: "10:30",
      expiresAt: Date.now() + 2 * 3600 * 1000 - 60_000,
      paid: false,
    };
  },
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
  const b = Route.useLoaderData();
  const calc = () => Math.max(0, Math.floor((b.expiresAt - Date.now()) / 1000));
  const [left, setLeft] = useState(7140);
  const [state, setState] = useState<"idle" | "revolut" | "stripe" | "paid">(b.paid ? "paid" : "idle");

  useEffect(() => {
    setLeft(calc());
    const t = setInterval(() => setLeft(calc()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.expiresAt]);

  const pay = (m: "revolut" | "stripe") => {
    setState(m);
    setTimeout(() => setState("paid"), 1600); // demo — real payments connect later
  };

  const rows: [string, string][] = [
    ["Test centre", b.centre],
    ["Date", b.date],
    ["Time", b.time],
    ["Reference", b.ref],
  ];

  if (state === "paid") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-8 animate-in fade-in zoom-in-95">
        <div className="glow mb-8 flex size-16 items-center justify-center rounded-2xl bg-primary text-3xl font-bold text-primary-foreground">✓</div>
        <h1 className="text-4xl font-bold leading-tight">Slot confirmed.</h1>
        <p className="mt-4 text-muted-foreground">
          €{FEE} received. Your test at <span className="text-foreground">{b.centre}</span> on {b.date} at {b.time} is locked in.
        </p>
        <div className="mt-8 rounded-2xl border border-primary/40 bg-primary/5 p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Next step</p>
          <p className="mt-2 leading-relaxed">Check your inbox for the official RSA confirmation email. It can take up to 30 minutes — check spam too.</p>
        </div>
        <button
          onClick={() => window.print()}
          className="mt-6 h-14 rounded-2xl border border-border font-bold transition-colors hover:border-primary hover:text-primary"
        >
          Download receipt ↓
        </button>
        <p className="mt-6 text-center text-[11px] text-muted-foreground">Ref {b.ref} · Receipt also sent on WhatsApp</p>
      </main>
    );
  }

  const expired = left === 0;
  const busy = state !== "idle";

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 py-6">
      <header className="flex items-center justify-between border-b border-border pb-4">
        <span className="text-sm font-bold tracking-tight">
          Slot<span className="text-primary">.</span>Sniper
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">🔒 Secure checkout</span>
      </header>

      <div className={`mt-6 rounded-2xl border p-5 ${expired ? "border-destructive" : "border-primary/40 bg-primary/5"}`}>
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {expired ? "Hold expired" : "Slot held before auto-release"}
        </p>
        <p className={`mt-1 font-mono text-4xl font-bold tabular-nums ${expired ? "text-destructive" : "text-foreground"}`}>{fmt(left)}</p>
      </div>

      <h1 className="mt-8 text-3xl font-bold leading-tight">We got your slot.</h1>
      <p className="mt-2 text-sm text-muted-foreground">Confirm with a one-time €{FEE} service fee.</p>

      <dl className="mt-6 rounded-2xl border border-border bg-card">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-border px-4 py-3 text-sm last:border-b-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex items-baseline justify-between rounded-2xl border-t-2 border-primary pt-4">
        <span className="text-xs font-semibold uppercase tracking-wider">Total</span>
        <span className="text-3xl font-bold">€{FEE}.00</span>
      </div>

      <div className="mt-6 space-y-3">
        <button
          disabled={busy || expired}
          onClick={() => pay("revolut")}
          className="glow flex h-16 w-full items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {state === "revolut" ? <span className="blink">Processing…</span> : "Pay with Revolut Pay"}
        </button>
        <button
          disabled={busy || expired}
          onClick={() => pay("stripe")}
          className="flex h-16 w-full items-center justify-center rounded-2xl border border-foreground text-lg font-bold transition-colors hover:border-primary hover:text-primary active:scale-[0.98] disabled:opacity-40"
        >
          {state === "stripe" ? <span className="blink">Processing…</span> : "Pay by card · Apple Pay"}
        </button>
      </div>
      <p className="mt-6 text-center text-[11px] text-muted-foreground">Encrypted · No charge if the slot is lost</p>
    </main>
  );
}
