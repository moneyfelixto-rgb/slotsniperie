import { notFound } from "@tanstack/react-router";
import { getBooking } from "@/lib/bookings.functions";
import { toPayView, type PayView } from "@/lib/pay-booking";

const BOOKING_ID = /^[A-Z0-9]{4,12}$/i;

/** Loader for /pay/:id. Unknown and malformed ids are not-found. Database errors propagate. */
export async function loadPayPage(id: string): Promise<PayView> {
  if (!BOOKING_ID.test(id)) throw notFound();
  const booking = await getBooking({ data: { id } });
  if (!booking) throw notFound();
  return toPayView(booking);
}
