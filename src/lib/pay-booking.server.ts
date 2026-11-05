import type { PayBookingRow } from "@/lib/pay-booking";

const PAY_COLUMNS =
  "id, test_centre, test_date, test_time, reference, amount_cents, status, expires_at";

/** Loads the public pay-page fields for one booking id. Null when the id is unknown. */
export async function fetchBookingById(id: string): Promise<PayBookingRow | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select(PAY_COLUMNS)
    .eq("id", id.toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}
