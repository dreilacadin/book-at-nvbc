// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { kindsForRole } from "./notify-kinds.ts";
import { inviteState, roleName, scholarMayUse, validateProfile, validateSignup } from "./staff.ts";

const TODAY = "2026-11-21";
const ALL = ["staff", "scholar", "stringer"];
const good = {
  firstName: " Ana ", lastName: "Reyes", birthdate: "2006-05-14", mobile: "0917 123 4567", email: "Ana@Example.com",
  username: " Ana.Reyes ", password: "secret123", role: "scholar", stringer: true,
};

test("a sign-up is cleaned up and checked", () => {
  const s = validateSignup(good, TODAY, ALL);
  assert.equal(typeof s, "object");
  if (typeof s === "string") return;
  assert.equal(s.firstName, "Ana");
  assert.equal(s.email, "ana@example.com");
  assert.equal(s.username, "ana.reyes");
  assert.equal(s.role, "scholar");
  assert.equal(s.stringer, true);
});

test("only a Scholar can also be a stringer", () => {
  for (const role of ["staff", "stringer"]) {
    const s = validateSignup({ ...good, role, stringer: true }, TODAY, ALL);
    assert.ok(typeof s === "object" && s.stringer === false, role);
  }
});

test("a sign-up can't choose Manager, or a role the link isn't for", () => {
  assert.equal(validateSignup({ ...good, role: "manager" }, TODAY, ALL), "Choose your role.");
  assert.equal(validateSignup({ ...good, role: "staff" }, TODAY, ["scholar"]), "Choose your role.");
  assert.equal(validateSignup({ ...good, role: "" }, TODAY, ALL), "Choose your role.");
});

test("a sign-up needs every detail, a manager's edit doesn't", () => {
  assert.match(validateSignup({ ...good, birthdate: "" }, TODAY, ALL) as string, /birthday/);
  assert.match(validateSignup({ ...good, mobile: "" }, TODAY, ALL) as string, /mobile/);
  assert.match(validateSignup({ ...good, email: "nope" }, TODAY, ALL) as string, /email/);
  assert.match(validateSignup({ ...good, username: "a" }, TODAY, ALL) as string, /Usernames/);
  assert.match(validateSignup({ ...good, username: "owner" }, TODAY, ALL) as string, /reserved/);
  assert.match(validateSignup({ ...good, password: "short" }, TODAY, ALL) as string, /8 characters/);
  assert.match(validateSignup({ ...good, birthdate: "2026-02-30" }, TODAY, ALL) as string, /birthday/);
  const p = validateProfile({ firstName: "Ben", lastName: "Cruz" }, TODAY, false);
  assert.deepEqual(p, { firstName: "Ben", lastName: "Cruz", birthdate: null, mobile: "", email: "" });
  assert.match(validateProfile({ firstName: "Ben", lastName: "" }, TODAY, false) as string, /last name/);
});

test("Scholars only reach the admin areas their tabs use", () => {
  for (const ok of ["/api/admin/bookings", "/api/admin/bookings/proof", "/api/admin/members/proof", "/api/admin/stringing", "/api/admin/users", "/api/coaches/photo"])
    assert.equal(scholarMayUse(ok), true, ok);
  for (const no of ["/api/admin/vouchers", "/api/admin/reports", "/api/admin/scholars", "/api/admin/coaches", "/api/admin/export"])
    assert.equal(scholarMayUse(no), false, no);
});

test("role names", () => {
  assert.equal(roleName("scholar", true), "Scholar + Stringer");
  assert.equal(roleName("scholar", false), "Scholar");
  assert.equal(roleName("staff", true), "Staff");
});

test("notifications per role", () => {
  assert.ok(kindsForRole("manager").includes("staff_signup"));
  assert.ok(kindsForRole("owner").includes("staff_signup"));
  assert.ok(!kindsForRole("staff").includes("staff_signup"));
  const scholar = kindsForRole("scholar");
  assert.ok(scholar.includes("booking_new") && scholar.includes("stringing"));
  assert.ok(!scholar.includes("coach_applied") && !scholar.includes("staff_signup"));
});

test("registration link states", () => {
  const now = Date.parse("2026-11-21T10:00:00Z");
  assert.equal(inviteState({ expires_at: null, revoked_at: null }, now), "active");
  assert.equal(inviteState({ expires_at: "2026-11-22T00:00:00Z", revoked_at: null }, now), "active");
  assert.equal(inviteState({ expires_at: "2026-11-20T00:00:00Z", revoked_at: null }, now), "expired");
  assert.equal(inviteState({ expires_at: null, revoked_at: "2026-11-21T09:00:00Z" }, now), "off");
});
