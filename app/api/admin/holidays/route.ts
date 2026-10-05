import { NextRequest, NextResponse } from "next/server";
import { canManage, forbidden, getAdmin, unauthorized } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { readJson, serverError } from "@/lib/http";
import { isValidDate, nowAtFacility } from "@/lib/time";

export const dynamic = "force-dynamic";

const list = async () =>
  (
    await db().query(
      `SELECT h.holiday_date AS date, h.name, h.closed, h.created_by,
              (SELECT count(*)::int FROM bookings b WHERE b.booking_date = h.holiday_date AND b.status <> 'cancelled') AS bookings
         FROM holidays h WHERE h.holiday_date >= $1::date - 30 ORDER BY h.holiday_date`,
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

// Owner/managers: { action: "save", date, name, closed } | { action: "remove", date }
export async function POST(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  if (!canManage(me)) return forbidden();
  try {
    const b = await readJson(req);
    if (!isValidDate(b.date)) return NextResponse.json({ error: "Choose a date." }, { status: 400 });
    if (b.action === "remove") {
      await db().query(`DELETE FROM holidays WHERE holiday_date = $1`, [b.date]);
    } else if (b.action === "save") {
      const name = typeof b.name === "string" ? b.name.trim().slice(0, 60) : "";
      if (name.length < 2) return NextResponse.json({ error: "Give the holiday a name (e.g. Christmas Day)." }, { status: 400 });
      await db().query(
        `INSERT INTO holidays (holiday_date, name, closed, created_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (holiday_date) DO UPDATE SET name = EXCLUDED.name, closed = EXCLUDED.closed`,
        [b.date, name, b.closed === true, me.name]
      );
    } else return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    return NextResponse.json({ holidays: await list() });
  } catch (e) {
    return serverError(e);
  }
}
