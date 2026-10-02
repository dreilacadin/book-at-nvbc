import { NextRequest } from "next/server";
import { submitPayment } from "@/lib/bookings";
import { guardBookingCode } from "@/lib/throttle";
import { readJson, respond, serverError } from "@/lib/http";

// Player submits the reference number and/or receipt screenshot of their GCash / QR Ph / BPI payment.
async function handle(req: NextRequest) {
  try {
    const body = await readJson(req);
    return respond(await submitPayment(body.code, body.method, body.reference, body.proof, body.amountPaid));
  } catch (e) {
    return serverError(e);
  }
}

// Unknown booking codes count towards a per-visitor limit (see guardBookingCode).
export async function POST(req: NextRequest) {
  return guardBookingCode(req, () => handle(req));
}
