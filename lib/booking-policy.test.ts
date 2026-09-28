// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { minutesUntilStart, refundOnCancel, releaseAt, shouldRelease } from "./booking-policy.ts";
import { formatClock } from "./format.ts";

test("minutesUntilStart across days and half hours", () => {
  assert.equal(minutesUntilStart("2026-10-01", 10, { date: "2026-10-01", time: 9.75 }), 15);
  assert.equal(minutesUntilStart("2026-10-01", 10.5, { date: "2026-10-01", time: 11 }), -30);
  assert.equal(minutesUntilStart("2026-10-02", 8, { date: "2026-10-01", time: 20 }), 720);
});

test("releaseAt is 10 minutes before the start (the day before for midnight)", () => {
  assert.deepEqual(releaseAt("2026-10-01", 10), { date: "2026-10-01", time: 10 - 1 / 6 });
  assert.equal(formatClock(releaseAt("2026-10-01", 10).time), "9:50 AM");
  assert.equal(formatClock(releaseAt("2026-10-01", 18.5).time), "6:20 PM");
  const m = releaseAt("2026-10-02", 0);
  assert.equal(m.date, "2026-10-01");
  assert.equal(formatClock(m.time), "11:50 PM");
});

test("shouldRelease: only unpaid pending bookings, from 10 minutes before the start", () => {
  const b = { status: "pending", payment_status: "unpaid", amount: 400, date: "2026-10-01", start_hour: 10 };
  assert.equal(shouldRelease(b, { date: "2026-10-01", time: 9.8 }), false); // 9:48 — 12 min left
  assert.equal(shouldRelease(b, { date: "2026-10-01", time: 9 + 50 / 60 }), true); // 9:50
  assert.equal(shouldRelease(b, { date: "2026-10-02", time: 8 }), true); // long past
  assert.equal(shouldRelease({ ...b, payment_status: "for_verification" }, { date: "2026-10-01", time: 9.95 }), false); // paid online
  assert.equal(shouldRelease({ ...b, status: "confirmed", payment_status: "paid" }, { date: "2026-10-01", time: 9.95 }), false);
  assert.equal(shouldRelease({ ...b, amount: 0 }, { date: "2026-10-01", time: 9.95 }), false);
});

test("refundOnCancel: online payments refundable 12+ hours before the start", () => {
  const b = { payment_method: "gcash", payment_status: "paid", date: "2026-10-02", start_hour: 10 };
  assert.equal(refundOnCancel(b, { date: "2026-10-01", time: 22 }), "refundable"); // exactly 12 h
  assert.equal(refundOnCancel(b, { date: "2026-10-01", time: 22.1 }), "non-refundable");
  assert.equal(refundOnCancel({ ...b, payment_status: "for_verification" }, { date: "2026-10-01", time: 9 }), "refundable");
  assert.equal(refundOnCancel({ ...b, payment_status: "unpaid" }, { date: "2026-10-01", time: 9 }), "none");
  assert.equal(refundOnCancel({ ...b, payment_method: "cash" }, { date: "2026-10-01", time: 9 }), "none");
});

test("formatClock", () => {
  assert.equal(formatClock(0), "12:00 AM");
  assert.equal(formatClock(9 + 50 / 60), "9:50 AM");
  assert.equal(formatClock(12.25), "12:15 PM");
  assert.equal(formatClock(23 + 50 / 60), "11:50 PM");
});
