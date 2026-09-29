import { NextRequest, NextResponse } from "next/server";
import { getAdmin, isAdmin, unauthorized } from "@/lib/admin-auth";
import { cancelById, createBooking, restoreBooking, setBookingPhase, normalizeCode, releaseUnpaidBookings, deleteCancelledBooking, setPaymentStatus, updateBooking } from "@/lib/bookings";
import { db } from "@/lib/db";
import { readJson, respond, serverError } from "@/lib/http";
import { daysBetween, isValidDate, nowAtFacility } from "@/lib/time";

export const dynamic = "force-dynamic";

// Admin only: full booking details (names + contacts) for a date (?date=),
// or for a range of up to 6 weeks (?from=&to=, inclusive) for the overview,
// or one booking by its code (?code=, from scanning the booking QR).
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return unauthorized();
  const q = req.nextUrl.searchParams;
  const rawCode = q.get("code");
  const code = rawCode === null ? null : normalizeCode(rawCode);
  if (rawCode !== null && !code)
    return NextResponse.json(
      { error: /NVBC/i.test(rawCode) ? "That's a member code — check it in the Members tab." : "Booking codes look like NV-ABC123." },
      { status: 400 }
    );
  const date = q.get("date") || nowAtFacility().date;
  const from = q.get("from") || date;
  const to = q.get("to") || from;
  if (!isValidDate(from) || !isValidDate(to) || to < from || daysBetween(from, to) > 42)
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  try {
    await releaseUnpaidBookings();
    const { rows } = await db().query(
      `SELECT b.id, b.cancel_code AS code, c.name AS court_name, c.sport, b.court_id, b.booking_date AS date,
              b.start_hour, b.end_hour, b.player_name AS name, b.contact, b.notes, b.status,
              b.cancelled_by, b.created_at, b.rate_type, b.hourly_rate, b.discount_pct, b.amount,
              b.payment_method, b.payment_status, b.payment_ref, b.paid_at, (b.payment_proof <> '') AS has_proof, b.pay_by,
              b.phase, b.auto_release, b.restored_by, c.sort_order AS court_order,
              mb.member_code, mb.full_name AS member_name,
              ex.id AS expired_member_id, ex.full_name AS expired_member_name,
              ex.expires_on AS expired_member_on, ex.reminded_on AS expired_member_reminded,
              -- Same reference number used on another booking? Worth a second look.
              CASE WHEN b.payment_ref = '' THEN 0 ELSE
                (SELECT count(*)::int FROM bookings o WHERE o.payment_ref = b.payment_ref AND o.id <> b.id) END
                AS ref_reused
         FROM bookings b JOIN courts c ON c.id = b.court_id
         LEFT JOIN memberships mb ON mb.id = b.membership_id
         -- The booker is an expired member (same mobile, last 10 digits): remind them to renew or forfeit.
         LEFT JOIN LATERAL (
           SELECT m.id, m.full_name, m.expires_on, m.reminded_on FROM memberships m
            WHERE m.status = 'active' AND m.expires_on <= $3
              AND length(regexp_replace(b.contact, '\\D', '', 'g')) >= 10
              AND right(regexp_replace(m.mobile, '\\D', '', 'g'), 10) = right(regexp_replace(b.contact, '\\D', '', 'g'), 10)
            ORDER BY m.expires_on DESC LIMIT 1
         ) ex ON b.status <> 'cancelled'
        WHERE ($4::text IS NULL AND b.booking_date BETWEEN $1 AND $2) OR b.cancel_code = $4
        ORDER BY b.booking_date, (b.status = 'cancelled'), c.sport, b.start_hour, c.sort_order, c.id`,
      [from, to, nowAtFacility().date, code]
    );
    if (code) {
      if (!rows[0]) return NextResponse.json({ error: `No booking found with code ${code}.` }, { status: 404 });
      return NextResponse.json(rows[0], { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ date: from, from, to, bookings: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}

// Admin only: { action: "cancel", id } | { action: "create", ...booking fields }
//           | { action: "payment", id, status, method?, reference? }
//           | { action: "delete", id }   (cancelled bookings only)
//           | { action: "update", id, courtId, date, startHour, endHour, name, contact, notes,
//               rateType, hourlyRate, paymentMethod, paymentRef }
export async function POST(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  try {
    const body = await readJson(req);
    if (body.action === "cancel") return respond(await cancelById(String(body.id ?? ""), me.name));
    if (body.action === "payment")
      return respond(await setPaymentStatus(String(body.id ?? ""), body.status, body.method, body.reference));
    if (body.action === "phase") return respond(await setBookingPhase(String(body.id ?? ""), body.phase ?? null));
    if (body.action === "restore") return respond(await restoreBooking(String(body.id ?? ""), body.phase ?? null, me.name));
    if (body.action === "delete") return respond(await deleteCancelledBooking(String(body.id ?? "")));
    if (body.action === "update") return respond(await updateBooking(String(body.id ?? ""), body));
    if (body.action === "create") return respond(await createBooking(body, { admin: true }), 201);
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
