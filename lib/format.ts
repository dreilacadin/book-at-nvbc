// Formatting helpers shared by server and browser code (no Node-only imports here).

export function formatHour(h: number): string {
  if (h === 0 || h === 24) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
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
