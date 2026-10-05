import { NextRequest, NextResponse } from "next/server";
import { canManage, forbidden, getAdmin, unauthorized } from "@/lib/admin-auth";
import { db, getSettings } from "@/lib/db";
import { serverError } from "@/lib/http";
import { daysBetween, isValidDate } from "@/lib/time";

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
      db().query<{ method: string; revenue: number; count: number }>(
        `SELECT b.payment_method AS method, sum(b.amount)::float8 AS revenue, count(*) FILTER (WHERE b.group_id IS NULL)::int AS count
           FROM bookings b WHERE b.booking_date BETWEEN $1 AND $2 AND b.payment_status = 'paid'
          GROUP BY 1 ORDER BY 2 DESC`,
        range
      ),
      db().query<{ n: number }>(`SELECT count(*)::int AS n FROM courts WHERE is_active`),
      db().query<{ d: string }>(`SELECT holiday_date AS d FROM holidays WHERE closed AND holiday_date BETWEEN $1 AND $2`, range),
    ]);
    // How many of each weekday the range has (closed holidays left out): the capacity for usage %.
    const closed = new Set(closedDays.rows.map((r) => r.d));
    const days = [0, 0, 0, 0, 0, 0, 0, 0]; // index 1..7
    for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      if (closed.has(d.toISOString().slice(0, 10))) continue;
      days[d.getUTCDay() === 0 ? 7 : d.getUTCDay()]++;
    }
    return NextResponse.json(
      {
        from, to,
        openHour: settings.open_hour, closeHour: settings.close_hour,
        courts: courts.rows[0].n,
        dayCounts: days,
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
