// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { minutesUntilStart, paymentDeadline, refundOnCancel, releaseAt, shouldRelease } from "./booking-policy.ts";
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
  // Reserved (coach, cash at the desk) follows the same 10-minute rule.
  assert.equal(shouldRelease({ ...b, status: "reserved" }, { date: "2026-10-01", time: 9.8 }), false);
  assert.equal(shouldRelease({ ...b, status: "reserved" }, { date: "2026-10-01", time: 9 + 50 / 60 }), true);
});

test("shouldRelease: online bookings not paid within the 15-minute window", () => {
  const b = { status: "pending", payment_status: "unpaid", amount: 400, date: "2026-10-05", start_hour: 18, pay_by: "2026-10-01T02:15:00Z" };
  const now = { date: "2026-10-01", time: 10 };
  assert.equal(shouldRelease(b, now, Date.parse("2026-10-01T02:14:59Z")), false); // 1 second left
  assert.equal(shouldRelease(b, now, Date.parse("2026-10-01T02:15:00Z")), true); // time's up
  assert.equal(shouldRelease({ ...b, payment_status: "for_verification" }, now, Date.parse("2026-10-01T03:00:00Z")), false); // sent in time
});

test("paymentDeadline: 15 minutes, or 10 minutes before the start if sooner", () => {
  const nowMs = Date.parse("2026-10-01T02:00:00Z");
  assert.equal(paymentDeadline(nowMs, "2026-10-01", 18, { date: "2026-10-01", time: 10 }) - nowMs, 15 * 60_000);
  // Slot at 10:30, booked at 10:00 → must pay by 10:20 (20 minutes)... capped at 15.
  assert.equal(paymentDeadline(nowMs, "2026-10-01", 10.5, { date: "2026-10-01", time: 10 }) - nowMs, 15 * 60_000);
  // Slot at 10:30, booked at 10:10 → pay by 10:20 (10 minutes).
  assert.equal(paymentDeadline(nowMs, "2026-10-01", 10.5, { date: "2026-10-01", time: 10 + 10 / 60 }) - nowMs, 10 * 60_000);
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
