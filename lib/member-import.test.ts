// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkImportRecord,
  detectDateOrder,
  findDuplicates,
  guessMapping,
  parseDate,
  parseDelimited,
  toImportRecord,
} from "./member-import.ts";

const FORMS_CSV = `﻿Timestamp,Email Address,Full Name,Contact Number,Home Address,Birthdate,Membership Type,School,Emergency Contact Name,Emergency Contact Number
9/28/2025 14:03:22,ana@example.com,Ana Cruz,0917 123 4567,"12 Mabini St, Naga City",6/15/1995,Adult,,Ben Cruz,09181234567
10/2/2025 9:10:00,,"Juan ""JD"" dela Cruz",09170000000,,,Student (with valid ID),Ateneo,,

`;

test("parseDelimited: Google Forms CSV with quotes, commas, BOM and blank lines", () => {
  const rows = parseDelimited(FORMS_CSV);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][4], "12 Mabini St, Naga City");
  assert.equal(rows[2][2], 'Juan "JD" dela Cruz');
});

test("parseDelimited: tab-separated cells pasted from a sheet", () => {
  assert.deepEqual(parseDelimited("Name\tEmail\nAna Cruz\tana@x.com\n"), [["Name", "Email"], ["Ana Cruz", "ana@x.com"]]);
});

test("guessMapping matches Google Forms question headers", () => {
  const m = guessMapping(parseDelimited(FORMS_CSV)[0]);
  assert.equal(m.startsOn, 0); // Timestamp
  assert.equal(m.email, 1);
  assert.equal(m.fullName, 2);
  assert.equal(m.mobile, 3);
  assert.equal(m.address, 4);
  assert.equal(m.birthdate, 5);
  assert.equal(m.memberType, 6);
  assert.equal(m.school, 7);
  assert.equal(m.emergencyName, 8);
  assert.equal(m.emergencyMobile, 9);
});

test("guessMapping: split first/last name columns", () => {
  const m = guessMapping(["First Name", "Last Name", "Mobile"]);
  assert.equal(m.firstName, 0);
  assert.equal(m.lastName, 1);
  assert.equal(m.fullName, undefined);
});

test("parseDate handles the common spreadsheet formats", () => {
  assert.equal(parseDate("6/15/1995", "mdy"), "1995-06-15");
  assert.equal(parseDate("15/06/1995", "dmy"), "1995-06-15");
  assert.equal(parseDate("9/28/2025 14:03:22", "mdy"), "2025-09-28");
  assert.equal(parseDate("1995-06-15", "dmy"), "1995-06-15");
  assert.equal(parseDate("June 15, 1995", "mdy"), "1995-06-15");
  assert.equal(parseDate("15 Jun 1995", "mdy"), "1995-06-15");
  assert.equal(parseDate("2/30/2025", "mdy"), null); // no Feb 30
  assert.equal(parseDate("soon", "mdy"), null);
});

test("detectDateOrder", () => {
  assert.equal(detectDateOrder(["6/15/1995", "1/2/2000"]), "mdy");
  assert.equal(detectDateOrder(["15/6/1995", "1/2/2000"]), "dmy");
});

test("toImportRecord: fills defaults, reads type, computes expiry", () => {
  const rows = parseDelimited(FORMS_CSV);
  const map = guessMapping(rows[0]);
  const opt = { dateOrder: "mdy" as const, defaultType: "adult" as const, defaultStart: "2026-09-28", days: 365 };
  const a = toImportRecord(rows[1], 2, map, opt);
  assert.ok(!("error" in a));
  if ("error" in a) return;
  assert.equal(a.startsOn, "2025-09-28");
  assert.equal(a.expiresOn, "2026-09-28");
  assert.equal(a.birthdate, "1995-06-15");
  assert.equal(checkImportRecord(a), null);
  const b = toImportRecord(rows[2], 3, map, opt);
  if ("error" in b) return assert.fail(b.error);
  assert.equal(b.memberType, "student");
  assert.equal(b.school, "Ateneo");
  assert.equal(b.birthdate, null);
  assert.equal(b.email, "");
  const bad = toImportRecord(["x", "not-an-email", "Ana Cruz"], 4, map, opt);
  assert.ok("error" in bad);
});

test("findDuplicates: asks when 2+ of name, contact and birthday match; shared email is fine", () => {
  const existing = [
    { name: "Ana Cruz", mobile: "0917 123 4567", birthdate: "1995-06-15", member_code: "NVBC-AAAA-AAAA" },
    { name: "Dan Lim", mobile: "", birthdate: null, member_code: "NVBC-BBBB-BBBB" },
  ];
  const rows = [
    { row: 2, fullName: "ana  cruz", mobile: "+63 917 123 4567", birthdate: "1995-06-15" }, // all three match a member
    { row: 3, fullName: "Ana M. Cruz", mobile: "09171234567", birthdate: "1995-06-15" }, // name typed differently
    { row: 4, fullName: "Ana Cruz", mobile: "09999999999", birthdate: "1995-06-15" }, // new number
    { row: 5, fullName: "Ben Cruz", mobile: "09181112222", birthdate: "2010-01-01" }, // family member: no match
    { row: 6, fullName: "Ben Cruz", mobile: "0918 111 2222", birthdate: "2010-01-01" }, // repeat of row 5
    { row: 7, fullName: "Ana Cruz", mobile: "", birthdate: "2001-01-01" }, // same name only, different birthday
    { row: 8, fullName: "Dan Lim", mobile: "", birthdate: null }, // same name, nothing to compare
  ];
  const r = findDuplicates(rows, existing);
  const ask = (i: number) => (r[i] as { ask: string; matched: string[] });
  assert.deepEqual(ask(0).matched, ["name", "contact", "birthdate"]);
  assert.equal(ask(0).ask, "Same name, contact number and birthday as Ana Cruz (member NVBC-AAAA-AAAA)");
  assert.deepEqual(ask(1).matched, ["contact", "birthdate"]);
  assert.deepEqual(ask(2).matched, ["name", "birthdate"]);
  assert.equal(r[3], null);
  assert.match(ask(4).ask, /as row 5$/);
  assert.equal(r[5], null);
  assert.match((r[6] as { warn: string }).warn, /no birthday to compare/);
});
