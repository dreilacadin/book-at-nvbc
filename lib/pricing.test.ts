// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeBookingStatus,
  bookingStatusLabel,
  computePrice,
  formatPeso,
  hasPaymentProof,
  isProofImage,
  isPaymentMethod,
  isPaymentStatus,
  isRateType,
  isWeekend,
  paymentLabel,
  rateFor,
  ratesForDate,
  rateTypeLabel,
  rateTypesFor,
  toSportPricing,
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

test("isWeekend: Saturday and Sunday only", () => {
  assert.ok(isWeekend("2026-09-26")); // Saturday
  assert.ok(isWeekend("2026-09-27")); // Sunday
  assert.ok(!isWeekend("2026-09-28")); // Monday
  assert.ok(!isWeekend("2026-10-02")); // Friday
});

test("ratesForDate: weekend prices apply on weekends only when switched on", () => {
  const plan = {
    memberRates: true,
    weekendRates: true,
    weekday: { regular: 250, member: 200, coach: 150 },
    weekend: { regular: 300, member: 240, coach: 180 },
  };
  assert.deepEqual(ratesForDate(plan, "2026-09-28"), plan.weekday);
  assert.deepEqual(ratesForDate(plan, "2026-09-27"), plan.weekend);
  assert.deepEqual(ratesForDate({ ...plan, weekendRates: false }, "2026-09-27"), plan.weekday);
});

test("ratesForDate: without member rates everyone pays the standard rate", () => {
  const plan = {
    memberRates: false,
    weekendRates: true,
    weekday: { regular: 200, member: 150, coach: 120 },
    weekend: { regular: 260, member: 150, coach: 120 },
  };
  assert.deepEqual(ratesForDate(plan, "2026-09-28"), { regular: 200, member: 200, coach: 200 });
  assert.deepEqual(ratesForDate(plan, "2026-09-26"), { regular: 260, member: 260, coach: 260 });
  assert.deepEqual(rateTypesFor(plan), ["regular"]);
  assert.deepEqual(rateTypesFor({ memberRates: true }), ["regular", "member", "coach"]);
});

test("toSportPricing: fills a missing plan from the older prices", () => {
  const legacy = { regular: 250, member: 180, coach: 150 };
  assert.deepEqual(toSportPricing(undefined, legacy), {
    memberRates: true,
    weekendRates: false,
    weekday: legacy,
    weekend: legacy,
  });
  const p = toSportPricing({ memberRates: false, weekendRates: true, weekday: { regular: "300" } }, legacy);
  assert.equal(p.memberRates, false);
  assert.equal(p.weekendRates, true);
  assert.deepEqual(p.weekday, { regular: 300, member: 300, coach: 300 });
  assert.deepEqual(p.weekend, p.weekday); // no weekend prices stored yet → copy weekday
});

test("isProofImage: accepts small image data URLs only", () => {
  assert.ok(isProofImage("data:image/png;base64,iVBORw0KGgo="));
  assert.ok(isProofImage("data:image/jpeg;base64,/9j/4AAQ"));
  assert.ok(!isProofImage("data:image/svg+xml;base64,PHN2Zz4="));
  assert.ok(!isProofImage("data:text/html;base64,PGh0bWw+"));
  assert.ok(!isProofImage("https://example.com/receipt.png"));
  assert.ok(!isProofImage("data:image/png;base64," + "A".repeat(1_000_000)));
  assert.ok(!isProofImage(undefined));
});

test("hasPaymentProof: a reference number or a screenshot is enough", () => {
  assert.ok(hasPaymentProof("1234 5678", ""));
  assert.ok(hasPaymentProof("", "data:image/png;base64,iVBORw0KGgo="));
  assert.ok(!hasPaymentProof("   ", ""));
});
