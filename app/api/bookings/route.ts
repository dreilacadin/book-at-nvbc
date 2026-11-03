import { NextRequest } from "next/server";
import { createBooking } from "@/lib/bookings";
import { readJson, respond, serverError } from "@/lib/http";
import { guardVoucherCode } from "@/lib/throttle";

// Public: create an anonymous booking. Returns a booking code for managing it later. An unknown
// voucher code (404) counts towards the per-visitor limit on guessing voucher codes.
export async function POST(req: NextRequest) {
  return guardVoucherCode(req, async () => {
    try {
      return respond(await createBooking(await readJson(req)), 201);
    } catch (e) {
      return serverError(e);
    }
  });
}
