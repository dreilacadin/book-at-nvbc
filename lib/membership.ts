// Membership definitions shared by the server and the browser (no Node-only imports here).

export const MEMBER_TYPES = [
  { id: "student", label: "Student" },
  { id: "adult", label: "Adult" },
] as const;
export type MemberType = (typeof MEMBER_TYPES)[number]["id"];
export const isMemberType = (v: unknown): v is MemberType => MEMBER_TYPES.some((t) => t.id === v);
export const memberTypeLabel = (id: string) => MEMBER_TYPES.find((t) => t.id === id)?.label ?? id;

/** A membership lasts 365 days: approved Sep 28, 2026 → expires Sep 28, 2027 (active through Sep 27). */
export const MEMBERSHIP_DAYS = 365;

/**
 * pending  — applied, waiting for payment and staff approval
 * active   — approved (may be past its expires_on date: see membershipState)
 * rejected — declined by staff
 * forfeited — the member gave it up after it expired (staff can reactivate it with a renewal)
 */
export type MembershipStatus = "pending" | "active" | "rejected" | "forfeited";

export type MembershipState = "pending" | "active" | "expired" | "rejected" | "forfeited";

/**
 * What a membership means today. An expired membership stays "expired" (not deleted) until the
 * member renews or forfeits it, so staff can remind them on their next visit.
 */
export function membershipState(m: { status: MembershipStatus; expires_on: string | null }, today: string): MembershipState {
  if (m.status !== "active") return m.status;
  return m.expires_on && today >= m.expires_on ? "expired" : "active";
}

export const membershipStateLabel = (s: string) =>
  ({ pending: "Pending", active: "Active", expired: "Expired", rejected: "Not approved", forfeited: "Forfeited" })[s] ?? s;

// No 0/O/1/I/L so codes are easy to read out loud or type.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "NVBC-7K3Q-9PXM" from 8 random indexes (0–30). Pass crypto-random numbers. */
export function formatMemberCode(random: number[]): string {
  const s = random.slice(0, 8).map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
  return `NVBC-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}
export const MEMBER_CODE_ALPHABET_SIZE = CODE_ALPHABET.length;

/** Accepts "nvbc 7k3q 9pxm", "NVBC-7K3Q-9PXM" or "7K3Q9PXM" (as typed or scanned). */
export function normalizeMemberCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = c.startsWith("NVBC") ? c.slice(4) : c;
  return /^[A-Z0-9]{8}$/.test(body) ? `NVBC-${body.slice(0, 4)}-${body.slice(4)}` : null;
}

/** Whole years between a birthdate and a date (both "YYYY-MM-DD"). */
export function ageOn(birthdate: string, date: string): number {
  const [by, bm, bd] = birthdate.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export type MembershipForm = {
  memberType: MemberType;
  fullName: string;
  email: string;
  mobile: string;
  address: string;
  birthdate: string;
  gender: string;
  school: string;
  studentId: string;
  sports: string[];
  emergencyName: string;
  emergencyMobile: string;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const PHONE = /^\+?[0-9][0-9 \-()]{6,19}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GENDERS = ["Female", "Male", "Prefer not to say"] as const;

/**
 * Checks an application. Returns the cleaned form, or an error message for the first problem.
 * `today` ("YYYY-MM-DD") is used to check the birthdate.
 */
export function validateMembershipForm(input: Record<string, unknown>, today: string, sportIds: readonly string[]): MembershipForm | string {
  const f: MembershipForm = {
    memberType: input.memberType as MemberType,
    fullName: str(input.fullName, 80),
    email: str(input.email, 120).toLowerCase(),
    mobile: str(input.mobile, 20),
    address: str(input.address, 200),
    birthdate: str(input.birthdate, 10),
    gender: str(input.gender, 30),
    school: str(input.school, 120),
    studentId: str(input.studentId, 40),
    sports: Array.isArray(input.sports) ? [...new Set(input.sports.filter((s) => sportIds.includes(s as string)) as string[])] : [],
    emergencyName: str(input.emergencyName, 80),
    emergencyMobile: str(input.emergencyMobile, 20),
  };
  if (!isMemberType(f.memberType)) return "Choose Student or Adult membership.";
  if (f.fullName.length < 4 || !f.fullName.includes(" ")) return "Please enter your full name (first and last name).";
  if (!EMAIL.test(f.email)) return "Please enter a valid email address.";
  if (!PHONE.test(f.mobile)) return "Please enter a valid mobile number.";
  if (f.address.length < 8) return "Please enter your home address.";
  if (!DATE.test(f.birthdate) || Number.isNaN(Date.parse(f.birthdate + "T00:00:00Z"))) return "Please enter your birthdate.";
  const age = ageOn(f.birthdate, today);
  if (age < 3 || age > 110) return "Please check your birthdate.";
  if (f.gender && !(GENDERS as readonly string[]).includes(f.gender)) f.gender = "";
  if (f.memberType === "student") {
    if (f.school.length < 2) return "Please enter your school.";
    if (f.studentId.length < 2) return "Please enter your student ID number.";
  } else {
    f.school = "";
    f.studentId = "";
  }
  if (f.emergencyName.length < 2) return "Please enter an emergency contact name.";
  if (!PHONE.test(f.emergencyMobile)) return "Please enter a valid emergency contact number.";
  if (input.consent !== true) return "Please agree to the privacy notice and club rules.";
  return f;
}
