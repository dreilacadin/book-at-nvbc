// Which holiday or closure applies on a date, and at what times. Pure, so it can be tested.
// A specific date wins over a yearly holiday, which wins over a weekly rest day — so staff can open
// on a usual rest day (an open holiday entry on that date) or close on a normal day.
//
// A closure covers the whole day, or part of it:
//   "all"    — closed all day
//   "closed" — closed from `from` to `to` (e.g. 8 AM–12 PM for maintenance)
//   "open"   — open only from `from` to `to` (e.g. short hours on a holiday)

import { formatHour } from "./format.ts";

export type ClosureMode = "all" | "closed" | "open";
export type ClosureHours = { mode: ClosureMode; from: number | null; to: number | null };
export type HolidayRule = { date: string; name: string; closed: boolean; yearly: boolean } & Partial<ClosureHours>;
export type Closure = {
  date: string;
  name: string;
  closed: boolean; // false = an open holiday (weekend prices all day)
  kind: "holiday" | "weekly"; // holidays use weekend prices; weekly rest days don't
} & ClosureHours;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const hours = (h: Partial<ClosureHours> | undefined): ClosureHours => {
  const mode = h?.mode === "closed" || h?.mode === "open" ? h.mode : "all";
  const from = h?.from ?? null;
  const to = h?.to ?? null;
  return mode !== "all" && from !== null && to !== null && to > from ? { mode, from: Number(from), to: Number(to) } : { mode: "all", from: null, to: null };
};

export function closureOn(
  date: string,
  rules: HolidayRule[],
  closedWeekdays: number[],
  weeklyHours: Record<string, Partial<ClosureHours>> = {}
): Closure | null {
  const exact = rules.find((r) => r.date === date);
  const yearly = exact ? undefined : rules.find((r) => r.yearly && r.date.slice(5) === date.slice(5));
  const rule = exact ?? yearly;
  if (rule) return { date, name: rule.name, closed: rule.closed, kind: "holiday", ...hours(rule.closed ? rule : undefined) };
  const dow = new Date(date + "T00:00:00Z").getUTCDay();
  if (closedWeekdays.includes(dow))
    return { date, name: `Closed on ${WEEKDAY_NAMES[dow]}s`, closed: true, kind: "weekly", ...hours(weeklyHours[String(dow)]) };
  return null;
}

/** The closed times within opening hours, as [from, to) ranges. Empty for an open holiday. */
export function closedRanges(c: Closure | null, openHour: number, closeHour: number): [number, number][] {
  if (!c || !c.closed) return [];
  const clip = (a: number, b: number): [number, number][] => {
    const s = Math.max(a, openHour);
    const e = Math.min(b, closeHour);
    return e > s ? [[s, e]] : [];
  };
  if (c.mode === "closed") return clip(c.from!, c.to!);
  if (c.mode === "open") return [...clip(openHour, c.from!), ...clip(c.to!, closeHour)];
  return [[openHour, closeHour]];
}

/** Is any of [start, end) closed? */
export const overlapsClosure = (ranges: [number, number][], start: number, end: number) => ranges.some(([a, b]) => start < b && end > a);

/** Closed for the whole of opening hours? */
export const closedAllDay = (c: Closure | null, openHour: number, closeHour: number) => {
  const r = closedRanges(c, openHour, closeHour);
  return r.reduce((n, [a, b]) => n + (b - a), 0) >= closeHour - openHour;
};

/** "all day", "8:00 AM – 12:00 PM", "open 10:00 AM – 5:00 PM only" */
export function closureTimeText(c: ClosureHours): string {
  if (c.mode === "closed") return `${formatHour(c.from!)} – ${formatHour(c.to!)}`;
  if (c.mode === "open") return `open ${formatHour(c.from!)} – ${formatHour(c.to!)} only`;
  return "all day";
}
