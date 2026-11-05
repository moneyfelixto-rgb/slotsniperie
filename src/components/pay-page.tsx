import { useEffect, useState } from "react";
import type { PayView } from "@/lib/pay-booking";

const fmt = (seconds: number) =>
  [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");

export function BookingNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-8">
      <p className="text-sm font-bold tracking-tight">
        Slot<span className="text-primary">.</span>Sniper
      </p>
      <h1 className="mt-6 text-4xl font-bold leading-tight">Booking not found</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This payment link does not match a booking. Check the link in your WhatsApp message, or it
        may have been typed wrong.
      </p>
      <a
        href="/"
        className="mt-8 inline-flex h-12 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground"
      >
        Back home
      </a>
    </main>
  );
}

export function PayPageView({ booking }: { booking: PayView }) {
  const calc = () => Math.max(0, Math.floor((booking.expiresAt - Date.now()) / 1000));
  const [left, setLeft] = useState(calc);

  useEffect(() => {
    setLeft(calc());
    const timer = setInterval(() => setLeft(calc()), 1000);
    return () => clearInterval(timer);
    // The countdown only depends on the hold deadline from the loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.expiresAt]);

  const expired = booking.state === "expired" || (booking.state === "held" && left === 0);
  const rows: [string, string][] = [
    ["Test centre", booking.centre],
    ["Date", booking.dateLabel],
    ["Time", booking.time],
    ["Reference", booking.ref],
  ];

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 py-6">
      <header className="flex items-center justify-between border-b border-border pb-4">
        <span className="text-sm font-bold tracking-tight">
          Slot<span className="text-primary">.</span>Sniper
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">Hold for payment</span>
      </header>

      <div
        className={`mt-6 rounded-2xl border p-5 ${expired ? "border-destructive" : "border-primary/40 bg-primary/5"}`}
      >
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {booking.state === "paid"
            ? "Payment recorded"
            : expired
              ? "Hold expired"
              : `Slot held for ${booking.holdHours} hours`}
        </p>
        <p
          className={`mt-1 font-mono text-4xl font-bold tabular-nums ${expired ? "text-destructive" : "text-foreground"}`}
        >
          {booking.state === "paid" ? "Paid" : fmt(expired ? 0 : left)}
        </p>
      </div>

      <h1 className="mt-8 text-3xl font-bold leading-tight">
        {booking.state === "paid"
          ? "This booking is already paid."
          : expired
            ? "This hold has expired."
            : "We are holding your slot."}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {booking.state === "paid"
          ? "There is nothing left to pay on this page."
          : expired
            ? "An expired hold can't be paid. Message the bot if you still need a test."
            : `The €${booking.feeEur} fee is only due if you want us to keep this hold. Nothing is charged on this page yet.`}
      </p>

      <dl className="mt-6 rounded-2xl border border-border bg-card">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between border-b border-border px-4 py-3 text-sm last:border-b-0"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex items-baseline justify-between rounded-2xl border-t-2 border-primary pt-4">
        <span className="text-xs font-semibold uppercase tracking-wider">Fee when paying</span>
        <span className="text-3xl font-bold">€{booking.feeEur}.00</span>
      </div>

      <div className="mt-6">
        {booking.state === "paid" ? (
          <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            This booking is already marked paid in our records. There is nothing to pay here.
          </p>
        ) : (
          <button
            type="button"
            disabled
            className="flex h-16 w-full cursor-not-allowed items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground opacity-40"
          >
            {expired ? "Hold expired" : "Payment coming soon"}
          </button>
        )}
      </div>
      {booking.state !== "paid" && !expired ? (
        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          Payment coming soon. This button is disabled and cannot mark the slot as paid.
        </p>
      ) : null}
      <p className="mt-6 text-center text-[10px] leading-relaxed text-muted-foreground">
        We are an independent assistance service helping candidates secure test slots. Not
        affiliated with the Road Safety Authority (RSA).
      </p>
    </main>
  );
}
