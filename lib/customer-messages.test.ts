// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { customerNotice, isEmail, type NoticeBooking } from "./customer-messages.ts";

const b: NoticeBooking = {
  code: "NV-ABC123", name: "Juan Dela Cruz", courtName: "Badminton Court 1", date: "2026-10-20",
  startHour: 18, endHour: 19.5, amount: 600, paymentStatus: "paid", paymentMethod: "gcash", status: "confirmed", rejectedNote: "",
};
const link = "https://example.com/my-booking#NV-ABC123";

test("confirmed: greets by first name, has the court, time, code and link", () => {
  const n = customerNotice("confirmed", b, { link });
  assert.match(n.text, /^Hi Juan,/);
  assert.match(n.text, /₱600/);
  assert.match(n.text, /Badminton Court 1, Tuesday, October 20, 2026, 6:00 PM – 7:30 PM/);
  assert.ok(n.text.includes("NV-ABC123") && n.text.includes(link));
  assert.equal(n.title, "Booking confirmed ✓");
});

test("rejected: gives the staff note and the deadline", () => {
  const n = customerNotice("rejected", { ...b, paymentStatus: "rejected", status: "pending", rejectedNote: "Amount was ₱300, not ₱600." }, { link, payByClock: "3:45 PM" });
  assert.match(n.body, /^Amount was ₱300, not ₱600\. Please send a correct payment or screenshot by 3:45 PM/);
  assert.match(n.text, /Reason: Amount was ₱300/);
  assert.match(n.text, /by 3:45 PM/);
  assert.match(n.subject, /NV-ABC123/);
});

test("upcoming: reminds coaches paying cash, and flags unverified payments", () => {
  assert.doesNotMatch(customerNotice("upcoming", b, { link }).body, /pay|confirmed yet/);
  assert.match(customerNotice("upcoming", { ...b, status: "reserved", paymentStatus: "unpaid", paymentMethod: "cash" }, { link }).body, /pay ₱600 at the front desk/);
  assert.match(customerNotice("upcoming", { ...b, status: "pending", paymentStatus: "for_verification" }, { link }).text, /hasn't been confirmed yet/);
  assert.equal(customerNotice("upcoming", b, { link }).subject, "Reminder: Badminton Court 1 at 6:00 PM today");
});

test("isEmail", () => {
  assert.ok(isEmail("a.b@gmail.com"));
  for (const bad of ["", "a@b", "a b@c.com", "@c.com", "x".repeat(120) + "@a.com"]) assert.ok(!isEmail(bad), bad);
});

test("message: shows who sent it and the text; push body is shortened", () => {
  const long = "x".repeat(200);
  const n = customerNotice("message", b, { link, message: "Court 1 is wet — we moved you to Court 2.", from: "Janette" });
  assert.equal(n.title, "New message from NVBC");
  assert.match(n.text, /Janette from NVBC sent you a message/);
  assert.match(n.text, /“Court 1 is wet — we moved you to Court 2\.”/);
  assert.ok(n.text.includes(link));
  assert.equal(customerNotice("message", b, { link, message: long }).body.length, 138);
});

test("refunded: amount and reference", () => {
  const n = customerNotice("refunded", { ...b, status: "cancelled", refundAmount: 1200, refundRef: "GC 555" }, { link });
  assert.equal(n.title, "Refund sent");
  assert.match(n.body, /₱1,200 \(reference GC 555\)/);
  assert.match(n.text, /refund of ₱1,200/);
});

test("coaching accepted / declined", () => {
  const a = customerNotice("coaching_accepted", { ...b, coachName: "Coach Ana", coachNote: "Bring water!" }, { link });
  assert.equal(a.title, "Coaching session confirmed");
  assert.match(a.text, /Coach Ana accepted/);
  assert.match(a.text, /Coach Ana says: “Bring water!”/);
  assert.match(a.text, /pay your coaching fee to Coach Ana directly/);
  const d = customerNotice("coaching_declined", { ...b, coachName: "Coach Ana", coachNote: "" }, { link });
  assert.match(d.body, /Your court booking is still on/);
  assert.doesNotMatch(d.text, /says:/);
});
