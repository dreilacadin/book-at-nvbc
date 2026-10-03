// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { googleCalendarUrl, icsFile, utcStamp, type CalendarBooking } from "./calendar.ts";

const b: CalendarBooking = {
  code: "NV-ABC123", title: "Badminton at NVBC — Court 1, Court 2", location: "NV Badminton Center",
  date: "2026-10-12", startHour: 18.5, endHour: 20, details: "Booking code NV-ABC123; show your QR at the desk",
};

test("utcStamp: Manila time to UTC, across midnight too", () => {
  assert.equal(utcStamp("2026-10-12", 18.5), "20261012T103000Z");
  assert.equal(utcStamp("2026-10-12", 7), "20261011T230000Z");
});

test("icsFile: one event with escaped text, CRLF lines and a 1-hour alarm", () => {
  const ics = icsFile(b, new Date("2026-10-01T00:00:00Z"));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nDTSTART:20261012T103000Z\r\nDTEND:20261012T120000Z\r\n/);
  assert.match(ics, /SUMMARY:Badminton at NVBC — Court 1\\, Court 2/);
  assert.match(ics, /DESCRIPTION:Booking code NV-ABC123\; show/);
  assert.match(ics, /TRIGGER:-PT1H/);
  assert.ok(ics.split("\r\n").every((l) => l.length <= 75), "folded");
});

test("googleCalendarUrl", () => {
  const u = new URL(googleCalendarUrl(b));
  assert.equal(u.searchParams.get("dates"), "20261012T103000Z/20261012T120000Z");
  assert.equal(u.searchParams.get("text"), b.title);
});
