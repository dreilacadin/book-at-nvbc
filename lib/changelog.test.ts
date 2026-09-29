// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChangelog, parseInline } from "./changelog.ts";

const MD = `# Changelog

Intro for developers — not shown.

## [Unreleased]

### Added
- **Pay online in 15 minutes.** After booking you get a timer
  to send your receipt.
- **Staff:** **Bookings tab** redesigned for phones.
- **Database:** new columns for progress.

### Fixed
- **Internal:** README colours.

## 2026-09-20

### Changed
- Pickleball opens first.
`;

test("parseChangelog: releases, groups, staff entries, hidden internal entries", () => {
  const r = parseChangelog(MD);
  assert.equal(r.length, 2);
  assert.equal(r[0].title, "Latest updates");
  assert.equal(r[0].date, null);
  assert.deepEqual(r[0].groups.map((g) => g.kind), ["Added"]); // Fixed had only an internal entry
  assert.deepEqual(r[0].groups[0].entries, [
    { text: "**Pay online in 15 minutes.** After booking you get a timer to send your receipt.", staff: false },
    { text: "**Bookings tab** redesigned for phones.", staff: true },
  ]);
  assert.equal(r[1].date, "2026-09-20");
  assert.equal(r[1].groups[0].entries[0].text, "Pickleball opens first.");
});

test("parseInline: bold, code, safe links only", () => {
  assert.deepEqual(parseInline("Go to **My booking** at `/my-booking` or [the site](/membership)."), [
    { type: "text", text: "Go to " },
    { type: "bold", text: "My booking" },
    { type: "text", text: " at " },
    { type: "code", text: "/my-booking" },
    { type: "text", text: " or " },
    { type: "link", text: "the site", href: "/membership" },
    { type: "text", text: "." },
  ]);
  assert.deepEqual(parseInline("[bad](javascript:alert(1))"), [{ type: "text", text: "bad" }, { type: "text", text: ")" }]);
});
