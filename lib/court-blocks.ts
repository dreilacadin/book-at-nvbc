import { db } from "./db";
import { blockAppliesOn, BLOCK_LABELS, type CourtBlock } from "./blocks";
import type { Result } from "./bookings";
import { isHalfHour } from "./format";
import { isValidDate } from "./time";

const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const COLUMNS = `id, label, court_ids, weekdays, start_date, end_date, start_hour, end_hour, notes`;

/** Every reserved time, soonest first. */
export async function listBlocks(): Promise<CourtBlock[]> {
  const { rows } = await db().query<CourtBlock>(`SELECT ${COLUMNS} FROM court_blocks ORDER BY start_date, start_hour, id`);
  return rows;
}

/** Reserved times that apply on a date. */
export async function blocksOn(date: string): Promise<CourtBlock[]> {
  const { rows } = await db().query<CourtBlock>(
    `SELECT ${COLUMNS} FROM court_blocks
      WHERE start_date <= $1 AND (end_date IS NULL OR end_date >= $1)
        AND (cardinality(weekdays) = 0 OR EXTRACT(DOW FROM $1::date)::int = ANY(weekdays))`,
    [date]
  );
  return rows;
}

export type NewBlockInput = {
  label?: unknown;
  courtIds?: unknown;
  weekdays?: unknown; // [] = one date only
  startDate?: unknown;
  endDate?: unknown; // optional for weekly blocks
  startHour?: unknown;
  endHour?: unknown;
  notes?: unknown;
};

/**
 * Staff: reserve courts at set times. Existing bookings in that time are kept; the result says
 * how many there are so staff can move or cancel them.
 */
export async function createBlock(input: NewBlockInput): Promise<Result<{ block: CourtBlock; conflicts: number }>> {
  const label = typeof input.label === "string" ? input.label.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  const courtIds = Array.isArray(input.courtIds) ? [...new Set(input.courtIds.map(Number))].filter(Number.isInteger) : [];
  const weekdays = Array.isArray(input.weekdays)
    ? [...new Set(input.weekdays.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort()
    : [];
  const startDate = input.startDate;
  const endDate = weekdays.length === 0 ? startDate : input.endDate === "" || input.endDate == null ? null : input.endDate;
  const startHour = Number(input.startHour);
  const endHour = Number(input.endHour);
  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 200) : "";

  if (label.length < 2) return fail(400, `Give the reserved time a name, e.g. ${BLOCK_LABELS.slice(0, 3).join(", ")}.`);
  if (courtIds.length === 0) return fail(400, "Choose at least one court.");
  if (!isValidDate(startDate)) return fail(400, "Choose a valid date.");
  if (endDate !== null && (!isValidDate(endDate) || endDate < startDate)) return fail(400, "The end date must be on or after the start date.");
  if (!isHalfHour(startHour) || !isHalfHour(endHour) || endHour <= startHour)
    return fail(400, "The end time must be after the start time.");

  const known = await db().query(`SELECT id FROM courts WHERE id = ANY($1::int[])`, [courtIds]);
  if (known.rows.length !== courtIds.length) return fail(400, "One of those courts doesn't exist.");

  const { rows } = await db().query<CourtBlock>(
    `INSERT INTO court_blocks (label, court_ids, weekdays, start_date, end_date, start_hour, end_hour, notes)
     VALUES ($1, $2::int[], $3::int[], $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
    [label, courtIds, weekdays, startDate, endDate, startHour, endHour, notes]
  );
  const block = rows[0];

  // Upcoming, active bookings that fall inside the new reserved time.
  const upcoming = await db().query<{ booking_date: string }>(
    `SELECT booking_date FROM bookings
      WHERE status <> 'cancelled' AND court_id = ANY($1::int[]) AND booking_date >= $2
        AND ($3::date IS NULL OR booking_date <= $3) AND start_hour < $5 AND $4 < end_hour`,
    [courtIds, startDate, endDate, startHour, endHour]
  );
  const conflicts = upcoming.rows.filter((r) => blockAppliesOn(block, r.booking_date)).length;
  return { ok: true, data: { block, conflicts } };
}

export async function deleteBlock(id: unknown): Promise<Result<{ id: number }>> {
  const n = Number(id);
  if (!Number.isInteger(n)) return fail(400, "Invalid id.");
  const { rowCount } = await db().query(`DELETE FROM court_blocks WHERE id = $1`, [n]);
  if (!rowCount) return fail(404, "That reserved time was already removed.");
  return { ok: true, data: { id: n } };
}
