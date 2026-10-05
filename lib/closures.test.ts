// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { closedAllDay, closedRanges, closureOn, closureTimeText, overlapsClosure, type HolidayRule } from "./closures.ts";

const rules: HolidayRule[] = [
  { date: "2025-12-25", name: "Christmas Day", closed: true, yearly: true },
  { date: "2026-10-19", name: "Special opening", closed: false, yearly: false }, // a Monday
  { date: "2026-11-30", name: "Bonifacio Day", closed: false, yearly: false },
  { date: "2026-12-24", name: "Christmas Eve", closed: true, yearly: false, mode: "open", from: 8, to: 15 },
  { date: "2026-10-21", name: "Maintenance", closed: true, yearly: false, mode: "closed", from: 8, to: 12 },
];

test("weekly closed days, all day or part of the day", () => {
  const c = closureOn("2026-10-12", rules, [1]);
  assert.equal(c?.name, "Closed on Mondays");
  assert.equal(c?.kind, "weekly");
  assert.deepEqual(closedRanges(c, 8, 23), [[8, 23]]);
  const part = closureOn("2026-10-12", rules, [1], { "1": { mode: "closed", from: 8, to: 15 } });
  assert.deepEqual(closedRanges(part, 8, 23), [[8, 15]]);
  assert.equal(closureOn("2026-10-13", rules, [1]), null);
});

test("a specific date wins over the weekly rest day", () => {
  const c = closureOn("2026-10-19", rules, [1]);
  assert.equal(c?.name, "Special opening");
  assert.equal(c?.closed, false);
  assert.deepEqual(closedRanges(c, 8, 23), []);
});

test("yearly holidays come back every year", () => {
  assert.equal(closureOn("2026-12-25", rules, [])?.name, "Christmas Day");
  assert.equal(closureOn("2027-12-25", rules, [])?.name, "Christmas Day");
  assert.equal(closureOn("2027-11-30", rules, []), null); // not yearly
});

test("part-day closures: closed from–to, or open only from–to", () => {
  const maint = closureOn("2026-10-21", rules, []);
  assert.deepEqual(closedRanges(maint, 8, 23), [[8, 12]]);
  assert.ok(overlapsClosure(closedRanges(maint, 8, 23), 11.5, 13));
  assert.ok(!overlapsClosure(closedRanges(maint, 8, 23), 12, 14));
  assert.ok(!closedAllDay(maint, 8, 23));
  const eve = closureOn("2026-12-24", rules, []);
  assert.deepEqual(closedRanges(eve, 8, 23), [[15, 23]]);
  assert.equal(closureTimeText(eve!), "open 8:00 AM – 3:00 PM only");
  assert.ok(closedAllDay(closureOn("2026-12-25", rules, []), 8, 23));
});
