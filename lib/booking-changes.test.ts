// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeChanges, type BookingFields } from "./booking-changes.ts";

const b: BookingFields = {
  court: "Badminton Court 1", date: "2026-10-12", startHour: 18, endHour: 19, name: "Juan", contact: "0917", notes: "",
  rateType: "regular", hourlyRate: 400, amount: 400, paymentMethod: "gcash", paymentRef: "",
};

test("describeChanges: nothing changed", () => assert.deepEqual(describeChanges(b, { ...b }), []));

test("describeChanges: lists each change in plain words", () => {
  assert.deepEqual(
    describeChanges(b, { ...b, court: "Badminton Court 2", endHour: 19.5, amount: 600, notes: "Bring rackets", paymentMethod: "cash", paymentRef: "123" }),
    [
      "Court: Badminton Court 1 → Badminton Court 2",
      "Time: Mon, Oct 12, 6:00 PM – 7:00 PM → Mon, Oct 12, 6:00 PM – 7:30 PM",
      "Notes: (blank) → “Bring rackets”",
      "Amount: ₱400 → ₱600",
      "Payment method: GCash → Cash",
      "Reference: (blank) → “123”",
    ]
  );
  assert.deepEqual(describeChanges(b, { ...b, rateType: "member", hourlyRate: 300 }), ["Rate: Regular ₱400/hr → Member ₱300/hr"]);
});
