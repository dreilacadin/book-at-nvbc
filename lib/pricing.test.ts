// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeBookingStatus,
  bookingStatusLabel,
  computePrice,
  formatPeso,
  isPaymentMethod,
  isPaymentStatus,
  isRateType,
  paymentLabel,
  rateFor,
  rateTypeLabel,
} from "./pricing.ts";

// computePrice(rateCharged, hours, regularRate = rateCharged)

test("computePrice: regular rate (no savings)", () => {
  assert.deepEqual(computePrice(350, 2), {
    hourlyRate: 350,
    regularRate: 350,
    hours: 2,
    total: 700,
    savings: 0,
  });
  // passing the regular rate explicitly gives the same result
  assert.deepEqual(computePrice(350, 2, 350), computePrice(350, 2));
});

test("computePrice: member price on fractional hours", () => {
  const p = computePrice(315, 1.5, 350); // member ₱315/hr, regular ₱350/hr
  assert.equal(p.regularRate * p.hours, 525);
  assert.equal(p.total, 472.5);
  assert.equal(p.savings, 52.5);
});

test("computePrice: rounds to the centavo without float noise", () => {
  const p = computePrice(283.33, 3, 333.33);
  assert.equal(p.total, 849.99);
  assert.equal(p.savings, 150);
  // regular total always equals total + savings
  assert.equal(
    Math.round((p.total + p.savings) * 100) / 100,
    Math.round(p.regularRate * p.hours * 100) / 100,
  );
});

test("computePrice: zero rate is free", () => {
  assert.equal(computePrice(0, 2, 400).total, 0);
  assert.equal(computePrice(0, 2, 400).savings, 800);
  assert.equal(computePrice(0, 2).total, 0);
  assert.equal(computePrice(0, 2).savings, 0);
});

test("computePrice: savings never go negative if a special price is above regular", () => {
  const p = computePrice(400, 2, 350);
  assert.equal(p.total, 800);
  assert.equal(p.savings, 0);
});

test("rateFor picks the price for the rate type", () => {
  const rates = { regular: 250, member: 180, coach: 150 };
  assert.equal(rateFor(rates, "regular"), 250);
  assert.equal(rateFor(rates, "member"), 180);
  assert.equal(rateFor(rates, "coach"), 150);
});

test("activeBookingStatus: online payments are pending until verified", () => {
  assert.equal(activeBookingStatus("gcash", "unpaid", 250), "pending");
  assert.equal(
    activeBookingStatus("gcash", "for_verification", 250),
    "pending",
  );
  assert.equal(activeBookingStatus("qrph", "for_verification", 250), "pending");
  assert.equal(activeBookingStatus("bpi", "unpaid", 250), "pending");
  assert.equal(activeBookingStatus("gcash", "paid", 250), "confirmed");
  assert.equal(activeBookingStatus("gcash", "waived", 250), "confirmed");
  assert.equal(activeBookingStatus("gcash", "unpaid", 0), "confirmed"); // nothing to pay
  assert.equal(activeBookingStatus("cash", "unpaid", 250), "confirmed"); // paid at the desk
});

test("formatPeso: whole amounts have no decimals, fractional show two", () => {
  assert.equal(formatPeso(0), "₱0");
  assert.equal(formatPeso(1500), "₱1,500");
  assert.equal(formatPeso(472.5), "₱472.50");
  assert.equal(formatPeso(849.99), "₱849.99");
});

test("type guards accept known ids and reject everything else", () => {
  assert.ok(isRateType("member"));
  assert.ok(!isRateType("vip"));
  assert.ok(!isRateType(undefined));
  assert.ok(isPaymentMethod("gcash"));
  assert.ok(!isPaymentMethod("paypal"));
  assert.ok(!isPaymentMethod(null));
  assert.ok(isPaymentStatus("for_verification"));
  assert.ok(!isPaymentStatus("pending")); // "pending" is a booking status, not a payment status
});

test("labels fall back to the raw id when unknown", () => {
  assert.equal(rateTypeLabel("coach"), "Coach");
  assert.equal(rateTypeLabel("mystery"), "mystery");
  assert.equal(paymentLabel("qrph"), "QR Ph");
  assert.equal(paymentLabel("mystery"), "mystery");
  assert.equal(bookingStatusLabel("pending"), "Pending");
  assert.equal(bookingStatusLabel("mystery"), "mystery");
});
