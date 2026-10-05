import { db } from "./db";

// Holidays and closures, set ahead of time in /admin → Settings. Open holidays use each sport's
// weekend prices; closed days can't be booked online. Server only.

export type Holiday = { date: string; name: string; closed: boolean };

/** The holiday on `date`, if any. */
export async function holidayOn(date: string): Promise<Holiday | null> {
  const { rows } = await db().query<Holiday>(
    `SELECT holiday_date AS date, name, closed FROM holidays WHERE holiday_date = $1`,
    [date]
  );
  return rows[0] ?? null;
}

/** Holidays from `from` to `to` (inclusive). */
export async function holidaysBetween(from: string, to: string): Promise<Holiday[]> {
  const { rows } = await db().query<Holiday>(
    `SELECT holiday_date AS date, name, closed FROM holidays WHERE holiday_date BETWEEN $1 AND $2 ORDER BY holiday_date`,
    [from, to]
  );
  return rows;
}
