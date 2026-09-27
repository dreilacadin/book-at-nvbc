// Date/time helpers that work in the facility's timezone (default Asia/Manila),
// regardless of where the server runs (Vercel servers use UTC).

export const TIMEZONE = process.env.FACILITY_TIMEZONE || "Asia/Manila";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Current date ("YYYY-MM-DD") and hour (0-23) at the facility. */
export function nowAtFacility(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Number of whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

/** A slot is in the past if it has already started. */
export function isPastSlot(date: string, hour: number): boolean {
  const now = nowAtFacility();
  if (date < now.date) return true;
  if (date > now.date) return false;
  return hour <= now.hour;
}
