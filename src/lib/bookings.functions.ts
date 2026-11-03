import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getBooking = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) =>
    z.object({ id: z.string().regex(/^[A-Z0-9]{4,12}$/i) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { fetchBookingById } = await import("@/lib/pay-booking.server");
    return fetchBookingById(data.id);
  });
