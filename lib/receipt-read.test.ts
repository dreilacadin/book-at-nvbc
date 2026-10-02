// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { readReceipt } from "./receipt-read.ts";

test("GCash Express Send receipt", () => {
  const text = `Sent via GCash\nMI****L A.\n+63 977 752 9188\nAmount 400.00\nTotal Amount Sent ₱400.00\nRef No. 1012 345 678901 Sep 30, 2026 5:04 PM`;
  assert.deepEqual(readReceipt(text), { reference: "1012 345 678901", amount: 400 });
});

test("OCR reads ₱ as P, and the amount on the next line", () => {
  const text = `Payment successful\nTotal Amount\nP1,250.00\nReference No.: 5123 456 789012`;
  assert.deepEqual(readReceipt(text), { reference: "5123 456 789012", amount: 1250 });
});

test("BPI / InstaPay transfer", () => {
  const text = `Transfer successful\nAmount PHP 600.00\nTransfer fee PHP 0.00\nReference number 20261002ABC12345\nOctober 2, 2026 10:15 AM`;
  assert.deepEqual(readReceipt(text), { reference: "20261002ABC12345", amount: 600 });
});

test("Maya: reference ID and a ₱ amount without an amount label", () => {
  const text = `You paid ₱ 225.00\nto NVBC\nReference ID 7C2A 91F0 3B11\nPaid with Maya Wallet`;
  assert.deepEqual(readReceipt(text), { reference: "7C2A 91F0 3B11", amount: 225 });
});

test("GCash reference without a readable label", () => {
  assert.equal(readReceipt("blurry text 1012 345 678901 more").reference, "1012 345 678901");
});

test("nothing readable", () => {
  assert.deepEqual(readReceipt("Thank you!\nSee you"), { reference: null, amount: null });
});
