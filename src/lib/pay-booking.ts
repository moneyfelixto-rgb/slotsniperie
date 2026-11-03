import { HOLD_HOURS, SERVICE_FEE_EUR } from "@/lib/offer";

export type PayBookingRow = {
  id: string;
  test_centre: string;
  test_date: string;
  test_time: string;
  reference: string | null;
  amount_cents: number;
  status: string;
  expires_at: string;
};

export type PayView = {
  id: string;
  ref: string;
  centre: string;
  dateLabel: string;
  time: string;
  feeEur: number;
  holdHours: number;
  expiresAt: number;
  state: "held" | "expired" | "paid";
};

export function formatTestDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-IE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

/** Maps a bookings row to the pay page. Pending rows past expires_at are expired. */
export function toPayView(row: PayBookingRow, now = Date.now()): PayView {
  const expiresAt = Date.parse(row.expires_at);
  let state: PayView["state"] = "expired";
  if (row.status === "paid") state = "paid";
  else if (row.status === "pending" && expiresAt > now) state = "held";

  return {
    id: row.id,
    ref: row.reference?.trim() || row.id,
    centre: row.test_centre,
    dateLabel: formatTestDate(row.test_date),
    time: row.test_time,
    feeEur: SERVICE_FEE_EUR,
    holdHours: HOLD_HOURS,
    expiresAt: Number.isNaN(expiresAt) ? 0 : expiresAt,
    state,
  };
}
