import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getBooking = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) =>
    z.object({ id: z.string().regex(/^[A-Z0-9]{4,12}$/i) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: b } = await supabaseAdmin
      .from("bookings")
      .select("id, test_centre, test_date, test_time, reference, amount_cents, status, expires_at")
      .eq("id", data.id.toUpperCase())
      .maybeSingle();
    return b;
  });
