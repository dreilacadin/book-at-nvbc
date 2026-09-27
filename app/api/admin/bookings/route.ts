import { NextRequest, NextResponse } from "next/server";
import { isAdmin, unauthorized } from "@/lib/admin-auth";
import { cancelById, createBooking, setPaymentStatus } from "@/lib/bookings";
import { db } from "@/lib/db";
import { readJson, respond, serverError } from "@/lib/http";
import { isValidDate, nowAtFacility } from "@/lib/time";

export const dynamic = "force-dynamic";

// Admin only: full booking details (names + contacts) for a date.
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  const date = req.nextUrl.searchParams.get("date") || nowAtFacility().date;
  if (!isValidDate(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  try {
    const { rows } = await db().query(
      `SELECT b.id, b.cancel_code AS code, c.name AS court_name, c.sport, b.court_id, b.booking_date AS date,
              b.start_hour, b.end_hour, b.player_name AS name, b.contact, b.notes, b.status,
              b.cancelled_by, b.created_at, b.rate_type, b.hourly_rate, b.discount_pct, b.amount,
              b.payment_method, b.payment_status, b.payment_ref, b.paid_at, (b.payment_proof <> '') AS has_proof,
              -- Same reference number used on another booking? Worth a second look.
              CASE WHEN b.payment_ref = '' THEN 0 ELSE
                (SELECT count(*)::int FROM bookings o WHERE o.payment_ref = b.payment_ref AND o.id <> b.id) END
                AS ref_reused
         FROM bookings b JOIN courts c ON c.id = b.court_id
        WHERE b.booking_date = $1
        ORDER BY (b.status = 'cancelled'), c.sport, b.start_hour, c.sort_order, c.id`,
      [date]
    );
    return NextResponse.json({ date, bookings: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}

// Admin only: { action: "cancel", id } | { action: "create", ...booking fields }
//           | { action: "payment", id, status, method?, reference? }
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const body = await readJson(req);
    if (body.action === "cancel") return respond(await cancelById(String(body.id ?? "")));
    if (body.action === "payment")
      return respond(await setPaymentStatus(String(body.id ?? ""), body.status, body.method, body.reference));
    if (body.action === "create") return respond(await createBooking(body, { admin: true }), 201);
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
