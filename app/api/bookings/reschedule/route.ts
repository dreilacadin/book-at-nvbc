import { NextRequest, NextResponse } from "next/server";
import { normalizeCode } from "@/lib/bookings";
import { readJson, respond, serverError } from "@/lib/http";
import { rescheduleByCode, rescheduleOptions } from "@/lib/reschedule";
import { guardBookingCode } from "@/lib/throttle";

export const dynamic = "force-dynamic";

// Public, by booking code: { code, action: "options", date? } → what's allowed and free times on
// that date; { code, action: "move", courtId, date, start } → moves the booking.
async function handle(req: NextRequest) {
  try {
    const b = await readJson(req);
    const code = normalizeCode(b.code);
    if (!code) return NextResponse.json({ error: "Booking codes look like NV-ABC123." }, { status: 400 });
    if (b.action === "move") return respond(await rescheduleByCode(code, b));
    return respond(await rescheduleOptions(code, b.date));
  } catch (e) {
    return serverError(e);
  }
}

// Unknown booking codes count towards a per-visitor limit (see guardBookingCode).
export async function POST(req: NextRequest) {
  return guardBookingCode(req, () => handle(req));
}
