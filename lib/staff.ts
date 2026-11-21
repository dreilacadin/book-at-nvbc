// Staff accounts: roles, what each role may open, and the checks for a sign-up or profile. Shared by
// the server and the admin page (no Node-only imports here).

import { ageOn } from "./membership.ts";

/**
 * Account roles. The owner (ADMIN_PASSWORD) isn't an account. A Scholar may also be a stringer
 * (`stringer: true`); Staff, Managers and Stringer accounts can't combine roles.
 */
export const STAFF_ROLES = ["manager", "staff", "scholar", "stringer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const isStaffRole = (v: unknown): v is StaffRole => STAFF_ROLES.includes(v as StaffRole);
/** Roles someone can choose for themselves on a registration link (never Manager). */
export const SIGNUP_ROLES = ["staff", "scholar", "stringer"] as const satisfies readonly StaffRole[];
export type SignupRole = (typeof SIGNUP_ROLES)[number];
export const isSignupRole = (v: unknown): v is SignupRole => SIGNUP_ROLES.includes(v as SignupRole);

export const ROLE_LABEL: Record<StaffRole, string> = { manager: "Manager", staff: "Staff", scholar: "Scholar", stringer: "Stringer" };
/** "Scholar + Stringer", "Staff", … */
export const roleName = (role: StaffRole, stringer = false) => (role === "scholar" && stringer ? "Scholar + Stringer" : ROLE_LABEL[role]);

export const ROLE_HINT: Record<StaffRole, string> = {
  manager: "Full access, like the owner: also settings, prices, payment accounts, courts, staff accounts, deleting, imports, bulk emails and the activity log.",
  staff: "Day-to-day work: bookings, payments, members, messages, vouchers, stringing and reserved times. No settings, prices, courts, staff accounts, deleting, imports or bulk emails.",
  scholar: "Front-desk duty: only the Bookings, Members and Stringing tabs, with Staff's day-to-day access there.",
  stringer: "Only the racket stringing queue: see the rackets waiting, and mark them started and done (counted in the stringer report). Nothing else.",
};
export const SCHOLAR_STRINGER_HINT = "They can also start and finish stringing (counted in the stringer report).";
export const SCHOLAR_DESK_HINT = "In Stringing they do the desk side: check-ins, receiving, payments and pickups.";

/**
 * Admin API areas a Scholar may use: what the Bookings, Members and Stringing tabs (and the booking
 * page's staff mode) need. Everything else under /api/admin is refused.
 */
export const SCHOLAR_API = [
  "bookings", "courts", "members", "messages", "history", "settings", "holidays", "notifications", "blocks",
  "users", "login", "logout", "stringing",
] as const;
/** Whether a Scholar may call this path (e.g. "/api/admin/bookings/proof"). Paths outside /api/admin aren't limited here. */
export function scholarMayUse(pathname: string): boolean {
  const m = /^\/api\/admin\/([^/]+)/.exec(pathname);
  return !m || (SCHOLAR_API as readonly string[]).includes(m[1]);
}

// ---- A sign-up (registration link) or a profile ---------------------------------------------

export type StaffProfile = { firstName: string; lastName: string; birthdate: string | null; mobile: string; email: string };
export type StaffSignup = StaffProfile & { username: string; password: string; role: SignupRole; stringer: boolean };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const PHONE = /^\+?[0-9][0-9 \-()]{6,19}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isDate = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().startsWith(v);
export const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;
export const normalizeUsername = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();
export const MIN_PASSWORD = 8;

/**
 * Checks profile details. `required`: a sign-up needs everything; a manager's edit may leave
 * details blank (older accounts have only a name), but what's filled in must be valid.
 */
export function validateProfile(input: Record<string, unknown>, today: string, required: boolean): StaffProfile | string {
  const p: StaffProfile = {
    firstName: str(input.firstName, 40),
    lastName: str(input.lastName, 40),
    birthdate: str(input.birthdate, 10) || null,
    mobile: str(input.mobile, 20),
    email: str(input.email, 120).toLowerCase(),
  };
  if (!p.firstName) return "Enter the first name.";
  if (!p.lastName) return "Enter the last name.";
  if (p.birthdate) {
    if (!isDate(p.birthdate)) return "Enter the birthday.";
    const age = ageOn(p.birthdate, today);
    if (age < 10 || age > 100) return "Please check the birthday.";
  } else if (required) return "Enter your birthday.";
  if (p.mobile ? !PHONE.test(p.mobile) : required) return "Enter a valid mobile number, like 0917 123 4567.";
  if (p.email ? !EMAIL.test(p.email) : required) return "Enter a valid email address.";
  return p;
}

/** Checks a registration-link sign-up. `allowed`: the roles that link is for. */
export function validateSignup(input: Record<string, unknown>, today: string, allowed: readonly string[]): StaffSignup | string {
  const p = validateProfile(input, today, true);
  if (typeof p === "string") return p;
  const username = normalizeUsername(input.username);
  if (!USERNAME.test(username)) return "Usernames are 3–30 letters, numbers, dots, dashes or underscores.";
  if (username === "owner") return "“owner” is reserved. Choose another username.";
  const password = typeof input.password === "string" ? input.password : "";
  if (password.length < MIN_PASSWORD || password.length > 200) return `Passwords need at least ${MIN_PASSWORD} characters.`;
  const role = input.role;
  if (!isSignupRole(role) || !allowed.includes(role)) return "Choose your role.";
  // Only a Scholar can also be a stringer.
  const stringer = role === "scholar" && input.stringer === true;
  return { ...p, username, password, role, stringer };
}

/** "Expires Nov 28", "No end date", … for a registration link. */
export type InviteState = "active" | "expired" | "off";
export function inviteState(i: { expires_at: string | null; revoked_at: string | null }, nowMs: number = Date.now()): InviteState {
  if (i.revoked_at) return "off";
  if (i.expires_at && Date.parse(i.expires_at) <= nowMs) return "expired";
  return "active";
}
/** How long a new registration link works: days, or null for no end date. */
export const INVITE_DAYS = [1, 7, 30, null] as const;
