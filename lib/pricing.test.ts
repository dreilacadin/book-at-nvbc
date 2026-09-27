// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePrice,
  formatPeso,
  isPaymentMethod,
  isPaymentStatus,
  isRateType,
  paymentLabel,
  rateTypeLabel,
} from "./pricing.ts";

test("computePrice: no discount", () => {
  assert.deepEqual(computePrice(350, 2, 0), {
    hourlyRate: 350,
    hours: 2,
    subtotal: 700,
    discountPct: 0,
    discount: 0,
    total: 700,
  });
});

test("computePrice: percentage discount on fractional hours", () => {
  const p = computePrice(350, 1.5, 10);
  assert.equal(p.subtotal, 525);
  assert.equal(p.total, 472.5);
  assert.equal(p.discount, 52.5);
});

test("computePrice: rounds to the centavo without float noise", () => {
  const p = computePrice(333.33, 3, 15);
  assert.equal(p.subtotal, 999.99);
  assert.equal(p.total, 849.99);
  assert.equal(p.discount, 150);
  // subtotal always equals total + discount
  assert.equal(Math.round((p.total + p.discount) * 100) / 100, p.subtotal);
});

test("computePrice: 100% discount and zero rate are free", () => {
  assert.equal(computePrice(400, 2, 100).total, 0);
  assert.equal(computePrice(400, 2, 100).discount, 800);
  assert.equal(computePrice(0, 2, 0).total, 0);
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
  assert.ok(!isPaymentStatus("pending"));
});

test("labels fall back to the raw id when unknown", () => {
  assert.equal(rateTypeLabel("coach"), "Coach");
  assert.equal(rateTypeLabel("mystery"), "mystery");
  assert.equal(paymentLabel("qrph"), "QR Ph");
  assert.equal(paymentLabel("mystery"), "mystery");
});
