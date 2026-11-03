import { NextRequest } from "next/server";
import { CUSTOMER } from "@/lib/booking-history";
import { normalizeCode } from "@/lib/bookings";
import { readJson, respond, serverError } from "@/lib/http";
import { guardBookingCode, guardVoucherCode } from "@/lib/throttle";
import { applyVoucherToBooking } from "@/lib/vouchers";

// Public: { code, voucher } — the customer adds a voucher to their unpaid booking (My booking).
// Unknown booking or voucher codes count towards the per-visitor limits.
export async function POST(req: NextRequest) {
  return guardBookingCode(req, () =>
    guardVoucherCode(req, async () => {
      try {
        const body = await readJson(req);
        const code = normalizeCode(body.code);
        if (!code) return Response.json({ error: "Booking codes look like NV-ABC123." }, { status: 400 });
        return respond(await applyVoucherToBooking({ code }, body.voucher, CUSTOMER));
      } catch (e) {
        return serverError(e);
      }
    })
  );
}
