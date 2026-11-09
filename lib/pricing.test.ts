// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeBookingStatus,
  gcashAccounts,
  bookingStatusLabel,
  computePrice,
  formatPeso,
  hasPaymentProof,
  isProofImage,
  isPaymentMethod,
  isPaymentStatus,
  isRateType,
  isWeekend,
  offPeakHours,
  offPeakOn,
  parseOffPeak,
  paymentLabel,
  planForCourt,
  priceFor,
  rateFor,
  ratesForDate,
  rateTypeLabel,
  rateTypesFor,
  toCourtRates,
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

test("activeBookingStatus: confirmed only once paid; cash-at-desk is reserved, online is pending", () => {
  assert.equal(activeBookingStatus("gcash", "unpaid", 250), "pending");
  assert.equal(activeBookingStatus("qrph", "for_verification", 250), "pending");
  assert.equal(activeBookingStatus("bpi", "refunded", 250), "pending");
  assert.equal(activeBookingStatus("cash", "unpaid", 250), "reserved"); // coach paying at the desk
  assert.equal(activeBookingStatus("cash", "paid", 250), "confirmed");
  assert.equal(activeBookingStatus("gcash", "paid", 250), "confirmed");
  assert.equal(activeBookingStatus("gcash", "waived", 250), "confirmed");
  assert.equal(activeBookingStatus("cash", "unpaid", 0), "confirmed"); // nothing to pay
  assert.equal(bookingStatusLabel("reserved"), "Reserved");
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
    coachRates: true,
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
    coachRates: false,
    weekendRates: true,
    weekday: { regular: 200, member: 150, coach: 120 },
    weekend: { regular: 260, member: 150, coach: 120 },
  };
  assert.deepEqual(ratesForDate(plan, "2026-09-28"), { regular: 200, member: 200, coach: 200 });
  assert.deepEqual(ratesForDate(plan, "2026-09-26"), { regular: 260, member: 260, coach: 260 });
  assert.deepEqual(rateTypesFor(plan), ["regular"]);
  assert.deepEqual(rateTypesFor({ memberRates: true, coachRates: true }), ["regular", "member", "coach"]);
});

test("toSportPricing: fills a missing plan from the older prices", () => {
  const legacy = { regular: 250, member: 180, coach: 150 };
  assert.deepEqual(toSportPricing(undefined, legacy), {
    memberRates: true,
    coachRates: true,
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

test("member and coach rates switch on and off separately", () => {
  const plan = {
    memberRates: false,
    coachRates: true,
    weekendRates: false,
    weekday: { regular: 400, member: 300, coach: 250 },
    weekend: { regular: 400, member: 300, coach: 250 },
  };
  assert.deepEqual(rateTypesFor(plan), ["regular", "coach"]);
  assert.deepEqual(ratesForDate(plan, "2026-09-28"), { regular: 400, member: 400, coach: 250 });
  assert.deepEqual(rateTypesFor({ ...plan, memberRates: true, coachRates: false }), ["regular", "member"]);
  assert.deepEqual(ratesForDate({ ...plan, memberRates: true, coachRates: false }, "2026-09-28"), { regular: 400, member: 300, coach: 400 });
});

test("toSportPricing: plans saved with one member & coach switch keep working", () => {
  const legacy = { regular: 400, member: 300, coach: 250 };
  assert.equal(toSportPricing({ memberRates: false }, legacy).coachRates, false); // both were off
  assert.equal(toSportPricing({ memberRates: true }, legacy).coachRates, true); // both were on
  assert.equal(toSportPricing({ memberRates: true, coachRates: false }, legacy).coachRates, false);
});

test("gcashAccounts: main account first, then extras; blank numbers skipped", () => {
  assert.deepEqual(
    gcashAccounts({
      gcash_name: " NVBC ", gcash_number: " 0917 000 0001 ",
      gcash_more: [{ name: "Front desk", number: "0917 000 0002" }, { name: "No number", number: "  " }],
    }),
    [{ name: "NVBC", number: "0917 000 0001" }, { name: "Front desk", number: "0917 000 0002" }]
  );
  assert.deepEqual(gcashAccounts({ gcash_name: "", gcash_number: "", gcash_more: [{ name: "", number: "0918" }] }), [{ name: "", number: "0918" }]);
  assert.deepEqual(gcashAccounts({ gcash_name: "x", gcash_number: "" }), []);
});

test("ratesForDate: holidays use weekend prices", () => {
  const plan = toSportPricing({ weekendRates: true, weekday: { regular: 400 }, weekend: { regular: 450 } }, { regular: 400, member: 400, coach: 400 });
  assert.equal(ratesForDate(plan, "2026-12-25").regular, 400); // a Friday
  assert.equal(ratesForDate(plan, "2026-12-25", true).regular, 450); // Christmas
  assert.equal(ratesForDate({ ...plan, weekendRates: false }, "2026-12-25", true).regular, 400);
});

test("planForCourt: a shared court's own prices, with its own weekend switch", () => {
  const plan = toSportPricing(
    { memberRates: true, coachRates: false, weekendRates: false, weekday: { regular: 400, member: 300 } },
    { regular: 0, member: 0, coach: 0 }
  );
  const own = { weekendRates: true, weekday: { regular: 500, member: 380, coach: 500 }, weekend: { regular: 550, member: 420, coach: 550 } };
  const s = { rate_plans: { pickleball: plan }, court_rates: { pickleball: { "4": own } } };
  assert.deepEqual(planForCourt(s, "pickleball", 4), { ...plan, ...own });
  assert.equal(planForCourt(s, "pickleball", 1), plan); // no own prices: the activity's
  assert.equal(planForCourt(s, "zumba", 4), undefined);
  // Weekend prices on the court even though the sport has none.
  assert.deepEqual(ratesForDate(planForCourt(s, "pickleball", 4)!, "2026-09-26"), { regular: 550, member: 420, coach: 550 });
  assert.deepEqual(ratesForDate(planForCourt(s, "pickleball", 4)!, "2026-09-28"), { regular: 500, member: 380, coach: 500 });
  assert.equal(ratesForDate(plan, "2026-09-26").regular, 400);
  // Its weekend switch off: weekday prices every day, even if the sport has weekend prices.
  const off = { rate_plans: { pickleball: { ...plan, weekendRates: true } }, court_rates: { pickleball: { "4": { ...own, weekendRates: false } } } };
  assert.equal(ratesForDate(planForCourt(off, "pickleball", 4)!, "2026-09-26").regular, 500);
  // The sport's Member switch still applies.
  assert.deepEqual(ratesForDate({ ...planForCourt(s, "pickleball", 4)!, memberRates: false }, "2026-09-28"), { regular: 500, member: 500, coach: 500 });
});

test("toCourtRates: keeps activities and court ids, fills missing prices", () => {
  const isActivity = (id: string) => id === "pickleball";
  assert.deepEqual(
    toCourtRates({ pickleball: { "4": { weekday: { regular: 500 } }, x: {} }, tennis: { "1": {} } }, isActivity),
    { pickleball: { "4": { weekendRates: false, weekday: { regular: 500, member: 500, coach: 500 }, weekend: { regular: 500, member: 500, coach: 500 } } } }
  );
  assert.deepEqual(toCourtRates(null, isActivity), {});
});

test("parseOffPeak: periods and per-sport prices; blank prices mean no off-peak for that sport", () => {
  assert.equal(parseOffPeak(null), null);
  assert.equal(parseOffPeak({ periods: [], prices: { badminton: 300 } }), null); // no periods: off
  assert.deepEqual(
    parseOffPeak({ periods: [{ days: [5, 1, 1, "2"], from: 8, to: 15.5 }], prices: { badminton: "300", pickleball: "", zumba: 250.555 } }),
    { periods: [{ days: [1, 2, 5], from: 8, to: 15.5 }], prices: { badminton: 300, zumba: 250.56 } }
  );
  // Unknown activities are dropped.
  assert.deepEqual(parseOffPeak({ periods: [{ days: [0], from: 6, to: 9 }], prices: { gone: 100 } }, (id) => id !== "gone"),
    { periods: [{ days: [0], from: 6, to: 9 }], prices: {} });
  for (const bad of [
    { periods: [{ days: [], from: 8, to: 10 }] }, // no days
    { periods: [{ days: [1], from: 10, to: 10 }] }, // ends at the start
    { periods: [{ days: [1], from: 8.25, to: 10 }] }, // not a half hour
    { periods: [{ days: [1], from: 8, to: 25 }] },
    { periods: [{ days: [1], from: 8, to: 10 }], prices: { badminton: -5 } },
    { periods: [{ days: [1], from: 8, to: 10 }], prices: { badminton: "abc" } },
    "yes",
  ]) assert.equal(parseOffPeak(bad), "invalid", JSON.stringify(bad));
});

test("offPeakOn: the sport's off-peak times on that weekday, overlapping periods merged", () => {
  const op = {
    periods: [
      { days: [1, 2, 3, 4, 5], from: 8, to: 12 },
      { days: [1], from: 11, to: 15 }, // overlaps on Mondays
      { days: [6], from: 6, to: 9 },
    ],
    prices: { badminton: 300 },
  };
  assert.deepEqual(offPeakOn(op, "badminton", "2026-11-09"), { price: 300, ranges: [[8, 15]] }); // Monday
  assert.deepEqual(offPeakOn(op, "badminton", "2026-11-10"), { price: 300, ranges: [[8, 12]] }); // Tuesday
  assert.deepEqual(offPeakOn(op, "badminton", "2026-11-14"), { price: 300, ranges: [[6, 9]] }); // Saturday
  assert.equal(offPeakOn(op, "badminton", "2026-11-15"), null); // Sunday: none
  assert.equal(offPeakOn(op, "pickleball", "2026-11-09"), null); // no off-peak price
  assert.equal(offPeakOn(null, "badminton", "2026-11-09"), null);
  assert.equal(offPeakHours({ price: 300, ranges: [[8, 12], [14, 16]] }, 11, 15), 2); // 11–12 and 14–15
  assert.equal(offPeakHours(null, 8, 10), 0);
});

test("priceFor: each part at its own price at the Regular rate; Member and Coach unchanged", () => {
  const rates = { regular: 400, member: 320, coach: 280 };
  const op = { price: 300, ranges: [[8, 15]] as [number, number][] };
  // All off-peak.
  assert.deepEqual(priceFor(rates, "regular", op, 9, 11), { hourlyRate: 300, regularRate: 300, hours: 2, total: 600, savings: 0, offPeakHours: 2 });
  // 2:00–5:00 PM: one hour off-peak, two at the usual price.
  const mixed = priceFor(rates, "regular", op, 14, 17);
  assert.equal(mixed.total, 1100);
  assert.equal(mixed.offPeakHours, 1);
  assert.equal(mixed.hourlyRate, 366.67); // the average
  // Half hours.
  assert.equal(priceFor(rates, "regular", op, 14.5, 16).total, 150 + 400);
  // Outside off-peak: as before.
  assert.deepEqual(priceFor(rates, "regular", op, 16, 18), { ...computePrice(400, 2), offPeakHours: 0 });
  assert.deepEqual(priceFor(rates, "regular", null, 9, 11), { ...computePrice(400, 2), offPeakHours: 0 });
  // Members pay the member price; savings are against the Regular price including off-peak.
  assert.deepEqual(priceFor(rates, "member", op, 9, 11), { hourlyRate: 320, regularRate: 300, hours: 2, total: 640, savings: 0, offPeakHours: 0 });
  assert.equal(priceFor(rates, "member", op, 14, 17).savings, 1100 - 960);
  assert.equal(priceFor(rates, "coach", op, 16, 18).total, 560);
});
