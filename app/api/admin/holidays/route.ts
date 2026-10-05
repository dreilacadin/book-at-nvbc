import { NextRequest, NextResponse } from "next/server";
import { canManage, forbidden, getAdmin, unauthorized } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { readJson, serverError } from "@/lib/http";
import { isValidDate, nowAtFacility } from "@/lib/time";

export const dynamic = "force-dynamic";

const list = async () =>
  (
    await db().query(
      `SELECT h.holiday_date AS date, h.name, h.closed, h.yearly, h.created_by,
              h.hours_mode AS mode, h.from_hour::float8 AS "from", h.to_hour::float8 AS "to",
              (SELECT count(*)::int FROM bookings b WHERE b.booking_date = h.holiday_date AND b.status <> 'cancelled') AS bookings
         FROM holidays h WHERE h.yearly OR h.holiday_date >= $1::date - 30 ORDER BY h.yearly DESC, h.holiday_date`,
      [nowAtFacility().date]
    )
  ).rows;

// Admin: holidays and closures (recent and upcoming).
export async function GET(req: NextRequest) {
  if (!(await getAdmin(req))) return unauthorized();
  try {
    return NextResponse.json({ holidays: await list() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}

// Owner/managers: { action: "save", date, name, closed, yearly } | { action: "remove", date }
// | { action: "weekday-check", weekdays } → upcoming bookings on those weekdays (before closing them)
export async function POST(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  if (!canManage(me)) return forbidden();
  try {
    const b = await readJson(req);
    if (b.action === "weekday-check") {
      const days = Array.isArray(b.weekdays) ? (b.weekdays as unknown[]).map(Number).filter((d) => Number.isInteger(d)) : [];
      const { rows } = await db().query<{ n: number }>(
        `SELECT count(*)::int AS n FROM bookings WHERE status <> 'cancelled' AND booking_date >= $1
            AND extract(dow FROM booking_date)::int = ANY($2::int[])`,
        [nowAtFacility().date, days]
      );
      return NextResponse.json({ bookings: rows[0].n });
    }
    if (!isValidDate(b.date)) return NextResponse.json({ error: "Choose a date." }, { status: 400 });
    if (b.action === "remove") {
      await db().query(`DELETE FROM holidays WHERE holiday_date = $1`, [b.date]);
    } else if (b.action === "save") {
      const name = typeof b.name === "string" ? b.name.trim().slice(0, 60) : "";
      if (name.length < 2) return NextResponse.json({ error: "Give the holiday a name (e.g. Christmas Day)." }, { status: 400 });
      // A closed day can be closed all day, from–to, or open only from–to.
      const mode = b.closed === true && (b.mode === "closed" || b.mode === "open") ? b.mode : "all";
      const from = mode === "all" ? null : Number(b.from);
      const to = mode === "all" ? null : Number(b.to);
      if (mode !== "all" && (!Number.isInteger(Number(from) * 2) || !Number.isInteger(Number(to) * 2) || Number(from) < 0 || Number(to) > 24 || Number(to) <= Number(from)))
        return NextResponse.json({ error: "The end time must be after the start time." }, { status: 400 });
      await db().query(
        `INSERT INTO holidays (holiday_date, name, closed, yearly, created_by, hours_mode, from_hour, to_hour) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (holiday_date) DO UPDATE SET name = EXCLUDED.name, closed = EXCLUDED.closed, yearly = EXCLUDED.yearly,
           hours_mode = EXCLUDED.hours_mode, from_hour = EXCLUDED.from_hour, to_hour = EXCLUDED.to_hour`,
        [b.date, name, b.closed === true, b.yearly === true, me.name, mode, from, to]
      );
    } else return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    return NextResponse.json({ holidays: await list() });
  } catch (e) {
    return serverError(e);
  }
}
