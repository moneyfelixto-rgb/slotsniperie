import { createFileRoute } from "@tanstack/react-router";
import nightVideo from "@/assets/videos/car_night_road.mp4.asset.json";
import duskVideo from "@/assets/videos/car_country_dusk.mp4.asset.json";
import { HOLD_HOURS, SERVICE_FEE_EUR } from "@/lib/offer";

// TODO: replace with the real WhatsApp Business number (international format, digits only)
const WA_NUMBER = "353000000000";
const WA_LINK = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent("Hi, I want to find a driving test slot in Dublin")}`;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Driving Slot Sniper — Irish Driving Test Next Week" },
      { name: "description", content: `Free real-time RSA driving test slot alerts via WhatsApp. Pay €${SERVICE_FEE_EUR} only after your test is booked.` },
      { property: "og:title", content: "Driving Slot Sniper — Pay Only When Booked" },
      { property: "og:description", content: `Free WhatsApp slot alerts for Irish driving tests. €${SERVICE_FEE_EUR} only after we secure your slot.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const steps = [
  ["01", "Message the bot", "Pick your test centres and dates on WhatsApp."],
  ["02", "We hunt 24/7", "Cancelled slots are caught the second they appear."],
  ["03", "Optional auto-book", `Connect your account and we try to hold a slot for you. €${SERVICE_FEE_EUR} only if one is held.`],
];

const faq: [string, string][] = [
  ["Do alerts cost anything?", "No. WhatsApp slot alerts are free."],
  ["Is a booking guaranteed?", "No. Auto-book depends on your connected MyRoadSafety session and slot availability. You pay nothing unless a slot is held."],
  ["When do I pay €60?", "Only after a slot is held for you. You get a payment link on WhatsApp and have 2 hours to confirm."],
  ["Are you the RSA?", "No. We are an independent assistance service, not affiliated with the Road Safety Authority."],
];

function Index() {
  return (
    <main className="min-h-screen bg-background">
      <section className="relative isolate min-h-screen overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <video src={nightVideo.url} autoPlay muted loop playsInline onLoadedMetadata={(e) => (e.currentTarget.playbackRate = 0.6)} className="absolute inset-0 size-full object-cover" />
          <video src={duskVideo.url} autoPlay muted loop playsInline onLoadedMetadata={(e) => (e.currentTarget.playbackRate = 0.6)} className="fade-swap absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 bg-background/75" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-background/70" />
        </div>

        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-5 md:px-10">
          <header className="flex items-center justify-between">
            <div className="leading-none">
              <div className="font-display text-2xl font-bold uppercase tracking-tight">
                <span className="text-primary">Slot</span> Sniper
              </div>
              <div className="mt-1 text-[11px] tracking-[0.3em] text-muted-foreground">IRELAND</div>
            </div>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="bg-cta glow rounded-full px-5 py-3 text-sm font-semibold tracking-wide text-primary-foreground">
              WhatsApp
            </a>
          </header>

          <div className="flex flex-1 flex-col justify-center py-14">
            <span className="mb-8 inline-flex w-fit items-center gap-3 rounded-full border border-primary/30 bg-background/40 px-4 py-2 text-sm text-foreground/90 backdrop-blur">
              <span className="blink size-2 rounded-full bg-primary" /> Real-time RSA slot alerts · Ireland
            </span>
            <h1 className="font-display text-6xl font-extrabold uppercase leading-[0.9] tracking-tight md:text-8xl">
              Your driving test.
              <br />
              <span className="text-cta italic">Next week.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              Zero apps. Zero upfront fees. Free real-time slot alerts on WhatsApp — pay €60 only after your test slot is secured.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="bg-cta glow flex h-16 items-center justify-center gap-3 rounded-full px-8 text-lg font-semibold uppercase tracking-wide text-primary-foreground transition-transform active:scale-[0.98]">
                Start free via WhatsApp <span aria-hidden>→</span>
              </a>
              <a href="#how" className="flex h-16 items-center justify-center rounded-full border border-primary/40 bg-background/40 px-8 text-lg font-semibold uppercase tracking-wide backdrop-blur">
                How it works
              </a>
            </div>
            <ul className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-base text-muted-foreground">
              {["Pay on success", "€60 fixed fee", "Alerts 24/7"].map((b) => (
                <li key={b} className="flex items-center gap-2"><span className="text-primary">●</span> {b}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-5 py-20 md:px-10">
        <h2 className="font-display text-5xl font-extrabold uppercase leading-none md:text-6xl">
          Three steps. <span className="text-cta italic">That's it.</span>
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {steps.map(([n, t, d]) => (
            <div key={n} className="rounded-2xl border border-border bg-card p-6">
              <span className="font-display text-4xl font-extrabold italic text-primary">{n}</span>
              <h3 className="mt-3 text-xl font-semibold">{t}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
        <h2 className="mt-20 font-display text-5xl font-extrabold uppercase leading-none">Pricing</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">Slot alerts</h3>
            <p className="mt-2 font-display text-5xl font-extrabold">Free</p>
            <p className="mt-2 text-muted-foreground">Instant WhatsApp alerts for your chosen centres and dates.</p>
          </div>
          <div className="rounded-2xl border border-primary/50 bg-primary/5 p-6">
            <h3 className="text-xl font-semibold">Auto-book (optional)</h3>
            <p className="mt-2 font-display text-5xl font-extrabold">€60</p>
            <p className="mt-2 text-muted-foreground">Charged only after a slot is held for you. Requires a connected MyRoadSafety account; booking is not guaranteed.</p>
          </div>
        </div>
        <h2 className="mt-20 font-display text-5xl font-extrabold uppercase leading-none">FAQ</h2>
        <div className="mt-8 space-y-3">
          {faq.map(([q, a]) => (
            <details key={q} className="rounded-2xl border border-border bg-card p-5">
              <summary className="cursor-pointer font-semibold">{q}</summary>
              <p className="mt-3 text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
        <footer className="pt-14 text-center text-xs text-muted-foreground">
          We are an independent assistance service helping candidates secure test slots. Not affiliated with the Road Safety Authority (RSA).
        </footer>
      </section>
    </main>
  );
}
