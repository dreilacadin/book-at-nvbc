import { randomBytes } from "node:crypto";
import type { Result } from "./bookings";
import { db } from "./db";
import {
  isScholarStatus,
  openBatches,
  scholarBatchLabel,
  scholarBatchWhen,
  scholarSportLabel,
  validateGuardianConsent,
  validateScholarApplication,
  type ScholarStatus,
} from "./scholar";
import { nowAtFacility } from "./time";

const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
const validToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{20,40}$/.test(t);

/** A full application, including a minor's contact and health details (owner and managers only). */
export type ScholarRecord = {
  id: string;
  token: string;
  status: ScholarStatus;
  full_name: string;
  birthdate: string;
  mobile: string;
  facebook_name: string;
  address: string;
  school: string;
  year_level: string;
  sport: string;
  batch: string;
  years_playing: string;
  experience: string;
  availability: string[];
  why_fit: string;
  initiative: string;
  emergency_name: string;
  emergency_mobile: string;
  medical: string;
  consent_required: boolean;
  photo_consent: string;
  guardian_name: string;
  guardian_relationship: string;
  guardian_mobile: string;
  guardian_notes: string;
  consent_signature: string;
  consent_at: string | null;
  staff_notes: string;
  created_at: string;
};

const COLUMNS = `id, token, status, full_name, birthdate, mobile, facebook_name, address, school, year_level, sport, batch,
  years_playing, experience, availability, why_fit, initiative, emergency_name, emergency_mobile, medical,
  consent_required, photo_consent, guardian_name, guardian_relationship, guardian_mobile, guardian_notes,
  consent_signature, consent_at, staff_notes, created_at`;

// ---- Public: apply, and a guardian's consent ------------------------------------------------

/** Someone applies. Returns the secret token for the consent link (and whether it's needed). */
export async function applyToBeScholar(input: Record<string, unknown>): Promise<Result<{ token: string; consentRequired: boolean }>> {
  if (typeof input.website === "string" && input.website.trim()) return fail(400, "Application could not be sent.");
  const nowMs = Date.now();
  if (openBatches(nowMs).length === 0) return fail(409, "Applications for this round of tryouts have closed.");
  const form = validateScholarApplication(input, nowAtFacility().date, nowMs);
  if (typeof form === "string") return fail(400, form);

  const token = randomBytes(18).toString("base64url");
  // One application per person (same name and birthdate), enforced by a unique index.
  const ins = await db().query(
    `INSERT INTO scholar_applications (token, full_name, birthdate, mobile, facebook_name, address, school, year_level,
       sport, batch, years_playing, experience, availability, why_fit, initiative, emergency_name, emergency_mobile,
       medical, consent_required, photo_consent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text[], $14, $15, $16, $17, $18, $19, $20)
     ON CONFLICT DO NOTHING RETURNING id`,
    [token, form.fullName, form.birthdate, form.mobile, form.facebookName, form.address, form.school, form.yearLevel,
      form.sport, form.batch, form.yearsPlaying, form.experience, form.availability, form.whyFit, form.initiative,
      form.emergencyName, form.emergencyMobile, form.medical, form.consentRequired, form.photoConsent]
  );
  if (!ins.rowCount)
    return fail(409, "You have already applied. If you need to change something or lost your consent link, please message NVBC or ask at the front desk.");
  return { ok: true, data: { token, consentRequired: form.consentRequired } };
}

/** What the secret consent link shows. Only enough to know whose application it is: no contact or health details. */
export type ConsentView = {
  applicantName: string;
  sport: string;
  batch: string;
  batchWhen: string;
  consentRequired: boolean;
  signed: boolean;
};

export async function getConsentView(token: unknown): Promise<Result<ConsentView>> {
  if (!validToken(token)) return fail(404, "This link isn't valid. Please ask the applicant to send it again.");
  const { rows } = await db().query<{ full_name: string; sport: string; batch: string; consent_required: boolean; consent_at: string | null }>(
    `SELECT full_name, sport, batch, consent_required, consent_at FROM scholar_applications WHERE token = $1`,
    [token]
  );
  const a = rows[0];
  if (!a) return fail(404, "This link isn't valid. Please ask the applicant to send it again.");
  return {
    ok: true,
    data: {
      applicantName: a.full_name,
      sport: scholarSportLabel(a.sport),
      batch: scholarBatchLabel(a.batch),
      batchWhen: scholarBatchWhen(a.batch),
      consentRequired: a.consent_required,
      signed: a.consent_at !== null,
    },
  };
}

/** A parent or guardian signs through the secret link. A signed consent can't be changed here. */
export async function submitGuardianConsent(token: unknown, input: Record<string, unknown>): Promise<Result<{ signed: true }>> {
  if (!validToken(token)) return fail(404, "This link isn't valid. Please ask the applicant to send it again.");
  const { rows } = await db().query<{ full_name: string; consent_required: boolean; consent_at: string | null }>(
    `SELECT full_name, consent_required, consent_at FROM scholar_applications WHERE token = $1`,
    [token]
  );
  const a = rows[0];
  if (!a) return fail(404, "This link isn't valid. Please ask the applicant to send it again.");
  if (!a.consent_required) return fail(409, "This application doesn't need a parent's or guardian's consent.");
  if (a.consent_at) return fail(409, "Consent for this application has already been given. Thank you!");
  const form = validateGuardianConsent(input, a.full_name);
  if (typeof form === "string") return fail(400, form);
  const up = await db().query(
    `UPDATE scholar_applications
        SET guardian_name = $2, guardian_relationship = $3, guardian_mobile = $4, guardian_notes = $5,
            photo_consent = $6, consent_signature = $7, consent_at = now()
      WHERE token = $1 AND consent_at IS NULL`,
    [token, form.guardianName, form.relationship, form.guardianMobile, form.guardianNotes, form.photoConsent, form.signature]
  );
  if (!up.rowCount) return fail(409, "Consent for this application has already been given. Thank you!");
  return { ok: true, data: { signed: true } };
}

// ---- Owner and managers ---------------------------------------------------------------------

export async function listScholarApplications(): Promise<ScholarRecord[]> {
  const { rows } = await db().query<ScholarRecord>(`SELECT ${COLUMNS} FROM scholar_applications ORDER BY created_at DESC LIMIT 500`);
  return rows;
}

export async function updateScholarApplication(id: string, input: Record<string, unknown>): Promise<Result<{ id: string }>> {
  if (!isId(id)) return fail(404, "Application not found.");
  if (!isScholarStatus(input.status)) return fail(400, "Please choose a status.");
  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 1000) : "";
  const r = await db().query(`UPDATE scholar_applications SET status = $2, staff_notes = $3 WHERE id = $1`, [id, input.status, notes]);
  return r.rowCount ? { ok: true, data: { id } } : fail(404, "Application not found.");
}

export async function deleteScholarApplication(id: string): Promise<Result<{ id: string }>> {
  if (!isId(id)) return fail(404, "Application not found.");
  const r = await db().query(`DELETE FROM scholar_applications WHERE id = $1`, [id]);
  return r.rowCount ? { ok: true, data: { id } } : fail(404, "Application not found.");
}
