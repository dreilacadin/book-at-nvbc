// Reserved times: courts taken out of public booking at set times (Open Play, Queueing, …).
// Shared by the server and the browser (no Node-only imports here).

export const BLOCK_LABELS = ["Open Play", "Queueing", "Reserved", "Training", "Tournament", "Maintenance"] as const;

export const WEEKDAYS = [
  { id: 1, short: "Mon" },
  { id: 2, short: "Tue" },
  { id: 3, short: "Wed" },
  { id: 4, short: "Thu" },
  { id: 5, short: "Fri" },
  { id: 6, short: "Sat" },
  { id: 0, short: "Sun" },
] as const; // ids match JS getUTCDay() and Postgres EXTRACT(DOW): 0 = Sunday

/**
 * One reserved time. A one-off block has no weekdays and start_date = end_date.
 * A weekly block repeats on `weekdays` from start_date until end_date (null = no end).
 */
export type CourtBlock = {
  id: number;
  label: string;
  court_ids: number[];
  weekdays: number[];
  start_date: string;
  end_date: string | null;
  start_hour: number;
  end_hour: number;
  notes: string;
};

/** Does the block apply on this date ("YYYY-MM-DD")? */
export function blockAppliesOn(b: Pick<CourtBlock, "weekdays" | "start_date" | "end_date">, date: string): boolean {
  if (date < b.start_date || (b.end_date !== null && date > b.end_date)) return false;
  return b.weekdays.length === 0 || b.weekdays.includes(new Date(date + "T00:00:00Z").getUTCDay());
}

/** Every reserved half-hour slot on a date, keyed "courtId:hour" (e.g. "3:10.5") → label. */
export function blockedSlots(blocks: CourtBlock[], date: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of blocks) {
    if (!blockAppliesOn(b, date)) continue;
    for (const courtId of b.court_ids)
      for (let h = b.start_hour; h < b.end_hour; h += 0.5) if (!out.has(`${courtId}:${h}`)) out.set(`${courtId}:${h}`, b.label);
  }
  return out;
}

/** The first block that overlaps a booking of `courtId` from startHour to endHour on `date`, if any. */
export function findBlockConflict(
  blocks: CourtBlock[],
  courtId: number,
  date: string,
  startHour: number,
  endHour: number
): CourtBlock | undefined {
  return blocks.find(
    (b) => b.court_ids.includes(courtId) && blockAppliesOn(b, date) && b.start_hour < endHour && startHour < b.end_hour
  );
}

/** "Every Tue, Thu", "Every day", or a single date left to the caller. */
export function describeRepeat(weekdays: number[]): string {
  if (weekdays.length === 0) return "";
  if (weekdays.length === 7) return "Every day";
  return "Every " + WEEKDAYS.filter((d) => weekdays.includes(d.id)).map((d) => d.short).join(", ");
}
