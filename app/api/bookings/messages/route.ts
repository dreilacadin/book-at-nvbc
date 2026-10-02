import { NextRequest, NextResponse } from "next/server";
import { normalizeCode } from "@/lib/bookings";
import { customerSend, customerThread } from "@/lib/booking-messages";
import { guardBookingCode } from "@/lib/throttle";
import { readJson, respond, serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// Public, by booking code: the customer's messages with staff about this booking.
// POST (not GET) so codes stay out of logs. { code, action: "list" } | { code, action: "send", body }
async function handle(req: NextRequest) {
  try {
    const b = await readJson(req);
    const code = normalizeCode(b.code);
    if (!code) return NextResponse.json({ error: "Booking codes look like NV-ABC123." }, { status: 400 });
    if (b.action === "send") return respond(await customerSend(code, b.body));
    return respond(await customerThread(code));
  } catch (e) {
    return serverError(e);
  }
}

// Unknown booking codes count towards a per-visitor limit (see guardBookingCode).
export async function POST(req: NextRequest) {
  return guardBookingCode(req, () => handle(req));
}
