// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingPhase, minutesUntilStart, paymentDeadline, refundOnCancel, releaseAt, shouldRelease, startedUnverified } from "./booking-policy.ts";
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

test("bookingPhase: paid bookings go in progress at the start and completed at the end", () => {
  const b = { status: "confirmed", phase: null, payment_status: "paid", amount: 400, date: "2026-10-01", start_hour: 10, end_hour: 11.5 };
  assert.equal(bookingPhase(b, { date: "2026-10-01", time: 9.9 }), null); // upcoming
  assert.equal(bookingPhase(b, { date: "2026-10-01", time: 10 }), "in_progress");
  assert.equal(bookingPhase(b, { date: "2026-10-01", time: 11.49 }), "in_progress");
  assert.equal(bookingPhase(b, { date: "2026-10-01", time: 11.5 }), "completed");
  assert.equal(bookingPhase(b, { date: "2026-10-02", time: 8 }), "completed"); // next day
  assert.equal(bookingPhase(b, { date: "2026-09-30", time: 23 }), null); // day before
  // Ends at midnight
  const late = { ...b, start_hour: 23, end_hour: 24 };
  assert.equal(bookingPhase(late, { date: "2026-10-01", time: 23.99 }), "in_progress");
  assert.equal(bookingPhase(late, { date: "2026-10-02", time: 0 }), "completed");
});

test("bookingPhase: unpaid bookings have no automatic phase; staff can set one; cancelled never", () => {
  const b = { status: "pending", phase: null, payment_status: "unpaid", amount: 400, date: "2026-10-01", start_hour: 10, end_hour: 11 };
  assert.equal(bookingPhase(b, { date: "2026-10-01", time: 10.5 }), null);
  assert.equal(bookingPhase({ ...b, status: "reserved" }, { date: "2026-10-02", time: 9 }), null);
  assert.equal(bookingPhase({ ...b, phase: "in_progress" }, { date: "2026-10-01", time: 10.5 }), "in_progress");
  // A manual mark wins over the clock, both ways (e.g. finished early, or still playing)
  assert.equal(bookingPhase({ ...b, status: "confirmed", phase: "completed" }, { date: "2026-10-01", time: 10.2 }), "completed");
  assert.equal(bookingPhase({ ...b, status: "confirmed", phase: "in_progress" }, { date: "2026-10-01", time: 12 }), "in_progress");
  assert.equal(bookingPhase({ ...b, status: "cancelled", phase: "completed" }, { date: "2026-10-01", time: 12 }), null);
  // Older bookings could be "confirmed" but unpaid: no automatic phase for those.
  assert.equal(bookingPhase({ ...b, status: "confirmed" }, { date: "2026-10-01", time: 12 }), null);
  // Free (No charge / ₱0) bookings do follow the clock.
  assert.equal(bookingPhase({ ...b, status: "confirmed", payment_status: "waived" }, { date: "2026-10-01", time: 12 }), "completed");
  assert.equal(bookingPhase({ ...b, status: "confirmed", amount: 0 }, { date: "2026-10-01", time: 10.5 }), "in_progress");
});

test("shouldRelease: never for bookings marked in progress/completed or restored by staff", () => {
  const b = { status: "pending", payment_status: "unpaid", amount: 400, date: "2026-10-01", start_hour: 10 };
  const late = { date: "2026-10-01", time: 10.5 };
  assert.equal(shouldRelease(b, late), true);
  assert.equal(shouldRelease({ ...b, phase: "in_progress" }, late), false);
  assert.equal(shouldRelease({ ...b, phase: "completed" }, late), false);
  assert.equal(shouldRelease({ ...b, auto_release: false }, late), false);
});

test("startedUnverified flags started bookings whose online payment wasn't verified", () => {
  const b = { status: "pending", payment_status: "for_verification", phase: null, date: "2026-10-01", start_hour: 10 };
  assert.equal(startedUnverified(b, { date: "2026-10-01", time: 9.5 }), false);
  assert.equal(startedUnverified(b, { date: "2026-10-01", time: 10 }), true);
  assert.equal(startedUnverified({ ...b, phase: "in_progress" }, { date: "2026-10-01", time: 10.5 }), false);
  assert.equal(startedUnverified({ ...b, payment_status: "unpaid" }, { date: "2026-10-01", time: 10.5 }), false);
});
