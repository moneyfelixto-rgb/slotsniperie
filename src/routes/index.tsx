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
    <main className="grid-bg min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-6">
        <header className="flex items-center justify-between border-b border-border pb-4 font-mono text-xs uppercase tracking-widest">
          <span>Slot<span className="text-primary">/</span>Sniper</span>
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="blink size-2 bg-primary" /> Live · IE
          </span>
        </header>

        <section className="flex flex-1 flex-col justify-center py-12">
          <p className="mb-4 font-mono text-xs uppercase tracking-widest text-primary">// RSA driving test</p>
          <h1 className="text-[2.6rem] font-bold leading-[1.02] tracking-tight">
            Get Your Irish Driving Test <span className="text-primary">Next Week.</span> Pay Only When Booked.
          </h1>
          <p className="mt-6 text-base leading-relaxed text-muted-foreground">
            Zero apps to download. Zero upfront fees. Free real-time slot alerts via WhatsApp. Pay €60 only after our bot successfully secures your test slot.
          </p>
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="glow mt-8 flex h-16 items-center justify-between bg-primary px-6 text-lg font-bold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            Start Free via WhatsApp <span aria-hidden>→</span>
          </a>
          <ul className="mt-6 grid grid-cols-3 border border-border font-mono text-[10px] uppercase tracking-wider">
            {["Pay-On-Success", "RSA Compliant Flow", "100% Secured"].map((b, i) => (
              <li key={b} className={`flex items-center gap-1.5 p-3 ${i ? "border-l border-border" : ""}`}>
                <span className="text-primary">✓</span>{b}
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-border">
          {steps.map(([n, t, d]) => (
            <div key={n} className="flex gap-4 border-b border-border py-5">
              <span className="font-mono text-sm text-primary">{n}</span>
              <div>
                <h2 className="font-bold">{t}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{d}</p>
              </div>
            </div>
          ))}
        </section>
        <footer className="pt-6 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Independent service · Not affiliated with the RSA
        </footer>
      </div>
    </main>
  );
}
