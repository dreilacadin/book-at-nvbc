import { db, getSettings } from "./db";
import { closureOn, type Closure, type HolidayRule } from "./closures";

// Holidays and closures, set ahead of time in /admin → Settings: dates (optionally every year)
// and weekdays closed every week. Open holidays use each sport's weekend prices; closed days can't
// be booked online. Server only.

export type Holiday = Closure;

async function rules(from: string, to: string): Promise<HolidayRule[]> {
  const { rows } = await db().query<HolidayRule>(
    `SELECT holiday_date AS date, name, closed, yearly, hours_mode AS mode, from_hour::float8 AS "from", to_hour::float8 AS "to"
       FROM holidays WHERE yearly OR holiday_date BETWEEN $1 AND $2`,
    [from, to]
  );
  return rows;
}

/** The holiday or closure on `date`, if any. */
export async function holidayOn(date: string): Promise<Holiday | null> {
  const [r, s] = await Promise.all([rules(date, date), getSettings()]);
  return closureOn(date, r, s.closed_weekdays, s.weekly_closure_hours);
}

/** Every day from `from` to `to` (inclusive) with a holiday or closure. */
export async function holidaysBetween(from: string, to: string): Promise<Holiday[]> {
  const [r, s] = await Promise.all([rules(from, to), getSettings()]);
  const out: Holiday[] = [];
  for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const c = closureOn(d.toISOString().slice(0, 10), r, s.closed_weekdays, s.weekly_closure_hours);
    if (c) out.push(c);
  }
  return out;
}
