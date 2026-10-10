import { NextRequest, NextResponse } from "next/server";
import { normalizeCode } from "@/lib/bookings";
import { availableCoaches, requestCoachingForBooking } from "@/lib/coaches";
import { db } from "@/lib/db";
import { readJson, respond, serverError } from "@/lib/http";
import { guardBookingCode } from "@/lib/throttle";

export const dynamic = "force-dynamic";

// Public, by booking code: { code, action: "options" } → coaches free for this booking's time;
// { code, action: "request", coachId } → ask that coach for a session.
async function handle(req: NextRequest) {
  try {
    const b = await readJson(req);
    const code = normalizeCode(b.code);
    if (!code) return NextResponse.json({ error: "Booking codes look like NV-ABC123." }, { status: 400 });
    if (b.action === "request") return respond(await requestCoachingForBooking(code, b.coachId));
    const { rows } = await db().query<{ id: string; activity: string; booking_date: string; start_hour: number; end_hour: number }>(
      `SELECT b.id, COALESCE(b.activity, c.sport) AS activity, b.booking_date, b.start_hour::float8, b.end_hour::float8
         FROM bookings b JOIN courts c ON c.id = b.court_id WHERE b.cancel_code = $1`,
      [code]
    );
    if (!rows[0]) return NextResponse.json({ error: "No booking found with that code." }, { status: 404 });
    const r = rows[0];
    return NextResponse.json({ coaches: await availableCoaches(r.activity, r.booking_date, r.start_hour, r.end_hour, r.id) });
  } catch (e) {
    return serverError(e);
  }
}

// Unknown booking codes count towards a per-visitor limit (see guardBookingCode).
export async function POST(req: NextRequest) {
  return guardBookingCode(req, () => handle(req));
}
