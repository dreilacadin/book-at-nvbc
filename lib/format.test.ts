// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, formatHour, formatRange, halfHours, isHalfHour, publicName } from "./format.ts";

test("formatHour handles whole and half hours", () => {
  assert.equal(formatHour(0), "12:00 AM");
  assert.equal(formatHour(0.5), "12:30 AM");
  assert.equal(formatHour(10.5), "10:30 AM");
  assert.equal(formatHour(12), "12:00 PM");
  assert.equal(formatHour(12.5), "12:30 PM");
  assert.equal(formatHour(23.5), "11:30 PM");
  assert.equal(formatHour(24), "12:00 AM");
  assert.equal(formatRange(9.5, 11), "9:30 AM – 11:00 AM");
});

test("formatDuration", () => {
  assert.equal(formatDuration(0.5), "30 min");
  assert.equal(formatDuration(1), "1 hour");
  assert.equal(formatDuration(1.5), "1½ hours");
  assert.equal(formatDuration(2), "2 hours");
});

test("half-hour helpers", () => {
  assert.deepEqual(halfHours(10, 11.5), [10, 10.5, 11, 11.5]);
  assert.ok(isHalfHour(10.5));
  assert.ok(isHalfHour(24));
  assert.ok(!isHalfHour(10.25));
  assert.ok(!isHalfHour(24.5));
  assert.ok(!isHalfHour("10"));
});

test("publicName shows first name and last initial only", () => {
  assert.equal(publicName("Ana Cruz"), "Ana C.");
  assert.equal(publicName("  Juan  dela   cruz "), "Juan C.");
  assert.equal(publicName("Madonna"), "Madonna");
  assert.equal(publicName("   "), "Booked");
});
