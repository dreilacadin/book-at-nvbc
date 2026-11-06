// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADULT_CONSENTS,
  APPLICANT_COMMITMENTS,
  GUARDIAN_CONSENTS,
  isBatchOpen,
  needsGuardianConsent,
  openBatches,
  sameName,
  SCHOLAR_BATCHES,
  validateGuardianConsent,
  validateScholarApplication,
} from "./scholar.ts";

const TODAY = "2026-11-05";
const NOW = Date.parse("2026-11-05T12:00:00+08:00");
const ticks = (items: readonly { id: string }[]) => Object.fromEntries(items.map((i) => [i.id, true]));

const minor = {
  fullName: "  Ana   Cruz ",
  birthdate: "2010-03-14",
  mobile: "0917 123 4567",
  facebookName: "Ana Cruz",
  address: "Don Mariano Marcos, Bayombong",
  school: "Saint Mary's University",
  yearLevel: "STEM, Grade 11",
  sport: "badminton",
  batch: "first",
  yearsPlaying: "3 years",
  experience: "",
  availability: ["Mon-Morning", "Sat-Afternoon", "not-a-slot", "Mon-Morning"],
  whyFit: "I love helping players feel welcome on court.",
  initiative: "I cleaned up after our team event without being asked.",
  emergencyName: "Ben Cruz",
  emergencyMobile: "09181234567",
  medical: "None",
  commitments: ticks(APPLICANT_COMMITMENTS),
};
const adult = { ...minor, birthdate: "2005-01-01", adultConsents: ticks(ADULT_CONSENTS), photoConsent: "no" };

test("an under-18 application needs a guardian and leaves the photo answer to them", () => {
  const f = validateScholarApplication(minor, TODAY, NOW);
  assert.equal(typeof f, "object");
  if (typeof f === "string") return;
  assert.equal(f.fullName, "Ana Cruz");
  assert.equal(f.consentRequired, true);
  assert.equal(f.photoConsent, "");
  assert.deepEqual(f.availability, ["Mon-Morning", "Sat-Afternoon"]);
});

test("an 18-year-old consents for themself", () => {
  const f = validateScholarApplication(adult, TODAY, NOW);
  assert.equal(typeof f, "object");
  if (typeof f === "string") return;
  assert.equal(f.consentRequired, false);
  assert.equal(f.photoConsent, "no");
  assert.match(String(validateScholarApplication({ ...adult, adultConsents: {} }, TODAY, NOW)), /Your consent/);
  assert.match(String(validateScholarApplication({ ...adult, photoConsent: undefined }, TODAY, NOW)), /photos/);
});

test("the 18th birthday is the cut-off", () => {
  assert.equal(needsGuardianConsent("2008-11-05", TODAY), false); // 18 today
  assert.equal(needsGuardianConsent("2008-11-06", TODAY), true); // 18 tomorrow
});

test("application problems are reported", () => {
  const bad = (change: Record<string, unknown>) => validateScholarApplication({ ...minor, ...change }, TODAY, NOW);
  assert.match(String(bad({ fullName: "Ana" })), /first and last name/);
  assert.match(String(bad({ birthdate: "2027-01-01" })), /date of birth/);
  assert.match(String(bad({ mobile: "abc" })), /mobile/);
  assert.match(String(bad({ sport: "tennis" })), /sport/);
  assert.match(String(bad({ batch: "third" })), /batch/);
  assert.match(String(bad({ availability: ["Mon-Morning", "Mon-Evening"] })), /at least 2 days/);
  assert.match(String(bad({ whyFit: "short" })), /good fit/);
  assert.match(String(bad({ medical: "" })), /None/);
  const { truthful: _skip, ...partial } = minor.commitments;
  assert.match(String(bad({ commitments: partial })), /Your commitment/);
});

test("a batch closes when its last session starts", () => {
  const [first, second] = SCHOLAR_BATCHES;
  assert.equal(isBatchOpen(first, Date.parse("2026-11-08T08:59:00+08:00")), true);
  assert.equal(isBatchOpen(first, Date.parse("2026-11-08T09:00:00+08:00")), false);
  assert.deepEqual(openBatches(Date.parse("2026-11-09T10:00:00+08:00")).map((b) => b.id), ["second"]);
  assert.deepEqual(openBatches(Date.parse("2026-11-11T17:00:00+08:00")), []);
  assert.equal(second.id, "second");
  assert.match(String(validateScholarApplication(minor, TODAY, Date.parse("2026-11-09T10:00:00+08:00"))), /1st Batch is closed/);
});

const consent = {
  guardianName: "Maria Cruz",
  relationship: "Mother",
  guardianMobile: "09171112222",
  guardianNotes: "",
  consents: ticks(GUARDIAN_CONSENTS),
  photoConsent: "yes",
  signature: " maria  CRUZ ",
};

test("a guardian's consent needs every box and a matching typed signature", () => {
  const f = validateGuardianConsent(consent, "Ana Cruz");
  assert.equal(typeof f, "object");
  const bad = (change: Record<string, unknown>) => validateGuardianConsent({ ...consent, ...change }, "Ana Cruz");
  assert.match(String(bad({ consents: { ...consent.consents, privacy: false } })), /every consent item/);
  assert.match(String(bad({ signature: "Someone Else" })), /type your full name/);
  assert.match(String(bad({ photoConsent: "maybe" })), /photos/);
  assert.match(String(bad({ guardianMobile: "x" })), /mobile/);
});

test("an applicant can't sign as their own guardian", () => {
  assert.match(String(validateGuardianConsent({ ...consent, guardianName: "ANA  cruz", signature: "Ana Cruz" }, "Ana Cruz")), /parent or guardian/);
  assert.equal(sameName("Ana  Cruz", "ana cruz"), true);
});
