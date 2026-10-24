// Coaches: availability, codes and the sign-up form. Pure (no Node imports), so it can be tested
// and used by both the server and the pages.

import { formatHour } from "./format.ts";

export type AvailabilitySlot = { day: number; from: number; to: number }; // day: 0 = Sunday … 6 = Saturday
export type CoachStatus = "pending" | "active" | "inactive" | "rejected";

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const isHalf = (n: number) => Number.isFinite(n) && Number.isInteger(n * 2) && n >= 0 && n <= 24;

/** Cleans availability from a form: valid half-hour ranges, sorted, overlaps merged. */
export function cleanAvailability(raw: unknown): AvailabilitySlot[] | string {
  if (!Array.isArray(raw)) return "Set the days and times you're available.";
  const list: AvailabilitySlot[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const day = Number(r?.day);
    const from = Number(r?.from);
    const to = Number(r?.to);
    if (!Number.isInteger(day) || day < 0 || day > 6 || !isHalf(from) || !isHalf(to)) return "Check the days and times you're available.";
    if (to <= from) return `${DAY_NAMES[day]}: the end time must be after the start time.`;
    list.push({ day, from, to });
  }
  if (list.length > 21) return "That's a lot of time ranges — please combine some.";
  list.sort((a, b) => a.day - b.day || a.from - b.from);
  const merged: AvailabilitySlot[] = [];
  for (const s of list) {
    const last = merged[merged.length - 1];
    if (last && last.day === s.day && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else merged.push({ ...s });
  }
  return merged;
}

/** Is the coach available for the whole of [start, end) on `date`'s weekday? */
export function availableAt(availability: AvailabilitySlot[], date: string, start: number, end: number): boolean {
  const day = new Date(date + "T00:00:00Z").getUTCDay();
  return availability.some((s) => s.day === day && s.from <= start && s.to >= end);
}

/** "Mon 8:00 AM – 12:00 PM, 5:00 PM – 9:00 PM · Sat 9:00 AM – 3:00 PM" */
export function availabilityText(availability: AvailabilitySlot[]): string {
  const days = new Map<number, string[]>();
  for (const s of availability) days.set(s.day, [...(days.get(s.day) ?? []), `${formatHour(s.from)} – ${formatHour(s.to)}`]);
  return [...days].map(([d, r]) => `${SHORT_DAYS[d]} ${r.join(", ")}`).join(" · ") || "Not set";
}

// Coach codes: COACH-XXXX-XXXX, from letters and digits that are easy to read out loud.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newCoachCode(random: (n: number) => number): string {
  const part = () => Array.from({ length: 4 }, () => CODE_ALPHABET[random(CODE_ALPHABET.length)]).join("");
  return `COACH-${part()}-${part()}`;
}
/** "coach 7k3q 9pxm" → "COACH-7K3Q-9PXM"; null if it isn't shaped like a coach code. */
export function normalizeCoachCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = c.startsWith("COACH") ? c.slice(5) : c;
  return /^[A-Z0-9]{8}$/.test(body) ? `COACH-${body.slice(0, 4)}-${body.slice(4)}` : null;
}

export const GENDERS = [
  { id: "man", label: "Man" },
  { id: "woman", label: "Woman" },
  { id: "non_binary", label: "Non-binary" },
  { id: "self_describe", label: "Prefer to self-describe" },
  { id: "prefer_not_to_say", label: "Prefer not to say" },
] as const;
export type Gender = (typeof GENDERS)[number]["id"];
export const genderText = (g: string, self: string) =>
  g === "self_describe" ? self || "Self-described" : GENDERS.find((x) => x.id === g)?.label ?? "—";

export type CoachForm = {
  fullName: string; nickname: string; gender: Gender; genderSelf: string; birthday: string;
  email: string; mobile: string; phpaId: string; sports: string[]; rates: string;
  availability: AvailabilitySlot[]; credentials: string; bio: string;
};

/** Is `today` (YYYY-MM-DD) their birthday? Feb 29 birthdays are celebrated on Feb 28 in other years. */
export function isBirthday(birthday: string | null, today: string): boolean {
  if (!birthday) return false;
  const md = birthday.slice(5);
  const year = Number(today.slice(0, 4));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return today.slice(5) === (md === "02-29" && !leap ? "02-28" : md);
}

/** Checks the sign-up / profile form. Returns the cleaned values or a message. */
export function validateCoachForm(input: Record<string, unknown>, knownSports: string[]): CoachForm | string {
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/[ \t]+/g, " ").slice(0, max) : "");
  const fullName = text(input.fullName, 80);
  const nickname = text(input.nickname, 40);
  const gender = typeof input.gender === "string" && GENDERS.some((g) => g.id === input.gender) ? (input.gender as Gender) : null;
  const genderSelf = gender === "self_describe" ? text(input.genderSelf, 40) : "";
  const birthday = typeof input.birthday === "string" ? input.birthday : "";
  const credentials = typeof input.credentials === "string" ? input.credentials.trim().slice(0, 1500) : "";
  const bio = typeof input.bio === "string" ? input.bio.trim().slice(0, 1500) : "";
  const email = text(input.email, 120).toLowerCase();
  const mobile = text(input.mobile, 30);
  const phpaId = text(input.phpaId, 40);
  const rates = typeof input.rates === "string" ? input.rates.trim().slice(0, 1000) : "";
  const sports = Array.isArray(input.sports) ? [...new Set(input.sports.filter((s): s is string => knownSports.includes(s as string)))] : [];
  if (fullName.length < 3 || !/\s/.test(fullName)) return "Enter your full legal name (first and last).";
  if (nickname.length < 2) return "Enter the name customers will see (e.g. Coach Marvin).";
  if (!gender) return "Choose your gender (or “Prefer not to say”).";
  if (gender === "self_describe" && !genderSelf) return "Describe your gender, or choose another option.";
  const bd = /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? new Date(birthday + "T00:00:00Z") : null;
  if (!bd || isNaN(bd.getTime()) || bd.toISOString().slice(0, 10) !== birthday) return "Enter your birthday.";
  const age = (Date.now() - bd.getTime()) / (365.25 * 86_400_000);
  if (age < 13 || age > 100) return "Please check your birthday.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "Enter a valid email address.";
  if (mobile.replace(/\D/g, "").length < 10) return "Enter your mobile number.";
  if (sports.length === 0) return "Choose the sport(s) you coach.";
  if (rates.length < 3) return "Describe your coaching rates (e.g. ₱500 per hour, ₱2,000 for 5 sessions).";
  const availability = cleanAvailability(input.availability);
  if (typeof availability === "string") return availability;
  if (availability.length === 0) return "Add at least one day and time you're available.";
  return { fullName, nickname, gender, genderSelf, birthday, email, mobile, phpaId, sports, rates, availability, credentials, bio };
}

/** Up to two initials for a placeholder avatar ("Coach Marvin" → "CM"). */
export const initials = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

// ---- A coach's clients (the Coaches Dashboard's Clients tab) ------------------------------------

/** What the Clients tab needs from each of the coach's bookings. */
export type ClientBooking = {
  id: string; code: string; date: string; start_hour: number; end_hour: number; court_name: string;
  status: string; payment_status: string; kind: "own" | "coaching";
  client_name: string; // their own bookings: typed by the coach ("" = not set)
  customer_name: string | null; customer_contact: string | null; coaching_status: string | null;
  total: number;
};

export type Client = {
  key: string; // "" = their own bookings with no client set
  name: string;
  contact: string; // from a coaching request, when there is one
  bookings: ClientBooking[]; // newest first
  upcoming: number;
  next: string | null; // "YYYY-MM-DD" of the next session
  last: string | null; // of the latest past session
  unpaid: number; // their own bookings, played and not paid
};

export type ClientSort = "recent" | "name" | "sessions";

/** Which client a name belongs to: the same name typed differently ("mark  tan", "Mark Tan") is one client. */
export const clientKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Groups a coach's bookings by client: their own bookings by the client name they typed, and
 * coaching sessions customers requested (accepted or waiting) by the customer's name. Cancelled
 * and declined ones are left out. Own bookings with no client go last, under key "".
 */
export function groupClients(bookings: ClientBooking[], today: string, sort: ClientSort = "recent"): Client[] {
  const groups = new Map<string, Client>();
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    if (b.kind === "coaching" && b.coaching_status !== "accepted" && b.coaching_status !== "requested") continue;
    const name = (b.kind === "own" ? b.client_name : b.customer_name ?? "").trim().replace(/\s+/g, " ");
    const key = clientKey(name);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, name: key ? name : "No client set", contact: "", bookings: [], upcoming: 0, next: null, last: null, unpaid: 0 }));
    g.bookings.push(b);
    // Typed differently on other bookings ("mark tan", "Mark Tan"): show the capitalised one.
    if (key && g.name === g.name.toLowerCase() && name !== name.toLowerCase()) g.name = name;
    if (!g.contact && b.customer_contact) g.contact = b.customer_contact;
    if (b.date >= today) {
      g.upcoming++;
      if (!g.next || b.date < g.next) g.next = b.date;
    } else if (!g.last || b.date > g.last) g.last = b.date;
    if (b.kind === "own" && b.date < today && b.total > 0 && (b.payment_status === "unpaid" || b.payment_status === "rejected")) g.unpaid++;
  }
  const list = [...groups.values()];
  for (const g of list) g.bookings.sort((a, b) => b.date.localeCompare(a.date) || b.start_hour - a.start_hour);
  const activity = (g: Client) => g.next ?? g.last ?? "";
  list.sort((a, b) => {
    if (!a.key !== !b.key) return a.key ? -1 : 1; // "No client set" last
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "sessions") return b.bookings.length - a.bookings.length || a.name.localeCompare(b.name);
    // Most recent: upcoming clients first (soonest first), then by their latest session.
    if (!!a.next !== !!b.next) return a.next ? -1 : 1;
    return a.next && b.next ? a.next.localeCompare(b.next) : activity(b).localeCompare(activity(a));
  });
  return list;
}

/** A client name the coach has used before, and how many sessions it has (for suggestions). */
export type KnownClient = { name: string; sessions: number };

/**
 * Suggestions while a coach types a client's name, so the same person isn't entered twice under
 * different spellings ("Mike Santos" → "Michael Santos"). A name matches when a word of it starts
 * with a typed word (or the other way round), so a shared surname is enough. Best matches first,
 * then the clients with the most sessions. Nothing typed: the coach's most frequent clients.
 * A name that's exactly what was typed isn't suggested.
 */
export function suggestClients(query: string, clients: KnownClient[], limit = 5): KnownClient[] {
  const words = (s: string) => clientKey(s).split(" ").filter((w) => w.length >= 2);
  const typed = clientKey(query);
  if (!typed) return [...clients].sort((a, b) => b.sessions - a.sessions).slice(0, limit);
  const q = words(query);
  return clients
    .filter((c) => clientKey(c.name) !== typed)
    .map((c) => {
      const name = clientKey(c.name);
      const ws = words(c.name);
      let score = name.startsWith(typed) ? 10 : 0; // what's typed so far is the start of the name
      for (const w of q) if (ws.some((n) => n.startsWith(w) || w.startsWith(n))) score += 2;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.c.sessions - a.c.sessions || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map((x) => x.c);
}

/** The coach's clients for suggestions, from their bookings (see groupClients). */
export const knownClients = (bookings: ClientBooking[], today: string): KnownClient[] =>
  groupClients(bookings, today).filter((c) => c.key).map((c) => ({ name: c.name, sessions: c.bookings.length }));
