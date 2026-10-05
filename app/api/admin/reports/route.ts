import { NextRequest, NextResponse } from "next/server";
import { canManage, forbidden, getAdmin, unauthorized } from "@/lib/admin-auth";
import { db, getSettings } from "@/lib/db";
import { serverError } from "@/lib/http";
import { daysBetween, isValidDate } from "@/lib/time";
import { closedRanges, overlapsClosure } from "@/lib/closures";
import { halfHours, SLOT_HOURS } from "@/lib/format";
import { holidaysBetween } from "@/lib/holidays";

export const dynamic = "force-dynamic";

// Owner/managers: reports for ?from=YYYY-MM-DD&to=YYYY-MM-DD (up to a year). A "booking" is one
// code (a group of courts counts once); usage and revenue count every court.
export async function GET(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  if (!canManage(me)) return forbidden();
  const q = req.nextUrl.searchParams;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";
  if (!isValidDate(from) || !isValidDate(to) || to < from || daysBetween(from, to) > 366)
    return NextResponse.json({ error: "Choose a date range of up to a year." }, { status: 400 });
  try {
    const settings = await getSettings();
    const range = [from, to];
    const [totals, heat, bySport, byMethod, courts, closedDays] = await Promise.all([
      db().query(
        `SELECT
           count(*) FILTER (WHERE b.group_id IS NULL)::int AS bookings,
           count(*) FILTER (WHERE b.group_id IS NULL AND b.status <> 'cancelled')::int AS kept,
           COALESCE(sum(b.end_hour - b.start_hour) FILTER (WHERE b.status <> 'cancelled'), 0)::float8 AS court_hours,
           COALESCE(sum(b.amount) FILTER (WHERE b.payment_status = 'paid'), 0)::float8 AS revenue,
           COALESCE(sum(b.refund_amount) FILTER (WHERE b.refund_status = 'refunded'), 0)::float8 AS refunded,
           COALESCE(sum(b.refund_amount) FILTER (WHERE b.refund_status = 'due'), 0)::float8 AS refunds_due,
           COALESCE(sum(b.amount) FILTER (WHERE b.status <> 'cancelled' AND b.payment_status IN ('unpaid', 'rejected', 'for_verification')), 0)::float8 AS unpaid,
           count(*) FILTER (WHERE b.group_id IS NULL AND b.status = 'cancelled' AND b.cancelled_by = 'player')::int AS cancelled_customer,
           count(*) FILTER (WHERE b.group_id IS NULL AND b.status = 'cancelled' AND b.cancelled_by NOT IN ('player', 'system'))::int AS cancelled_staff,
           count(*) FILTER (WHERE b.group_id IS NULL AND b.status = 'cancelled' AND b.cancelled_by = 'system')::int AS released,
           count(*) FILTER (WHERE b.group_id IS NULL AND b.no_show)::int AS no_shows,
           -- Bookings that have started (no-shows are counted out of these).
           count(*) FILTER (WHERE b.group_id IS NULL AND b.status <> 'cancelled'
             AND (b.booking_date + make_interval(mins => (b.start_hour * 60)::int)) < (now() AT TIME ZONE 'Asia/Manila'))::int AS started
         FROM bookings b WHERE b.booking_date BETWEEN $1 AND $2`,
        range
      ),
      // Booked half-hours by weekday (1 = Monday … 7 = Sunday) and time.
      db().query<{ dow: number; hour: number; n: number }>(
        `SELECT extract(isodow FROM s.slot_date)::int AS dow, s.slot_hour::float8 AS hour, count(*)::int AS n
           FROM booking_slots s JOIN bookings b ON b.id = s.booking_id
          WHERE s.slot_date BETWEEN $1 AND $2 AND b.status <> 'cancelled'
          GROUP BY 1, 2`,
        range
      ),
      db().query<{ sport: string; revenue: number; court_hours: number; bookings: number }>(
        `SELECT COALESCE(b.activity, c.sport) AS sport,
                COALESCE(sum(b.amount) FILTER (WHERE b.payment_status = 'paid'), 0)::float8 AS revenue,
                COALESCE(sum(b.end_hour - b.start_hour) FILTER (WHERE b.status <> 'cancelled'), 0)::float8 AS court_hours,
                count(*) FILTER (WHERE b.status <> 'cancelled' AND b.group_id IS NULL)::int AS bookings
           FROM bookings b JOIN courts c ON c.id = b.court_id
          WHERE b.booking_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC`,
        range
      ),
      // Split payments count each part under its own method (they cover the whole group).
      db().query<{ method: string; revenue: number; count: number }>(
        `SELECT method, sum(amount)::float8 AS revenue, sum(n)::int AS count FROM (
           SELECT p->>'method' AS method, (p->>'amount')::numeric AS amount, 1 AS n
             FROM bookings b, jsonb_array_elements(b.payment_splits) p
            WHERE b.booking_date BETWEEN $1 AND $2 AND b.payment_status = 'paid' AND b.payment_splits IS NOT NULL
           UNION ALL
           SELECT b.payment_method, b.amount, CASE WHEN b.group_id IS NULL THEN 1 ELSE 0 END
             FROM bookings b LEFT JOIN bookings r ON r.id = b.group_id
            WHERE b.booking_date BETWEEN $1 AND $2 AND b.payment_status = 'paid'
              AND b.payment_splits IS NULL AND r.payment_splits IS NULL
         ) x GROUP BY method ORDER BY 2 DESC`,
        range
      ),
      db().query<{ n: number }>(`SELECT count(*)::int AS n FROM courts WHERE is_active`),
      holidaysBetween(from, to),
    ]);
    // Capacity for usage %: for each weekday and half-hour, how many days in the range were open
    // then (closures — all day or part of it, holidays or weekly rest days — left out).
    const closures = new Map(closedDays.map((h) => [h.date, h]));
    const days = [0, 0, 0, 0, 0, 0, 0, 0]; // index 1..7: how many of each weekday the range has
    const open: Record<number, Record<string, number>> = {};
    for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
      days[dow]++;
      const shut = closedRanges(closures.get(date) ?? null, settings.open_hour, settings.close_hour);
      for (const hh of halfHours(settings.open_hour, settings.close_hour - SLOT_HOURS))
        if (!overlapsClosure(shut, hh, hh + SLOT_HOURS)) (open[dow] ??= {})[String(hh)] = (open[dow]?.[String(hh)] ?? 0) + 1;
    }
    return NextResponse.json(
      {
        from, to,
        openHour: settings.open_hour, closeHour: settings.close_hour,
        courts: courts.rows[0].n,
        dayCounts: days,
        open, // weekday → half-hour → days open then
        totals: totals.rows[0],
        heat: heat.rows,
        bySport: bySport.rows,
        byMethod: byMethod.rows,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return serverError(e);
  }
}
