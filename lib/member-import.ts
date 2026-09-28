// Importing existing members from a spreadsheet (e.g. a Google Forms responses sheet).
// Shared by the admin page (parsing, preview) and the server (re-validation). No Node-only imports.

import type { MemberType } from "./membership";

// ---- Reading CSV / pasted cells ---------------------------------------------------------

/**
 * Parses CSV (Google Sheets "Download → CSV") or tab-separated text (cells copied from a sheet).
 * Handles quoted fields with commas, quotes and line breaks. Drops fully empty rows.
 */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.indexOf("\n") === -1 ? undefined : src.indexOf("\n"));
  const sep = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

// ---- Matching columns -----------------------------------------------------------------

export const IMPORT_FIELDS = [
  { id: "fullName", label: "Full name", required: true, hints: ["full name", "name", "pangalan"] },
  { id: "firstName", label: "First name (if split)", hints: ["first name", "given name"] },
  { id: "lastName", label: "Last name (if split)", hints: ["last name", "surname", "family name"] },
  { id: "email", label: "Email", hints: ["email"] },
  { id: "mobile", label: "Mobile number", hints: ["mobile", "contact number", "phone", "cellphone", "contact no", "cp"] },
  { id: "address", label: "Address", hints: ["address", "home address"] },
  { id: "birthdate", label: "Birthdate", hints: ["birthdate", "birthday", "date of birth", "birth date", "dob"] },
  { id: "gender", label: "Gender", hints: ["gender", "sex"] },
  { id: "memberType", label: "Membership type (student/adult)", hints: ["membership type", "type", "category", "student"] },
  { id: "school", label: "School", hints: ["school", "university", "college"] },
  { id: "studentId", label: "Student ID", hints: ["student id", "student number", "id number"] },
  { id: "emergencyName", label: "Emergency contact name", hints: ["emergency contact name", "emergency contact", "in case of emergency"] },
  { id: "emergencyMobile", label: "Emergency contact number", hints: ["emergency contact number", "emergency number", "emergency mobile"] },
  { id: "startsOn", label: "Membership start date", hints: ["date paid", "payment date", "start date", "membership date", "date joined", "timestamp"] },
  { id: "expiresOn", label: "Expiry date", hints: ["expiry", "expiration", "valid until", "expires"] },
  { id: "notes", label: "Notes / old member ID", hints: ["notes", "remarks", "member id", "old id", "member no"] },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]["id"];
export type Mapping = Partial<Record<ImportField, number>>; // field → column index

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Guesses which column holds each field from the header row (question text on Google Forms). */
export function guessMapping(headers: string[]): Mapping {
  const cols = headers.map(norm);
  const used = new Set<number>();
  const map: Mapping = {};
  // More specific fields first, so "Emergency contact number" isn't taken by "Mobile number".
  const order: ImportField[] = [
    "emergencyMobile", "emergencyName", "firstName", "lastName", "studentId", "expiresOn", "startsOn", "birthdate",
    "email", "fullName", "mobile", "address", "gender", "memberType", "school", "notes",
  ];
  for (const id of order) {
    const f = IMPORT_FIELDS.find((x) => x.id === id)!;
    let best = -1;
    let bestScore = 0;
    cols.forEach((c, i) => {
      if (used.has(i)) return;
      for (const h of f.hints) {
        const score = c === h ? 3 : c.startsWith(h) ? 2 : c.includes(h) ? 1 : 0;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
    });
    // "name" alone is too loose to take a column already better matched; require a decent match.
    if (best >= 0 && (bestScore >= 2 || (bestScore === 1 && id !== "fullName" && id !== "memberType"))) {
      map[id] = best;
      used.add(best);
    }
  }
  if (map.firstName !== undefined && map.lastName !== undefined && map.fullName === undefined) delete map.fullName;
  return map;
}

// ---- Dates ------------------------------------------------------------------------------

export type DateOrder = "mdy" | "dmy" | "ymd";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const iso = (y: number, m: number, d: number) => {
  if (y < 100) y += y < 50 ? 2000 : 1900;
  const s = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(s + "T00:00:00Z");
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s ? s : null;
};

/**
 * "6/15/1995", "15/06/1995", "1995-06-15", "June 15, 1995", "15 Jun 1995", or a Google Forms
 * timestamp "9/28/2026 14:03:22" → "YYYY-MM-DD" (null if it isn't a date).
 */
export function parseDate(value: string, order: DateOrder): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(v);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(v);
  if (m) return order === "dmy" ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
  // Month names: "June 15, 1995" / "15 June 1995"
  const month = MONTHS.findIndex((mo) => new RegExp(`\\b${mo}`).test(v));
  const nums = v.match(/\d+/g)?.map(Number) ?? [];
  if (month >= 0 && nums.length >= 2) {
    const year = nums.find((n) => n > 31) ?? nums[nums.length - 1];
    const day = nums.find((n) => n !== year && n >= 1 && n <= 31);
    if (day) return iso(year, month + 1, day);
  }
  return null;
}

/** Looks at slash dates in the given columns: a first part over 12 means day/month. */
export function detectDateOrder(values: string[]): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(v.trim());
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    else if (+m[2] > 12) mdy++;
  }
  return dmy > mdy ? "dmy" : "mdy";
}

// ---- Records ----------------------------------------------------------------------------

/** One member to import, cleaned. Missing optional details are "". */
export type ImportRecord = {
  row: number; // spreadsheet row number, for messages
  fullName: string;
  email: string;
  mobile: string;
  address: string;
  birthdate: string | null;
  gender: string;
  memberType: MemberType;
  school: string;
  studentId: string;
  emergencyName: string;
  emergencyMobile: string;
  startsOn: string;
  expiresOn: string;
  notes: string;
};

export type ImportOptions = {
  dateOrder: DateOrder;
  defaultType: MemberType; // when there's no type column, or it's blank
  defaultStart: string; // when there's no start date column, or it's blank
  days: number; // membership length when there's no expiry column (MEMBERSHIP_DAYS)
};

const addDays = (date: string, n: number) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const clip = (s: string | undefined, max: number) => (s ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Turns one spreadsheet row into a record, or an error message. `row` is the 1-based row
 * number in the sheet (the header is row 1).
 */
export function toImportRecord(cells: string[], row: number, map: Mapping, opt: ImportOptions): ImportRecord | { row: number; error: string } {
  const get = (f: ImportField) => (map[f] === undefined ? "" : (cells[map[f]!] ?? "").trim());
  const fullName = clip(get("fullName") || [get("firstName"), get("lastName")].filter(Boolean).join(" "), 80);
  if (fullName.length < 2) return { row, error: "No name" };

  const email = clip(get("email"), 120).toLowerCase();
  if (email && !EMAIL.test(email)) return { row, error: `Email "${email}" doesn't look valid` };

  const rawBirth = get("birthdate");
  const birthdate = rawBirth ? parseDate(rawBirth, opt.dateOrder) : null;
  if (rawBirth && !birthdate) return { row, error: `Birthdate "${rawBirth}" isn't a date` };

  const rawStart = get("startsOn");
  const startsOn = rawStart ? parseDate(rawStart, opt.dateOrder) : opt.defaultStart;
  if (!startsOn) return { row, error: `Start date "${rawStart}" isn't a date` };

  const rawEnd = get("expiresOn");
  const expiresOn = rawEnd ? parseDate(rawEnd, opt.dateOrder) : addDays(startsOn, opt.days);
  if (!expiresOn) return { row, error: `Expiry date "${rawEnd}" isn't a date` };
  if (expiresOn <= startsOn) return { row, error: "Expiry date is before the start date" };

  const typeText = get("memberType").toLowerCase();
  const memberType: MemberType = typeText ? (/student|estudyante/.test(typeText) ? "student" : "adult") : opt.defaultType;

  return {
    row,
    fullName,
    email,
    mobile: clip(get("mobile"), 20),
    address: clip(get("address"), 200),
    birthdate,
    gender: clip(get("gender"), 30),
    memberType,
    school: memberType === "student" ? clip(get("school"), 120) : "",
    studentId: memberType === "student" ? clip(get("studentId"), 40) : "",
    emergencyName: clip(get("emergencyName"), 80),
    emergencyMobile: clip(get("emergencyMobile"), 20),
    startsOn,
    expiresOn,
    notes: clip(get("notes"), 200),
  };
}

/** Server-side re-check of a record sent by the admin page. Returns an error message or null. */
export function checkImportRecord(r: ImportRecord): string | null {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof r.fullName !== "string" || r.fullName.trim().length < 2 || r.fullName.length > 80) return "No name";
  if (typeof r.email !== "string" || (r.email && !EMAIL.test(r.email))) return "Invalid email";
  if (r.memberType !== "student" && r.memberType !== "adult") return "Invalid membership type";
  if (r.birthdate !== null && (typeof r.birthdate !== "string" || !date.test(r.birthdate))) return "Invalid birthdate";
  if (typeof r.startsOn !== "string" || !date.test(r.startsOn)) return "Invalid start date";
  if (typeof r.expiresOn !== "string" || !date.test(r.expiresOn) || r.expiresOn <= r.startsOn) return "Invalid expiry date";
  for (const k of ["mobile", "address", "gender", "school", "studentId", "emergencyName", "emergencyMobile", "notes"] as const)
    if (typeof r[k] !== "string" || r[k].length > 200) return `Invalid ${k}`;
  return null;
}

// ---- Duplicates -----------------------------------------------------------------------

export type ExistingMember = { name: string; mobile: string; birthdate: string | null; member_code: string | null };
export type MatchField = "name" | "contact" | "birthdate";
export type DuplicateCheck =
  | { ask: string; matched: MatchField[] } // looks like the same person — staff choose Skip or Import anyway
  | { warn: string } // same name, nothing else to compare — starts unticked
  | null;

const personName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** Compares mobile numbers by their last 10 digits: "0917 123 4567" = "+63 917 123 4567". */
export const phoneKey = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d.length >= 7 ? d : "";
};
const FIELD_WORDS: Record<MatchField, string> = { name: "name", contact: "contact number", birthdate: "birthday" };
const listWords = (f: MatchField[]) =>
  f.length === 1 ? FIELD_WORDS[f[0]] : `${f.slice(0, -1).map((x) => FIELD_WORDS[x]).join(", ")} and ${FIELD_WORDS[f[f.length - 1]]}`;

/**
 * Finds rows that look like someone already a member, or like an earlier row in the file, by
 * comparing name, contact number and birthday. Two or more matching details → ask staff whether
 * to import (nothing is skipped silently). Only the name matching, with no birthday in the row
 * to compare → flagged. A shared email alone never counts (families often use one email).
 */
export function findDuplicates(
  records: Pick<ImportRecord, "row" | "fullName" | "mobile" | "birthdate">[],
  existing: ExistingMember[]
): DuplicateCheck[] {
  type Person = { name: string; phone: string; birthdate: string | null; label: string };
  const people: Person[] = existing.map((m) => ({
    name: personName(m.name),
    phone: phoneKey(m.mobile),
    birthdate: m.birthdate,
    label: `${m.name}${m.member_code ? ` (member ${m.member_code})` : " (already applied)"}`,
  }));
  const earlier: Person[] = [];

  return records.map((r) => {
    const me = { name: personName(r.fullName), phone: phoneKey(r.mobile), birthdate: r.birthdate };
    let best: { matched: MatchField[]; label: string } | null = null;
    for (const p of [...people, ...earlier]) {
      const matched: MatchField[] = [];
      if (p.name === me.name) matched.push("name");
      if (me.phone && p.phone === me.phone) matched.push("contact");
      if (me.birthdate && p.birthdate === me.birthdate) matched.push("birthdate");
      if (!best || matched.length > best.matched.length) best = { matched, label: p.label };
      if (matched.length === 3) break;
    }
    earlier.push({ name: me.name, phone: me.phone, birthdate: me.birthdate, label: `row ${r.row}` });

    if (best && best.matched.length >= 2) {
      return { ask: `Same ${listWords(best.matched)} as ${best.label}`, matched: best.matched };
    }
    if (best?.matched.includes("name") && !me.birthdate)
      return { warn: `Same name as ${best.label} — no birthday to compare` };
    return null;
  });
}
