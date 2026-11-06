// NVBC Scholar applications: definitions and checks shared by the server and the browser
// (no Node-only imports here). Update the batches and RESULTS_LABEL for each new round of tryouts.

import { ageOn } from "./membership.ts";

export const SCHOLAR_SPORTS = [
  { id: "badminton", label: "Badminton" },
  { id: "pickleball", label: "Pickleball" },
] as const;
export type ScholarSport = (typeof SCHOLAR_SPORTS)[number]["id"];
export const scholarSportLabel = (id: string) => SCHOLAR_SPORTS.find((s) => s.id === id)?.label ?? id;

/** Tryout batches. A batch stops taking applications when `closesAt` passes (its last session starts). */
export const SCHOLAR_BATCHES = [
  { id: "first", label: "1st Batch", when: "Sat & Sun, Nov 7 & 8, 9 to 11 AM", closesAt: "2026-11-08T09:00:00+08:00" },
  { id: "second", label: "2nd Batch", when: "Wed, Nov 11, 5 to 7 PM", closesAt: "2026-11-11T17:00:00+08:00" },
] as const;
export type ScholarBatch = (typeof SCHOLAR_BATCHES)[number]["id"];
export const scholarBatchLabel = (id: string) => SCHOLAR_BATCHES.find((b) => b.id === id)?.label ?? id;
export const scholarBatchWhen = (id: string) => SCHOLAR_BATCHES.find((b) => b.id === id)?.when ?? "";

export const RESULTS_LABEL = "Friday, Nov 13, 3 PM";

export const isBatchOpen = (b: { closesAt: string }, nowMs: number) => nowMs < Date.parse(b.closesAt);
export const openBatches = (nowMs: number) => SCHOLAR_BATCHES.filter((b) => isBatchOpen(b, nowMs));

export const DUTY_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const DUTY_TIMES = ["Morning", "Afternoon", "Evening"] as const;
/** Scholars serve at least 2 to 3 duty days a week, so an applicant must be free on at least this many days. */
export const MIN_DUTY_DAYS = 2;
export const slotId = (day: string, time: string) => `${day}-${time}`;
const DUTY_SLOTS: ReadonlySet<string> = new Set(DUTY_DAYS.flatMap((d) => DUTY_TIMES.map((t) => slotId(d, t))));

/** Applicants under this age need a parent's or guardian's consent. */
export const ADULT_AGE = 18;

export const SCHOLAR_STATUSES = [
  { id: "received", label: "Received" },
  { id: "selected", label: "Selected" },
  { id: "not_selected", label: "Not selected" },
] as const;
export type ScholarStatus = (typeof SCHOLAR_STATUSES)[number]["id"];
export const isScholarStatus = (v: unknown): v is ScholarStatus => SCHOLAR_STATUSES.some((s) => s.id === v);

/** What a parent or guardian agrees to. Every item has to be ticked. Shown word for word on the consent page. */
export const GUARDIAN_CONSENTS = [
  { id: "tryouts", title: "Tryouts", text: "I allow my child to join the NVBC Scholar tryouts in the batch shown above." },
  { id: "physical", title: "Physical activity", text: "I understand that badminton and pickleball are physical sports that carry some risk of injury. To my knowledge, my child is fit to take part." },
  { id: "emergencies", title: "Emergencies", text: "If my child is hurt or unwell, I allow NVBC staff to give basic first aid, contact me or the emergency contact given in the application, and seek medical help if it is urgently needed." },
  { id: "duties", title: "Scholar duties", text: "If my child is accepted, I allow my child to serve at least 2 to 3 duty days a week, including helping with the upkeep of NVBC courts, facilities and gadgets, and to join training and tournaments as scheduled." },
  { id: "travel", title: "Travel", text: "I understand that my child's travel to and from NVBC is our family's responsibility." },
  { id: "selection", title: "Selection", text: `I understand that joining tryouts does not guarantee a slot, and that NVBC management will decide and announce the results on ${RESULTS_LABEL}.` },
  { id: "privacy", title: "Privacy", text: "I allow NVBC to collect and use the information in this application to assess it, contact us, and respond to emergencies, in line with the Data Privacy Act of 2012 (RA 10173). NVBC will keep it only as long as needed and will not share it for unrelated purposes." },
] as const;

/** What an applicant agrees to. Everyone ticks these. */
export const APPLICANT_COMMITMENTS = [
  { id: "truthful", text: "I am currently studying and living in Nueva Vizcaya, and the information in this application is true." },
  { id: "duties", text: "If accepted, I will represent NVBC well, help clients feel at home, help care for NVBC courts, facilities and gadgets, and serve at least 2 to 3 duty days a week." },
  { id: "perks", text: "I understand that scholar perks apply only while I am an active scholar, and that joining tryouts does not guarantee a slot." },
  { id: "privacy", text: "I allow NVBC to use these details to assess my application, contact me, and respond to emergencies, in line with the Data Privacy Act of 2012 (RA 10173). Only NVBC management can see them." },
] as const;

/** What an applicant who is 18 or older agrees to, in place of a guardian's consent. */
export const ADULT_CONSENTS = [
  { id: "physical", text: "I understand that badminton and pickleball are physical sports that carry some risk of injury. To my knowledge, I am fit to take part." },
  { id: "emergencies", text: "If I am hurt or unwell, I allow NVBC staff to give basic first aid, contact my emergency contact, and seek medical help if it is urgently needed." },
  { id: "travel", text: "I understand that my travel to and from NVBC is my own responsibility." },
] as const;

export type PhotoConsent = "yes" | "no";
const isPhotoConsent = (v: unknown): v is PhotoConsent => v === "yes" || v === "no";

export type ScholarApplication = {
  fullName: string;
  birthdate: string;
  mobile: string;
  facebookName: string;
  address: string;
  school: string;
  yearLevel: string;
  sport: ScholarSport;
  batch: ScholarBatch;
  yearsPlaying: string;
  experience: string;
  availability: string[];
  whyFit: string;
  initiative: string;
  emergencyName: string;
  emergencyMobile: string;
  medical: string;
  consentRequired: boolean;
  photoConsent: PhotoConsent | ""; // under 18: the guardian answers this on the consent page
};

export type GuardianConsent = {
  guardianName: string;
  relationship: string;
  guardianMobile: string;
  guardianNotes: string;
  photoConsent: PhotoConsent;
  signature: string;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
/** Long answers keep their line breaks. */
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const PHONE = /^\+?[0-9][0-9 \-()]{6,19}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const allTicked = (items: readonly { id: string }[], given: unknown) =>
  !!given && typeof given === "object" && items.every((i) => (given as Record<string, unknown>)[i.id] === true);

/** The same words, ignoring case and spacing: how a typed signature is compared with a name. */
export const sameName = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, " ").trim() === b.toLowerCase().replace(/\s+/g, " ").trim();

/** Does someone born on this date need a guardian's consent? */
export const needsGuardianConsent = (birthdate: string, today: string) => ageOn(birthdate, today) < ADULT_AGE;

/**
 * Checks an application. Returns the cleaned form, or an error message for the first problem.
 * `today` ("YYYY-MM-DD") checks the birthdate; `nowMs` checks that the batch is still open.
 */
export function validateScholarApplication(input: Record<string, unknown>, today: string, nowMs: number): ScholarApplication | string {
  const fullName = str(input.fullName, 80);
  if (fullName.length < 4 || !fullName.includes(" ")) return "Please enter your first and last name.";
  const birthdate = str(input.birthdate, 10);
  if (!DATE.test(birthdate) || Number.isNaN(Date.parse(birthdate)) || birthdate >= today) return "Please enter a valid date of birth.";
  const age = ageOn(birthdate, today);
  if (age > 100) return "Please check your date of birth.";
  const mobile = str(input.mobile, 20);
  if (!PHONE.test(mobile)) return "Please enter a valid mobile number.";
  const facebookName = str(input.facebookName, 80);
  if (facebookName.length < 2) return "Please enter your Facebook name so we can message you.";
  const address = str(input.address, 200);
  if (address.length < 8) return "Please enter your home address in Nueva Vizcaya (barangay and town).";
  const school = str(input.school, 120);
  if (school.length < 2) return "Please enter your school.";
  const yearLevel = str(input.yearLevel, 80);
  if (yearLevel.length < 2) return "Please enter your course or strand, and year level.";

  const sport = SCHOLAR_SPORTS.find((s) => s.id === input.sport)?.id;
  if (!sport) return "Please choose your sport.";
  const batch = SCHOLAR_BATCHES.find((b) => b.id === input.batch);
  if (!batch) return "Please choose your tryout batch.";
  if (!isBatchOpen(batch, nowMs)) return `The ${batch.label} is closed. Please choose another batch.`;
  const yearsPlaying = str(input.yearsPlaying, 40);
  if (!yearsPlaying) return "Please tell us how long you have been playing.";
  const experience = text(input.experience, 500);

  const availability = Array.isArray(input.availability)
    ? [...new Set(input.availability.filter((s): s is string => typeof s === "string" && DUTY_SLOTS.has(s)))]
    : [];
  if (new Set(availability.map((s) => s.split("-")[0])).size < MIN_DUTY_DAYS)
    return `Scholars serve at least 2 to 3 duty days a week. Please mark when you are free on at least ${MIN_DUTY_DAYS} days.`;

  const whyFit = text(input.whyFit, 1500);
  if (whyFit.length < 20) return "Please tell us a little more about why you would be a good fit.";
  const initiative = text(input.initiative, 1500);
  if (initiative.length < 20) return "Please tell us a little more about a time you helped out without being asked.";

  const emergencyName = str(input.emergencyName, 80);
  if (emergencyName.length < 2) return "Please enter your emergency contact's name.";
  const emergencyMobile = str(input.emergencyMobile, 20);
  if (!PHONE.test(emergencyMobile)) return "Please enter your emergency contact's mobile number.";
  const medical = text(input.medical, 500);
  if (!medical) return 'Please list any medical conditions, allergies or injuries, or write "None".';

  if (!allTicked(APPLICANT_COMMITMENTS, input.commitments)) return "Please read and tick every item in Your commitment.";

  const consentRequired = age < ADULT_AGE;
  let photoConsent: PhotoConsent | "" = "";
  if (!consentRequired) {
    if (!allTicked(ADULT_CONSENTS, input.adultConsents)) return "Please read and tick every item in Your consent.";
    if (!isPhotoConsent(input.photoConsent)) return "Please answer the photos and videos question.";
    photoConsent = input.photoConsent;
  }

  return {
    fullName, birthdate, mobile, facebookName, address, school, yearLevel, sport, batch: batch.id, yearsPlaying, experience,
    availability, whyFit, initiative, emergencyName, emergencyMobile, medical, consentRequired, photoConsent,
  };
}

/** Checks a parent's or guardian's consent. Returns the cleaned form, or an error message for the first problem. */
export function validateGuardianConsent(input: Record<string, unknown>, applicantName: string): GuardianConsent | string {
  const guardianName = str(input.guardianName, 80);
  if (guardianName.length < 4 || !guardianName.includes(" ")) return "Please enter your first and last name.";
  if (sameName(guardianName, applicantName)) return "This page must be completed by the applicant's parent or guardian.";
  const relationship = str(input.relationship, 40);
  if (relationship.length < 2) return "Please enter your relationship to the applicant.";
  const guardianMobile = str(input.guardianMobile, 20);
  if (!PHONE.test(guardianMobile)) return "Please enter a valid mobile number.";
  if (!allTicked(GUARDIAN_CONSENTS, input.consents)) return "Please read and tick every consent item.";
  if (!isPhotoConsent(input.photoConsent)) return "Please answer the photos and videos question.";
  const signature = str(input.signature, 80);
  if (!sameName(signature, guardianName)) return "To sign, please type your full name exactly as you entered it above.";
  return { guardianName, relationship, guardianMobile, guardianNotes: text(input.guardianNotes, 500), photoConsent: input.photoConsent, signature };
}
