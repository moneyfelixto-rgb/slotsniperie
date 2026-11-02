import { createFileRoute } from "@tanstack/react-router";

// TODO: replace with the real WhatsApp Business number (international format, digits only)
const WA_NUMBER = "353000000000";
const WA_LINK = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent("Hi, I want to find a driving test slot in Dublin")}`;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Driving Slot Sniper — Irish Driving Test Next Week" },
      { name: "description", content: "Free real-time RSA driving test slot alerts via WhatsApp. Pay €60 only after your test is booked." },
      { property: "og:title", content: "Driving Slot Sniper — Pay Only When Booked" },
      { property: "og:description", content: "Free WhatsApp slot alerts for Irish driving tests. €60 only after we secure your slot." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const steps = [
  ["01", "Message the bot", "Pick your test centres and dates on WhatsApp."],
  ["02", "We hunt 24/7", "Cancelled slots are caught the second they appear."],
  ["03", "Pay on success", "€60 only once your slot is secured. Nothing before."],
];

function Index() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-6">
        <header className="flex items-center justify-between border-b border-border pb-4">
          <span className="text-sm font-bold tracking-tight">
            Slot<span className="text-primary">.</span>Sniper
          </span>
          <span className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[11px] font-medium text-muted-foreground">
            <span className="blink size-1.5 rounded-full bg-primary" /> Live · Ireland
          </span>
        </header>

        <section className="flex flex-1 flex-col justify-center py-12">
          <span className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            Real-time RSA slot alerts
          </span>
          <h1 className="text-[2.5rem] font-bold leading-[1.08] tracking-tight">
            Get Your Irish Driving Test <span className="text-primary">Next Week.</span> Pay Only When Booked.
          </h1>
          <p className="mt-6 text-base leading-relaxed text-muted-foreground">
            Zero apps to download. Zero upfront fees. Free real-time slot alerts via WhatsApp. Pay €60 only after our bot successfully secures your test slot.
          </p>
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="glow mt-8 flex h-16 items-center justify-between rounded-2xl bg-primary px-6 text-lg font-bold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            Start Free via WhatsApp <span aria-hidden>→</span>
          </a>
          <ul className="mt-6 grid grid-cols-3 gap-2 text-[11px] font-medium text-muted-foreground">
            {["Pay on success", "RSA compliant flow", "Secure checkout"].map((b) => (
              <li key={b} className="rounded-xl border border-border bg-card p-3 leading-snug">
                <span className="text-primary">✓</span> {b}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          {steps.map(([n, t, d], i) => (
            <div key={n} className={`flex gap-4 py-4 ${i ? "border-t border-border" : ""}`}>
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{n}</span>
              <div>
                <h2 className="font-bold">{t}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</p>
              </div>
            </div>
          ))}
        </section>
        <footer className="pt-6 text-center text-[11px] text-muted-foreground">
          We are an independent assistance service helping candidates secure test slots. Not affiliated with the Road Safety Authority (RSA).
        </footer>
      </div>
    </main>
  );
}
