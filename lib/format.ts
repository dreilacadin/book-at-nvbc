// Formatting helpers shared by server and browser code (no Node-only imports here).

// Times of day are hours as numbers in half-hour steps: 10 = 10:00 AM, 10.5 = 10:30 AM, 24 = midnight.

/** Slots are 30 minutes long. */
export const SLOT_HOURS = 0.5;

/** A valid time of day: 0–24 in half-hour steps. */
export const isHalfHour = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v * 2) && v >= 0 && v <= 24;

/** Half-hour times from `from` up to and including `to`, e.g. [10, 10.5, 11]. */
export function halfHours(from: number, to: number): number[] {
  const out: number[] = [];
  for (let t = from; t <= to; t += SLOT_HOURS) out.push(t);
  return out;
}

export function formatHour(h: number): string {
  const hour = Math.floor(h) % 24;
  const min = h % 1 ? "30" : "00";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${min} ${hour < 12 ? "AM" : "PM"}`;
}

/** Any time of day in hours, to the minute: 9.8333 → "9:50 AM". */
export function formatClock(h: number): string {
  const total = Math.round(h * 60);
  const hour = Math.floor(total / 60) % 24;
  const min = String(total % 60).padStart(2, "0");
  return `${hour % 12 === 0 ? 12 : hour % 12}:${min} ${hour < 12 ? "AM" : "PM"}`;
}

/** 0.5 → "30 min", 1 → "1 hour", 1.5 → "1½ hours" */
export function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const whole = Math.floor(hours);
  const half = hours % 1 ? "½" : "";
  return `${whole}${half} hour${hours > 1 ? "s" : ""}`;
}

/** What the public schedule shows for a booker: first name and last initial ("Ana C."). */
export function publicName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Booked";
  const first = parts[0].slice(0, 20);
  return parts.length === 1 ? first : `${first} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function formatRange(start: number, end: number): string {
  return `${formatHour(start)} – ${formatHour(end)}`;
}

export function formatDateLong(date: string): string {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateShort(date: string): { dow: string; day: string; month: string } {
  const d = new Date(date + "T00:00:00Z");
  return {
    dow: d.toLocaleDateString("en-PH", { weekday: "short", timeZone: "UTC" }),
    day: String(d.getUTCDate()),
    month: d.toLocaleDateString("en-PH", { month: "short", timeZone: "UTC" }),
  };
}
