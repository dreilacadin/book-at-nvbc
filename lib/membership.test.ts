// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { ageOn, formatMemberCode, membershipState, normalizeMemberCode, validateMembershipForm } from "./membership.ts";

const SPORTS = ["badminton", "pickleball"];
const good = {
  memberType: "adult",
  fullName: "  Ana   Cruz ",
  email: "Ana@Example.com",
  mobile: "0917 123 4567",
  address: "12 Mabini St, Naga City",
  birthdate: "1995-06-15",
  gender: "Female",
  sports: ["badminton", "tennis"],
  emergencyName: "Ben Cruz",
  emergencyMobile: "09181234567",
  consent: true,
};

test("validateMembershipForm cleans a good adult application", () => {
  const f = validateMembershipForm(good, "2026-09-28", SPORTS);
  assert.equal(typeof f, "object");
  if (typeof f === "string") return;
  assert.equal(f.fullName, "Ana Cruz");
  assert.equal(f.email, "ana@example.com");
  assert.deepEqual(f.sports, ["badminton"]); // unknown sports dropped
  assert.equal(f.school, "");
});

test("validateMembershipForm: students need school and student ID; consent required", () => {
  assert.match(String(validateMembershipForm({ ...good, memberType: "student" }, "2026-09-28", SPORTS)), /school/);
  assert.equal(
    typeof validateMembershipForm({ ...good, memberType: "student", school: "Ateneo de Naga", studentId: "2023-0142" }, "2026-09-28", SPORTS),
    "object"
  );
  assert.match(String(validateMembershipForm({ ...good, consent: false }, "2026-09-28", SPORTS)), /agree/);
  assert.match(String(validateMembershipForm({ ...good, fullName: "Ana" }, "2026-09-28", SPORTS)), /full name/);
  assert.match(String(validateMembershipForm({ ...good, email: "ana@" }, "2026-09-28", SPORTS)), /email/);
  assert.match(String(validateMembershipForm({ ...good, birthdate: "2026-01-01" }, "2026-09-28", SPORTS)), /birthdate/);
  assert.match(String(validateMembershipForm({ ...good, memberType: "vip" }, "2026-09-28", SPORTS)), /Student or Adult/);
});

test("ageOn counts whole years", () => {
  assert.equal(ageOn("2000-09-28", "2026-09-28"), 26);
  assert.equal(ageOn("2000-09-29", "2026-09-28"), 25);
});

test("member codes: format and normalize what scanners or people type", () => {
  const code = formatMemberCode([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(code, "NVBC-ABCD-EFGH");
  assert.equal(normalizeMemberCode("nvbc abcd efgh"), code);
  assert.equal(normalizeMemberCode("ABCDEFGH"), code);
  assert.equal(normalizeMemberCode(" NVBC-ABCD-EFGH\n"), code);
  assert.equal(normalizeMemberCode("NVBC-ABC"), null);
});

test("membershipState: active until the day it expires", () => {
  const m = { status: "active" as const, expires_on: "2027-09-28" };
  assert.equal(membershipState(m, "2027-09-27"), "active");
  assert.equal(membershipState(m, "2027-09-28"), "expired");
  assert.equal(membershipState({ status: "pending", expires_on: null }, "2027-01-01"), "pending");
});
