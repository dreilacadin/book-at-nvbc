// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { availabilityText, availableAt, cleanAvailability, isBirthday, newCoachCode, normalizeCoachCode, validateCoachForm } from "./coach.ts";

test("cleanAvailability: sorts, merges overlaps, rejects bad ranges", () => {
  assert.deepEqual(cleanAvailability([{ day: 1, from: 14, to: 18 }, { day: 1, from: 8, to: 12 }, { day: 1, from: 11, to: 13 }]),
    [{ day: 1, from: 8, to: 13 }, { day: 1, from: 14, to: 18 }]);
  assert.match(String(cleanAvailability([{ day: 1, from: 12, to: 9 }])), /end time/);
  assert.match(String(cleanAvailability([{ day: 9, from: 8, to: 9 }])), /Check/);
});

test("availableAt: the whole booking must fit in one range on that weekday", () => {
  const a = [{ day: 1, from: 8, to: 12 }]; // Mondays 8–12
  assert.ok(availableAt(a, "2026-10-12", 9, 11)); // a Monday
  assert.ok(!availableAt(a, "2026-10-12", 11, 13));
  assert.ok(!availableAt(a, "2026-10-13", 9, 10)); // Tuesday
});

test("availabilityText", () => {
  assert.equal(availabilityText([{ day: 1, from: 8, to: 12 }, { day: 1, from: 17, to: 21 }, { day: 6, from: 9, to: 15 }]),
    "Mon 8:00 AM – 12:00 PM, 5:00 PM – 9:00 PM · Sat 9:00 AM – 3:00 PM");
});

test("coach codes", () => {
  let i = 0;
  assert.match(newCoachCode(() => i++ % 31), /^COACH-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(normalizeCoachCode("coach 7k3q 9pxm"), "COACH-7K3Q-9PXM");
  assert.equal(normalizeCoachCode("7K3Q9PXM"), "COACH-7K3Q-9PXM");
  assert.equal(normalizeCoachCode("NVBC-COACH-2026"), null);
});

test("validateCoachForm", () => {
  const ok = { fullName: "Juan Dela Cruz", nickname: "Coach Juan", gender: "man", birthday: "1990-05-17", email: "Juan@Example.com", mobile: "0917 123 4567", sports: ["badminton", "golf"],
    rates: "₱500/hour", availability: [{ day: 1, from: 8, to: 12 }] };
  const r = validateCoachForm(ok, ["badminton", "pickleball"]);
  assert.ok(typeof r !== "string");
  assert.equal(r.email, "juan@example.com");
  assert.deepEqual(r.sports, ["badminton"]);
  assert.match(String(validateCoachForm({ ...ok, fullName: "Juan" }, ["badminton"])), /full legal name/);
  assert.match(String(validateCoachForm({ ...ok, nickname: "" }, ["badminton"])), /customers will see/);
  assert.match(String(validateCoachForm({ ...ok, gender: "self_describe" }, ["badminton"])), /Describe/);
  assert.equal((validateCoachForm({ ...ok, gender: "self_describe", genderSelf: "Genderfluid" }, ["badminton"]) as { genderSelf: string }).genderSelf, "Genderfluid");
  assert.match(String(validateCoachForm({ ...ok, birthday: "2026-02-30" }, ["badminton"])), /birthday/);
  assert.match(String(validateCoachForm({ ...ok, gender: "x" }, ["badminton"])), /gender/);
  assert.match(String(validateCoachForm({ ...ok, availability: [] }, ["badminton"])), /at least one/);
});

test("isBirthday, with Feb 29 on Feb 28 in other years", () => {
  assert.ok(isBirthday("1990-10-10", "2026-10-10"));
  assert.ok(!isBirthday("1990-10-11", "2026-10-10"));
  assert.ok(isBirthday("2000-02-29", "2026-02-28"));
  assert.ok(isBirthday("2000-02-29", "2028-02-29"));
  assert.ok(!isBirthday("2000-02-29", "2028-02-28"));
  assert.ok(!isBirthday(null, "2026-10-10"));
});
