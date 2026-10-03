// "Add to calendar" for a booking: an .ics file (Apple Calendar, Outlook, most phones) and a
// Google Calendar link. Pure, so it can be tested. Times are the facility's (Manila, UTC+8, no
// daylight saving), written in UTC so every calendar shows them right.

export type CalendarBooking = {
  code: string;
  title: string; // "Badminton at NVBC — Court 1"
  location: string;
  date: string; // YYYY-MM-DD
  startHour: number; // 18.5 = 6:30 PM
  endHour: number;
  details: string; // shown in the event's notes
};

const FACILITY_UTC_OFFSET = 8;

/** "20261012T103000Z" for 6:30 PM in Manila on Oct 12, 2026. */
export function utcStamp(date: string, hour: number): string {
  const ms = Date.parse(date + "T00:00:00Z") + Math.round((hour - FACILITY_UTC_OFFSET) * 60) * 60_000;
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Text in an .ics field: backslash, comma, semicolon and new lines escaped. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines over 75 characters are folded, as calendar apps expect. */
function fold(line: string): string {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 73) out.push((i ? " " : "") + line.slice(i, i + 73));
  return out.join("\r\n");
}

export function icsFile(b: CalendarBooking, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NVBC Courts//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${b.code}@nvbc-courts`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${utcStamp(b.date, b.startHour)}`,
    `DTEND:${utcStamp(b.date, b.endHour)}`,
    `SUMMARY:${esc(b.title)}`,
    `LOCATION:${esc(b.location)}`,
    `DESCRIPTION:${esc(b.details)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(b.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl(b: CalendarBooking): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: b.title,
    dates: `${utcStamp(b.date, b.startHour)}/${utcStamp(b.date, b.endHour)}`,
    details: b.details,
    location: b.location,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}
