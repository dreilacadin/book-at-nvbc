import { NextRequest, NextResponse } from "next/server";
import { canManage, forbidden, getAdmin, isAdmin, unauthorized } from "@/lib/admin-auth";
import { setCoachMisuse, setNoShow, setRefund, cancelById, createBooking, restoreBooking, setBookingPhase, normalizeCode, releaseUnpaidBookings, deleteCancelledBooking, setPaymentStatus, updateBooking } from "@/lib/bookings";
import { staff } from "@/lib/booking-history";
import { restoreCoaching } from "@/lib/coaches";
import { db, getSettings } from "@/lib/db";
import { gcashAccounts } from "@/lib/pricing";
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
  // ?q= searches every date by booker name, email or contact (phone numbers ignore spaces / +63).
  const search = (q.get("q") ?? "").trim().slice(0, 60) || null;
  const digits = search ? search.replace(/\D/g, "").replace(/^63(?=9\d{9}$)/, "0") : "";
  const date = q.get("date") || nowAtFacility().date;
  const from = q.get("from") || date;
  const to = q.get("to") || from;
  if (!isValidDate(from) || !isValidDate(to) || to < from || daysBetween(from, to) > 42)
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  try {
    await releaseUnpaidBookings();
    const { rows } = await db().query(
      // r = the group's first booking (or the booking itself): it holds the code the customer
      // uses, the screenshot, their messages and update settings.
      `SELECT b.id, b.cancel_code AS code, c.name AS court_name, COALESCE(b.activity, c.sport) AS sport, c.sport AS court_sport,
              b.court_id, b.booking_date AS date,
              b.start_hour, b.end_hour, b.player_name AS name, b.contact, b.notes, b.status,
              b.cancelled_by, b.created_at, b.rate_type, b.hourly_rate, b.discount_pct, b.amount,
              b.payment_method, b.payment_status, b.payment_ref, b.paid_at, (r.payment_proof <> '') AS has_proof, b.pay_by,
              (r.payment_proof = '' AND COALESCE(r.payment_proof_hash, '') <> '') AS proof_deleted, r.paid_amount_reported,
              r.id AS group_root, r.cancel_code AS group_code, b.reschedule_count, r.payment_splits,
              b.refund_status, b.refund_amount::float8 AS refund_amount, b.refund_ref, b.refund_note, b.refund_by, b.refund_at,
              (SELECT COALESCE(sum(g.refund_amount), 0)::float8 FROM bookings g WHERE COALESCE(g.group_id, g.id) = r.id AND g.refund_status = b.refund_status) AS refund_group_total,
              b.no_show, b.no_show_by,
              b.coach_id, (SELECT COALESCE(NULLIF(nickname, ''), full_name) FROM coaches WHERE id = b.coach_id) AS coach_name, b.coach_code_shared, b.coach_code_misuse,
              r.coaching_status, r.coaching_note, (SELECT COALESCE(NULLIF(nickname, ''), full_name) FROM coaches WHERE id = r.coaching_coach_id) AS coaching_coach,
              -- The same player (by phone/email) didn't turn up or didn't pay in the last 90 days: warn staff.
              (SELECT COALESCE(json_agg(json_build_object('date', o.booking_date, 'code', o.cancel_code,
                        'kind', CASE WHEN o.no_show THEN 'no_show' ELSE 'unpaid' END) ORDER BY o.booking_date DESC), '[]'::json)
                 FROM bookings o
                WHERE b.contact_key <> '' AND o.contact_key = b.contact_key AND o.id <> b.id
                  AND COALESCE(o.group_id, o.id) <> r.id AND o.group_id IS NULL
                  AND o.booking_date >= $3::date - 90
                  AND (o.no_show OR (o.status = 'cancelled' AND o.cancelled_by = 'system'))) AS player_flags,
              -- Group bookings: all its courts (still booked), and their total.
              (SELECT count(*)::int FROM bookings g WHERE COALESCE(g.group_id, g.id) = r.id AND g.status <> 'cancelled') AS group_size,
              (SELECT COALESCE(sum(g.amount), 0)::float8 FROM bookings g WHERE COALESCE(g.group_id, g.id) = r.id AND g.status <> 'cancelled') AS group_total,
              (SELECT string_agg(gc.name, ', ' ORDER BY gc.sort_order, gc.id) FROM bookings g JOIN courts gc ON gc.id = g.court_id
                WHERE COALESCE(g.group_id, g.id) = r.id AND g.status <> 'cancelled') AS group_courts,
              b.phase, b.auto_release, b.restored_by, c.sort_order AS court_order,
              b.rejected_note, b.rejected_by, b.rejected_at, r.customer_email,
              (SELECT count(*)::int FROM customer_push_subscriptions s WHERE s.booking_id = r.id) AS alert_devices,
              (SELECT count(*)::int FROM booking_messages m WHERE m.booking_id = r.id) AS message_count,
              (SELECT count(*)::int FROM booking_messages m
                WHERE m.booking_id = r.id AND m.sender_kind = 'customer' AND m.read_at IS NULL) AS unread_messages,
              mb.member_code, mb.full_name AS member_name,
              ex.id AS expired_member_id, ex.full_name AS expired_member_name,
              ex.expires_on AS expired_member_on, ex.reminded_on AS expired_member_reminded,
              COALESCE(r.payment_sent_at, CASE WHEN r.payment_ref <> '' OR r.payment_proof <> '' THEN r.created_at END)
                AS payment_sent_at,
              -- Same reference number or screenshot sent for another booking? Worth a second look.
              (SELECT COALESCE(json_agg(json_build_object(
                        'code', o.cancel_code, 'name', o.player_name, 'date', o.booking_date,
                        'start_hour', o.start_hour, 'amount', o.amount, 'status', o.status,
                        'same_ref', r.payment_ref_key <> '' AND o.payment_ref_key = r.payment_ref_key,
                        'same_proof', r.payment_proof_hash <> '' AND o.payment_proof_hash = r.payment_proof_hash)
                      ORDER BY o.created_at), '[]'::json)
                 FROM bookings o
                WHERE COALESCE(o.group_id, o.id) <> r.id -- the group's own courts share one payment
                  AND ((r.payment_ref_key <> '' AND o.payment_ref_key = r.payment_ref_key)
                    OR (r.payment_proof_hash <> '' AND o.payment_proof_hash = r.payment_proof_hash))
              ) AS payment_reuse
         FROM bookings b JOIN courts c ON c.id = b.court_id
         JOIN bookings r ON r.id = COALESCE(b.group_id, b.id)
         LEFT JOIN memberships mb ON mb.id = b.membership_id
         -- The booker is an expired member (same mobile, last 10 digits): remind them to renew or forfeit.
         LEFT JOIN LATERAL (
           SELECT m.id, m.full_name, m.expires_on, m.reminded_on FROM memberships m
            WHERE m.status = 'active' AND m.expires_on <= $3
              AND length(regexp_replace(b.contact, '\\D', '', 'g')) >= 10
              AND right(regexp_replace(m.mobile, '\\D', '', 'g'), 10) = right(regexp_replace(b.contact, '\\D', '', 'g'), 10)
            ORDER BY m.expires_on DESC LIMIT 1
         ) ex ON b.status <> 'cancelled'
        WHERE ($4::text IS NULL AND $5::text IS NULL AND b.booking_date BETWEEN $1 AND $2) OR b.cancel_code = $4
           OR ($5::text IS NOT NULL AND (
                b.player_name ILIKE '%' || $5 || '%' OR b.customer_email ILIKE '%' || $5 || '%' OR b.contact ILIKE '%' || $5 || '%'
                OR (length($6) >= 4 AND regexp_replace(b.contact, '\\D', '', 'g') LIKE '%' || $6 || '%')))
        ORDER BY ${search
          ? "(b.booking_date < $3), CASE WHEN b.booking_date >= $3 THEN b.booking_date END, b.booking_date DESC, b.start_hour, c.sort_order"
          : "b.booking_date, (b.status = 'cancelled'), (b.cancel_code <> $4) NULLS FIRST, c.sport, b.start_hour, c.sort_order, c.id"}
        ${search ? "LIMIT 100" : ""}`,
      [from, to, nowAtFacility().date, code, search, digits.replace(/^0/, "")]
    );
    // Where online payments should have gone, for staff to compare with the screenshot.
    const s = await getSettings();
    const payTo = (m: string) =>
      m === "gcash" ? gcashAccounts(s).map((a) => [a.name, a.number].filter(Boolean).join(" · ")).join(" or ")
      : m === "bpi" ? [s.bpi_account_name, s.bpi_account_number].filter(Boolean).join(" · ")
      : m === "qrph" ? "NVBC's QR Ph code"
      : "";
    for (const r of rows) r.pay_to = payTo(r.payment_method);
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
//           | { action: "payment", id, status, method?, reference?, note? }   (note: required to reject)
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
      return respond(await setPaymentStatus(String(body.id ?? ""), body.status, body.method, body.reference, body.note, me.name, body.splits));
    if (body.action === "refund") return respond(await setRefund(String(body.id ?? ""), body, me.name));
    if (body.action === "coach-misuse") return respond(await setCoachMisuse(String(body.id ?? ""), body.on, me.name));
    if (body.action === "noshow") return respond(await setNoShow(String(body.id ?? ""), body.on, me.name));
    if (body.action === "phase") return respond(await setBookingPhase(String(body.id ?? ""), body.phase ?? null, me.name));
    if (body.action === "restore") return respond(await restoreBooking(String(body.id ?? ""), body.phase ?? null, me.name));
    if (body.action === "restore-coaching") return respond(await restoreCoaching(String(body.id ?? ""), staff(me.name)));
    if (body.action === "delete" && !canManage(me)) return forbidden();
    if (body.action === "delete") return respond(await deleteCancelledBooking(String(body.id ?? ""), me.name));
    if (body.action === "update") return respond(await updateBooking(String(body.id ?? ""), body, me.name));
    if (body.action === "create") return respond(await createBooking(body, { admin: true, by: me.name }), 201);
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
