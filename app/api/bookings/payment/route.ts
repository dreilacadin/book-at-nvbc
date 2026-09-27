import { NextRequest } from "next/server";
import { submitPayment } from "@/lib/bookings";
import { readJson, respond, serverError } from "@/lib/http";

// Player submits the reference number and/or receipt screenshot of their GCash / QR Ph / BPI payment.
export async function POST(req: NextRequest) {
  try {
    const body = await readJson(req);
    return respond(await submitPayment(body.code, body.method, body.reference, body.proof));
  } catch (e) {
    return serverError(e);
  }
}
