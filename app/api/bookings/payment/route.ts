import { NextRequest } from "next/server";
import { submitPayment } from "@/lib/bookings";
import { readJson, respond, serverError } from "@/lib/http";

// Player submits the reference number of their GCash / QR Ph / BPI payment for staff to verify.
export async function POST(req: NextRequest) {
  try {
    const body = await readJson(req);
    return respond(await submitPayment(body.code, body.method, body.reference));
  } catch (e) {
    return serverError(e);
  }
}
