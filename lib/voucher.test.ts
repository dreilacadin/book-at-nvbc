// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultTerms,
  formatVoucherCode,
  normalizeVoucherCode,
  onDeckProblem,
  renderTerms,
  splitDiscount,
  voucherLeftLabel,
  voucherProblem,
  voucherState,
  voucherValueLabel,
  type Voucher,
} from "./voucher.ts";

const base: Voucher = {
  code: "VCH-7K3Q-9PXM", kind: "cash", value: 1000, maxDiscount: null, balance: 1000, maxUses: 1, uses: 0,
  status: "active", validFrom: null, expiresOn: null, sports: [], title: "", issuedTo: "", terms: "",
};
const today = "2026-11-03";

test("codes: format and normalize (typed, spaced, or the QR link)", () => {
  assert.equal(formatVoucherCode([0, 1, 2, 3, 4, 5, 6, 7]), "VCH-ABCD-EFGH");
  assert.equal(normalizeVoucherCode("vch 7k3q 9pxm"), "VCH-7K3Q-9PXM");
  assert.equal(normalizeVoucherCode("7K3Q9PXM"), "VCH-7K3Q-9PXM");
  assert.equal(normalizeVoucherCode("https://courts.nvbc.app/voucher#VCH-7K3Q-9PXM"), "VCH-7K3Q-9PXM");
  assert.equal(normalizeVoucherCode("NVBC-7K3Q-9PXM"), null); // a member code isn't a voucher
  assert.equal(normalizeVoucherCode("VCH-7K3Q"), null);
  assert.equal(normalizeVoucherCode(42), null);
});

test("labels: what it's worth and what's left", () => {
  assert.equal(voucherValueLabel({ kind: "free_hours", value: 2, maxDiscount: null }), "2 hours free");
  assert.equal(voucherValueLabel({ kind: "fixed", value: 200, maxDiscount: null }), "₱200 off");
  assert.equal(voucherValueLabel({ kind: "percent", value: 20, maxDiscount: 500 }), "20% off (up to ₱500)");
  assert.equal(voucherValueLabel({ kind: "cash", value: 1000, maxDiscount: null }), "₱1,000");
  assert.equal(voucherLeftLabel({ ...base, balance: 550 }), "₱550 of ₱1,000 left");
  assert.equal(voucherLeftLabel({ ...base, kind: "free_hours", value: 3, balance: 1.5 }), "1.5 of 3 hours left");
  assert.equal(voucherLeftLabel({ ...base, kind: "fixed", maxUses: 5, uses: 3 }), "2 of 5 uses left");
  assert.equal(voucherLeftLabel({ ...base, kind: "fixed", uses: 1 }), "Used");
});

test("state: void, expired and used up win over paused; not valid yet", () => {
  assert.equal(voucherState(base, today), "ready");
  assert.equal(voucherState({ ...base, status: "void" }, today), "void");
  assert.equal(voucherState({ ...base, expiresOn: "2026-11-02" }, today), "expired");
  assert.equal(voucherState({ ...base, expiresOn: today }, today), "ready"); // valid through its last day
  assert.equal(voucherState({ ...base, balance: 0, status: "paused" }, today), "used_up");
  assert.equal(voucherState({ ...base, kind: "percent", uses: 1 }, today), "used_up");
  assert.equal(voucherState({ ...base, status: "paused" }, today), "paused");
  assert.equal(voucherState({ ...base, validFrom: "2026-12-01" }, today), "not_yet");
});

test("problem: the booking's date must be within the voucher's dates; sports", () => {
  const b = { today, date: "2026-11-20", activity: "pickleball" };
  assert.equal(voucherProblem(base, b), null);
  assert.match(voucherProblem({ ...base, expiresOn: "2026-11-10" }, b)!, /on or before Tuesday, November 10, 2026/);
  // Not valid yet today, but the booking is on or after the start: fine.
  assert.equal(voucherProblem({ ...base, validFrom: "2026-11-15" }, b), null);
  assert.match(voucherProblem({ ...base, validFrom: "2026-11-25" }, b)!, /from/);
  assert.match(voucherProblem({ ...base, sports: ["badminton"] }, b)!, /Badminton only/);
  assert.match(voucherProblem({ ...base, status: "paused" }, b)!, /paused/);
});

test("splitDiscount: free hours at the rate charged, across a group's courts", () => {
  const courts = [{ hours: 2, rate: 450, amount: 900 }, { hours: 2, rate: 600, amount: 1200 }];
  const r = splitDiscount({ kind: "free_hours", value: 3, maxDiscount: null, balance: 3 }, courts);
  assert.deepEqual(r.shares, [{ amount: 900, hours: 2 }, { amount: 600, hours: 1 }]);
  assert.equal(r.total, 1500);
  assert.equal(r.hours, 3);
  // Half an hour left covers half an hour.
  assert.equal(splitDiscount({ kind: "free_hours", value: 3, maxDiscount: null, balance: 0.5 }, courts).total, 225);
});

test("splitDiscount: fixed, percent (with cap) and cash never go below ₱0", () => {
  const courts = [{ hours: 1, rate: 450, amount: 450 }, { hours: 1, rate: 600, amount: 600 }];
  assert.deepEqual(splitDiscount({ kind: "fixed", value: 500, maxDiscount: null, balance: 0 }, courts).shares.map((s) => s.amount), [450, 50]);
  assert.equal(splitDiscount({ kind: "fixed", value: 5000, maxDiscount: null, balance: 0 }, courts).total, 1050);
  assert.equal(splitDiscount({ kind: "percent", value: 20, maxDiscount: null, balance: 0 }, courts).total, 210);
  assert.equal(splitDiscount({ kind: "percent", value: 50, maxDiscount: 300, balance: 0 }, courts).total, 300);
  assert.equal(splitDiscount({ kind: "cash", value: 1000, maxDiscount: null, balance: 700 }, courts).total, 700);
  assert.equal(splitDiscount({ kind: "percent", value: 15, maxDiscount: null, balance: 0 }, [{ hours: 1.5, rate: 333.33, amount: 499.99 }]).total, 75);
});

test("terms: defaults fill in the value, dates, sports and uses", () => {
  const v = { ...base, kind: "percent" as const, value: 20, maxDiscount: 500, maxUses: 5, expiresOn: "2027-01-31", sports: ["badminton"], terms: defaultTerms("percent") };
  const lines = renderTerms(v, "courts.nvbc.app");
  assert.equal(lines[0], "Takes 20% off the court fee of a booking for badminton, up to ₱500 off each time. Can be used on up to 5 bookings.");
  assert.equal(lines[1], "Valid for bookings on or before Sunday, January 31, 2027.");
  assert.ok(lines.some((l) => l.includes("courts.nvbc.app")));
  assert.ok(!lines.join(" ").includes("{"));
  const cash = renderTerms({ ...base, terms: defaultTerms("cash") }, "x");
  assert.match(cash[0], /^Worth ₱1,000 towards court fees .* for any sport\./);
  assert.equal(cash[1], "No expiry date.");
  assert.match(renderTerms({ ...base, kind: "free_hours", value: 2, terms: defaultTerms("free_hours") }, "x")[0], /^Good for 2 hours of court time/);
});

const session: Voucher = { ...base, kind: "ondeck_session", value: 1, balance: 1, sports: ["pickleball"] };

test("On Deck sessions: labels, and redeemed", () => {
  assert.equal(voucherValueLabel(session), "1 free Pickleball Open Play session");
  assert.equal(voucherValueLabel({ ...session, value: 2, sports: ["badminton"] }), "2 free Badminton Queueing sessions");
  assert.equal(voucherLeftLabel({ ...session, value: 3, balance: 2 }), "2 of 3 sessions left");
  assert.equal(voucherState({ ...session, balance: 0 }, today), "used_up");
  // Redeemed (by staff) wins over expired and used up; void wins over redeemed.
  assert.equal(voucherState({ ...base, status: "redeemed", balance: 0, expiresOn: "2026-11-01" }, today), "redeemed");
  assert.equal(voucherState({ ...base, status: "void" }, today), "void");
  assert.match(voucherProblem({ ...base, status: "redeemed" }, { today, date: today, activity: "badminton" })!, /already been redeemed/);
});

test("On Deck sessions: not for court bookings; court vouchers not for On Deck", () => {
  const b = { today, date: "2026-11-20", activity: "pickleball" };
  assert.match(voucherProblem(session, b)!, /free Pickleball Open Play Session at NVBC On Deck .*not for court bookings/);
  assert.match(voucherProblem({ ...session, status: "void" }, b)!, /no longer valid/); // what's wrong with it comes first
  assert.deepEqual(splitDiscount(session, [{ hours: 1, rate: 400, amount: 400 }]).shares, [{ amount: 0, hours: 0 }]);
  const s = { today, date: today };
  assert.equal(onDeckProblem(session, s), null);
  assert.equal(onDeckProblem(session, { ...s, sport: "pickleball" }), null);
  assert.match(onDeckProblem(session, { ...s, sport: "badminton" })!, /Pickleball Open Play Session only/);
  assert.match(onDeckProblem(base, s)!, /court voucher \(cash voucher\)/);
  assert.match(onDeckProblem({ ...session, balance: 0 }, s)!, /fully used/);
  assert.match(onDeckProblem({ ...session, expiresOn: "2026-11-10" }, { ...s, date: "2026-11-11" })!, /sessions on or before/);
  assert.match(onDeckProblem({ ...session, validFrom: "2026-11-05" }, s)!, /sessions from/);
});

test("On Deck sessions: default terms", () => {
  const lines = renderTerms({ ...session, expiresOn: "2027-01-31", terms: defaultTerms("ondeck_session") }, "courts.nvbc.app");
  assert.equal(lines[0], "Good for 1 free Pickleball Open Play session at NVBC On Deck (ondeck.nvbc.app).");
  assert.equal(lines[1], "Valid for sessions on or before Sunday, January 31, 2027.");
  assert.ok(lines.some((l) => l.startsWith("For Pickleball Open Play at NVBC On Deck only")));
  assert.ok(!lines.join(" ").includes("{"));
});
