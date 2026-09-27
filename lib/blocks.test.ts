// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { blockAppliesOn, blockedSlots, describeRepeat, findBlockConflict, type CourtBlock } from "./blocks.ts";

const openPlay: CourtBlock = {
  id: 1, label: "Open Play", court_ids: [1, 2], weekdays: [2, 4], // Tue, Thu
  start_date: "2026-09-01", end_date: null, start_hour: 18, end_hour: 21, notes: "",
};
const oneOff: CourtBlock = {
  id: 2, label: "Maintenance", court_ids: [3], weekdays: [],
  start_date: "2026-10-05", end_date: "2026-10-05", start_hour: 8, end_hour: 12, notes: "",
};

test("blockAppliesOn: weekly blocks repeat on their weekdays within the date range", () => {
  assert.ok(blockAppliesOn(openPlay, "2026-09-29")); // Tuesday
  assert.ok(blockAppliesOn(openPlay, "2026-10-01")); // Thursday
  assert.ok(!blockAppliesOn(openPlay, "2026-09-30")); // Wednesday
  assert.ok(!blockAppliesOn(openPlay, "2026-08-25")); // Tuesday before it starts
  assert.ok(!blockAppliesOn({ ...openPlay, end_date: "2026-09-30" }, "2026-10-06")); // after it ends
});

test("blockAppliesOn: one-off blocks apply on their date only", () => {
  assert.ok(blockAppliesOn(oneOff, "2026-10-05"));
  assert.ok(!blockAppliesOn(oneOff, "2026-10-12"));
});

test("blockedSlots lists each reserved court-hour with its label", () => {
  const m = blockedSlots([openPlay, oneOff], "2026-09-29");
  assert.equal(m.size, 6); // 2 courts × 3 hours
  assert.equal(m.get("1:18"), "Open Play");
  assert.equal(m.get("2:20"), "Open Play");
  assert.equal(m.get("1:21"), undefined); // end hour is exclusive
  assert.equal(m.get("3:8"), undefined);
});

test("findBlockConflict: overlapping hours on a blocked court conflict; touching ones don't", () => {
  assert.equal(findBlockConflict([openPlay], 1, "2026-09-29", 17, 19)?.label, "Open Play");
  assert.equal(findBlockConflict([openPlay], 1, "2026-09-29", 16, 18), undefined); // ends as it starts
  assert.equal(findBlockConflict([openPlay], 1, "2026-09-29", 21, 22), undefined);
  assert.equal(findBlockConflict([openPlay], 3, "2026-09-29", 18, 20), undefined); // other court
  assert.equal(findBlockConflict([openPlay], 1, "2026-09-30", 18, 20), undefined); // Wednesday
});

test("describeRepeat", () => {
  assert.equal(describeRepeat([]), "");
  assert.equal(describeRepeat([4, 2]), "Every Tue, Thu");
  assert.equal(describeRepeat([0, 1, 2, 3, 4, 5, 6]), "Every day");
});
