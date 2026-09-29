import { randomBytes, randomInt } from "node:crypto";
import QRCode from "qrcode";
import { cleanRef, enabledMethods, type Result } from "./bookings";
import { db, getSettings } from "./db";
import {
  formatMemberCode,
  MEMBER_CODE_ALPHABET_SIZE,
  memberTypeLabel,
  MEMBERSHIP_DAYS,
  membershipState,
  normalizeMemberCode,
  validateMemberEdit,
  type MembershipState,
  validateMembershipForm,
  type MembershipStatus,
  type MemberType,
} from "./membership";
import { emailSender, sendEmail } from "./mailer";
import { fillTemplate, niceLongDate, type ReminderVars } from "./reminder-email";
import { publicName } from "./format";
import { notifyStaff } from "./notify";
import { checkImportRecord, findDuplicates, type ImportRecord } from "./member-import";
import { formatPeso, hasPaymentProof, isPaymentMethod, isPaymentStatus, isProofImage, type PaymentMethod, type PaymentStatus } from "./pricing";
import { SPORTS } from "./sports";
import { addDays, nowAtFacility } from "./time";

const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

/** A full membership record (staff only). */
export type Membership = {
  id: string;
  token: string;
  member_code: string | null;
  status: MembershipStatus;
  member_type: MemberType;
  full_name: string;
  email: string;
  mobile: string;
  address: string;
  birthdate: string | null; // may be missing on imported members
  gender: string;
  school: string;
  student_id: string;
  sports: string[];
  emergency_name: string;
  emergency_mobile: string;
  fee: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  payment_ref: string;
  has_proof: boolean;
  paid_at: string | null;
  member_since: string | null;
  starts_on: string | null;
  expires_on: string | null;
  staff_notes: string;
  created_at: string;
  approved_at: string | null;
  reminded_on: string | null; // last time staff reminded an expired member to renew or forfeit
  emailed_on: string | null; // last reminder email
  forfeited_on: string | null;
};

const COLUMNS = `id, token, member_code, status, member_type, full_name, email, mobile, address, birthdate, gender,
  school, student_id, sports, emergency_name, emergency_mobile, fee, payment_method, payment_status, payment_ref,
  (payment_proof <> '') AS has_proof, paid_at, member_since, starts_on, expires_on, staff_notes, created_at, approved_at,
  reminded_on, forfeited_on, emailed_on`;

// ---- Public: apply, check status, send payment -------------------------------------------

/** Someone applies for membership. Returns the secret token for their status page. */
export async function applyForMembership(input: Record<string, unknown>): Promise<Result<{ token: string }>> {
  if (typeof input.website === "string" && input.website.trim()) return fail(400, "Application could not be sent.");
  const today = nowAtFacility().date;
  const form = validateMembershipForm(input, today, SPORTS.map((s) => s.id));
  if (typeof form === "string") return fail(400, form);

  // Everyone applies once. Blocks a second application while one is pending, and for anyone who
  // has ever been approved — expired memberships are renewed at the front desk instead.
  // The same person = same full name AND birthdate (like the member import). A shared email is
  // fine: families often sign several people up with one parent's email.
  const existing = await db().query<{ status: MembershipStatus }>(
    `SELECT status FROM memberships
      WHERE status <> 'rejected' AND birthdate = $2
        AND regexp_replace(lower(trim(full_name)), '\\s+', ' ', 'g') = regexp_replace(lower(trim($1)), '\\s+', ' ', 'g')
      ORDER BY (status = 'active') DESC, (status = 'forfeited') DESC LIMIT 1`,
    [form.fullName, form.birthdate]
  );
  const prior = existing.rows[0];
  if (prior?.status === "forfeited")
    return fail(409, "Your NVBC membership has ended. The front desk can reactivate it for you — you'll keep your member code.");
  if (prior?.status === "active")
    return fail(
      409,
      "You're already an NVBC member — membership is applied for only once. Open your member page on the phone you applied with, " +
        "or ask the front desk for your member code. Expired memberships are renewed at the front desk."
    );
  if (prior?.status === "pending")
    return fail(409, "You already have a pending application. Open the link you got when you applied, or ask the front desk.");

  const settings = await getSettings();
  const fee = form.memberType === "student" ? settings.membership_fee_student : settings.membership_fee_adult;
  const token = randomBytes(18).toString("base64url");
  const ins = await db().query<{ id: string }>(
    `INSERT INTO memberships (token, member_type, full_name, email, mobile, address, birthdate, gender, school,
                              student_id, sports, emergency_name, emergency_mobile, fee)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12, $13, $14) RETURNING id`,
    [token, form.memberType, form.fullName, form.email, form.mobile, form.address, form.birthdate, form.gender,
      form.school, form.studentId, form.sports, form.emergencyName, form.emergencyMobile, fee]
  );
  await notifyStaff([{
    kind: "member_applied",
    title: `Membership application — ${form.fullName}`,
    pushTitle: `Membership application — ${publicName(form.fullName)}`,
    body: `${memberTypeLabel(form.memberType)} · ${formatPeso(fee)} · waiting for payment and approval`,
    membershipId: ins.rows[0].id,
  }]);
  return { ok: true, data: { token } };
}

/** What the applicant sees on their own status page (reached only through their secret link). */
export type MembershipView = {
  state: MembershipState;
  memberType: MemberType;
  fullName: string;
  fee: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentRef: string;
  hasProof: boolean;
  memberCode: string | null;
  memberSince: string | null;
  startsOn: string | null;
  expiresOn: string | null;
  qr: string | null; // PNG data: URL of the member code
  appliedOn: string;
};

const validToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{20,40}$/.test(t);

export async function getMembershipView(token: unknown): Promise<Result<MembershipView>> {
  if (!validToken(token)) return fail(404, "Membership application not found.");
  const { rows } = await db().query<Membership>(`SELECT ${COLUMNS} FROM memberships WHERE token = $1`, [token]);
  const m = rows[0];
  if (!m) return fail(404, "Membership application not found.");
  const state = membershipState(m, nowAtFacility().date);
  const qr =
    m.member_code && (state === "active" || state === "expired")
      ? await QRCode.toDataURL(m.member_code, { errorCorrectionLevel: "M", margin: 2, width: 360 })
      : null;
  return {
    ok: true,
    data: {
      state,
      memberType: m.member_type,
      fullName: m.full_name,
      fee: m.fee,
      paymentMethod: m.payment_method,
      paymentStatus: m.payment_status,
      paymentRef: m.payment_ref,
      hasProof: m.has_proof,
      memberCode: m.member_code,
      memberSince: m.member_since,
      startsOn: m.starts_on,
      expiresOn: m.expires_on,
      qr,
      appliedOn: new Date(m.created_at).toISOString().slice(0, 10),
    },
  };
}

/** Applicant says they paid by GCash / QR Ph / BPI: store the reference and/or screenshot for staff. */
export async function submitMembershipPayment(
  token: unknown,
  method: unknown,
  ref: unknown,
  proof: unknown
): Promise<Result<{ paymentStatus: PaymentStatus; paymentMethod: PaymentMethod; paymentRef: string; hasProof: boolean }>> {
  if (!validToken(token)) return fail(404, "Membership application not found.");
  if (!isPaymentMethod(method)) return fail(400, "Choose a payment method.");
  const settings = await getSettings();
  if (!enabledMethods(settings).includes(method)) return fail(400, "That payment method isn't available right now.");

  if (method === "cash") {
    // Paying at the front desk: just remember the choice.
    const { rows } = await db().query(
      `UPDATE memberships SET payment_method = 'cash'
        WHERE token = $1 AND status = 'pending' AND payment_status IN ('unpaid', 'for_verification')
        RETURNING payment_status, payment_ref, (payment_proof <> '') AS has_proof`,
      [token]
    );
    if (!rows[0]) return fail(400, "This application can no longer be changed.");
    return { ok: true, data: { paymentStatus: rows[0].payment_status, paymentMethod: "cash", paymentRef: rows[0].payment_ref, hasProof: rows[0].has_proof } };
  }

  const paymentRef = cleanRef(ref);
  const paymentProof = proof === undefined || proof === null || proof === "" ? "" : proof;
  if (paymentProof !== "" && !isProofImage(paymentProof))
    return fail(400, "The payment screenshot must be a PNG, JPG or WebP image under 700 KB.");
  if (!hasPaymentProof(paymentRef, paymentProof))
    return fail(400, "Enter the reference number or upload a screenshot of your payment receipt.");

  const { rows } = await db().query<{ payment_ref: string; has_proof: boolean }>(
    `UPDATE memberships SET payment_method = $2,
            payment_ref   = CASE WHEN $3 = '' THEN payment_ref ELSE $3 END,
            payment_proof = CASE WHEN $4 = '' THEN payment_proof ELSE $4 END,
            payment_status = 'for_verification'
      WHERE token = $1 AND status = 'pending' AND payment_status IN ('unpaid', 'for_verification')
      RETURNING payment_ref, (payment_proof <> '') AS has_proof`,
    [token, method, paymentRef, paymentProof]
  );
  if (!rows[0]) return fail(400, "This application can no longer be changed.");
  return { ok: true, data: { paymentStatus: "for_verification", paymentMethod: method, paymentRef: rows[0].payment_ref, hasProof: rows[0].has_proof } };
}

// ---- Staff ------------------------------------------------------------------------------

export async function listMemberships(): Promise<Membership[]> {
  const { rows } = await db().query<Membership>(`SELECT ${COLUMNS} FROM memberships ORDER BY created_at DESC LIMIT 1000`);
  return rows;
}

/** Look a member up by the code on their QR (scanned or typed). */
export async function findByMemberCode(raw: unknown): Promise<Result<Membership>> {
  const code = normalizeMemberCode(raw);
  if (!code) return fail(400, "Member codes look like NVBC-7K3Q-9PXM.");
  const { rows } = await db().query<Membership>(`SELECT ${COLUMNS} FROM memberships WHERE member_code = $1`, [code]);
  if (!rows[0]) return fail(404, `No member found with code ${code}.`);
  return { ok: true, data: rows[0] };
}

export async function setMembershipPayment(id: string, status: unknown): Promise<Result<{ id: string }>> {
  if (!isId(id)) return fail(400, "Invalid id.");
  if (!isPaymentStatus(status)) return fail(400, "Unknown payment status.");
  const { rowCount } = await db().query(
    `UPDATE memberships SET payment_status = $2,
            paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, now()) ELSE NULL END
      WHERE id = $1`,
    [id, status]
  );
  if (!rowCount) return fail(404, "Membership not found.");
  return { ok: true, data: { id } };
}

async function newMemberCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = formatMemberCode(Array.from({ length: 8 }, () => randomInt(MEMBER_CODE_ALPHABET_SIZE)));
    const taken = await db().query(`SELECT 1 FROM memberships WHERE member_code = $1`, [code]);
    if (!taken.rows[0]) return code;
  }
  throw new Error("Could not generate a unique member code");
}

/** Approve a paid application: gives it a member code and 365 days from today. */
export async function approveMembership(id: string): Promise<Result<{ id: string; memberCode: string }>> {
  if (!isId(id)) return fail(400, "Invalid id.");
  const cur = await db().query<{ status: MembershipStatus; payment_status: PaymentStatus; member_code: string | null }>(
    `SELECT status, payment_status, member_code FROM memberships WHERE id = $1`,
    [id]
  );
  const m = cur.rows[0];
  if (!m) return fail(404, "Membership not found.");
  if (m.status === "active") return fail(400, "This membership is already approved.");
  if (m.payment_status !== "paid" && m.payment_status !== "waived")
    return fail(400, "Mark the membership fee Paid (or No charge) before approving.");
  const today = nowAtFacility().date;
  const memberCode = m.member_code ?? (await newMemberCode());
  const { rows } = await db().query(
    `UPDATE memberships SET status = 'active', member_code = $2, member_since = COALESCE(member_since, $3::date),
            starts_on = $3, expires_on = $4, approved_at = now()
      WHERE id = $1 AND status <> 'active' RETURNING id`,
    [id, memberCode, today, addDays(today, MEMBERSHIP_DAYS)]
  );
  if (!rows[0]) return fail(409, "This membership was just changed. Refresh and try again.");
  return { ok: true, data: { id, memberCode } };
}

/**
 * Renew for another 365 days (after collecting the fee at the desk). A membership renewed early
 * keeps its remaining days: the new year starts when the current one ends. An expired or
 * forfeited membership restarts today. Same member code.
 */
export async function renewMembership(id: string): Promise<Result<{ id: string; expiresOn: string }>> {
  if (!isId(id)) return fail(400, "Invalid id.");
  const { rows } = await db().query<{ expires_on: string | null; status: MembershipStatus }>(
    `SELECT expires_on, status FROM memberships WHERE id = $1`,
    [id]
  );
  const m = rows[0];
  if (!m) return fail(404, "Membership not found.");
  if ((m.status !== "active" && m.status !== "forfeited") || !m.expires_on)
    return fail(400, "Only approved memberships can be renewed.");
  const today = nowAtFacility().date;
  const startsOn = m.status === "active" && m.expires_on > today ? m.expires_on : today;
  const expiresOn = addDays(startsOn, MEMBERSHIP_DAYS);
  const what = m.status === "forfeited" ? "Reactivated" : "Renewed";
  await db().query(
    `UPDATE memberships SET status = 'active', starts_on = $2, expires_on = $3, payment_status = 'paid', paid_at = now(),
            reminded_on = NULL, forfeited_on = NULL,
            staff_notes = btrim(staff_notes || E'\\n' || $4, E' \\n')
      WHERE id = $1`,
    [id, startsOn, expiresOn, `${what} ${today}: ${startsOn} → ${expiresOn}`]
  );
  return { ok: true, data: { id, expiresOn } };
}

/** The member doesn't want to renew: end the membership. Their code stops working. */
export async function forfeitMembership(id: string, reason: unknown): Promise<Result<{ id: string }>> {
  if (!isId(id)) return fail(400, "Invalid id.");
  const today = nowAtFacility().date;
  const note = typeof reason === "string" && reason.trim() ? `: ${reason.trim().slice(0, 200)}` : "";
  const { rowCount } = await db().query(
    `UPDATE memberships SET status = 'forfeited', forfeited_on = $2,
            staff_notes = btrim(staff_notes || E'\\n' || $3, E' \\n')
      WHERE id = $1 AND status = 'active'`,
    [id, today, `Forfeited ${today}${note}`]
  );
  if (!rowCount) return fail(400, "Only approved memberships can be forfeited.");
  return { ok: true, data: { id } };
}

/** Staff told an expired member to renew or forfeit: remember when. */
export async function markReminded(id: string): Promise<Result<{ id: string; remindedOn: string }>> {
  const r = await markRemindedMany([id]);
  if (!r.ok) return r;
  if (!r.data.marked) return fail(400, "Only expired memberships need a reminder.");
  return { ok: true, data: { id, remindedOn: nowAtFacility().date } };
}

/**
 * Marks several expired members as reminded. Someone already emailed a reminder (after their
 * membership expired) is marked with the email's date; anyone else with today's date.
 */
export async function markRemindedMany(ids: unknown): Promise<Result<{ marked: number }>> {
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && isId(x)) : [];
  if (list.length === 0) return fail(400, "Choose who to mark as reminded.");
  if (list.length > 2000) return fail(400, "Mark up to 2,000 at a time.");
  const today = nowAtFacility().date;
  const { rowCount } = await db().query(
    `UPDATE memberships
        SET reminded_on = CASE WHEN emailed_on IS NOT NULL AND emailed_on >= expires_on THEN emailed_on ELSE $2::date END
      WHERE id = ANY($1::uuid[]) AND status = 'active' AND expires_on <= $2`,
    [list, today]
  );
  return { ok: true, data: { marked: rowCount ?? 0 } };
}

export async function rejectMembership(id: string, reason: unknown): Promise<Result<{ id: string }>> {
  if (!isId(id)) return fail(400, "Invalid id.");
  const note = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
  const { rowCount } = await db().query(
    `UPDATE memberships SET status = 'rejected',
            staff_notes = CASE WHEN $2 = '' THEN staff_notes ELSE btrim(staff_notes || E'\\n' || $2, E' \\n') END
      WHERE id = $1 AND status = 'pending'`,
    [id, note ? `Not approved: ${note}` : ""]
  );
  if (!rowCount) return fail(400, "Only pending applications can be declined.");
  return { ok: true, data: { id } };
}

/**
 * Staff: permanently delete a member or application. Their past bookings stay; bookings made at
 * the member rate just lose the link to this membership.
 */
export async function deleteMembership(id: string): Promise<Result<{ id: string }>> {
  if (!isId(id)) return fail(400, "Invalid id.");
  const { rowCount } = await db().query(`DELETE FROM memberships WHERE id = $1`, [id]);
  if (!rowCount) return fail(404, "That member was already deleted.");
  return { ok: true, data: { id } };
}

/** Staff: correct a member's details (and, for approved memberships, their dates). */
export async function updateMembership(id: string, input: Record<string, unknown>): Promise<Result<Membership>> {
  if (!isId(id)) return fail(400, "Invalid id.");
  const cur = await db().query<{ status: MembershipStatus; expires_on: string | null }>(
    `SELECT status, expires_on FROM memberships WHERE id = $1`,
    [id]
  );
  if (!cur.rows[0]) return fail(404, "Member not found.");
  const approved = cur.rows[0].status === "active" || cur.rows[0].status === "forfeited";
  const e = validateMemberEdit(input, approved);
  if (typeof e === "string") return fail(400, e);
  const { rows } = await db().query<Membership>(
    `UPDATE memberships SET full_name = $2, email = $3, mobile = $4, address = $5, birthdate = $6, gender = $7,
            member_type = $8, school = $9, student_id = $10, emergency_name = $11, emergency_mobile = $12,
            staff_notes = $13,
            member_since = CASE WHEN $14::boolean THEN COALESCE($15::date, member_since) ELSE member_since END,
            starts_on    = CASE WHEN $14::boolean THEN $16::date ELSE starts_on END,
            expires_on   = CASE WHEN $14::boolean THEN $17::date ELSE expires_on END,
            -- A new expiry date means a new reminder is needed later.
            reminded_on  = CASE WHEN $14::boolean AND $17::date IS DISTINCT FROM expires_on THEN NULL ELSE reminded_on END
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, e.fullName, e.email, e.mobile, e.address, e.birthdate, e.gender, e.memberType, e.school, e.studentId,
      e.emergencyName, e.emergencyMobile, e.staffNotes, approved, e.memberSince, e.startsOn, e.expiresOn]
  );
  return { ok: true, data: rows[0] };
}

export async function membershipProof(id: string): Promise<string | null> {
  if (!isId(id)) return null;
  const { rows } = await db().query<{ payment_proof: string }>(`SELECT payment_proof FROM memberships WHERE id = $1`, [id]);
  return rows[0]?.payment_proof || null;
}

// ---- Staff: batch import of existing members ------------------------------------------------

export type ImportOutcome =
  | { row: number; result: "imported"; fullName: string; memberCode: string; token: string; email: string; mobile: string; expiresOn: string }
  | { row: number; result: "ready"; warning?: string } // dry run: would be imported (warning: same name only)
  | { row: number; result: "ask"; reason: string } // dry run: looks like a duplicate — staff decide
  | { row: number; result: "duplicate"; reason: string }
  | { row: number; result: "error"; reason: string };

export const MAX_IMPORT_ROWS = 3000;

/**
 * Imports existing members (e.g. from a Google Forms sheet) as approved, paid memberships with
 * new member codes.
 * - dryRun: checks every row and saves nothing. Rows that look like an existing member or an
 *   earlier row (2+ of name, contact number, birthday — see findDuplicates) come back as "ask".
 * - Otherwise: imports exactly the rows sent — the ones staff ticked or chose "Import anyway".
 */
export async function importMembers(input: unknown, dryRun: boolean): Promise<Result<{ outcomes: ImportOutcome[] }>> {
  if (!Array.isArray(input) || input.length === 0) return fail(400, "No members to import.");
  if (input.length > MAX_IMPORT_ROWS) return fail(400, `Import up to ${MAX_IMPORT_ROWS} members at a time.`);

  const outcomes: ImportOutcome[] = [];
  const valid: ImportRecord[] = [];
  for (const r of input as ImportRecord[]) {
    const problem = r && typeof r === "object" ? checkImportRecord(r) : "Invalid row";
    if (problem) outcomes.push({ row: Number(r?.row) || 0, result: "error", reason: problem });
    else valid.push(r);
  }

  const existing = await db().query<{ name: string; mobile: string; birthdate: string | null; member_code: string | null }>(
    `SELECT full_name AS name, mobile, birthdate, member_code FROM memberships WHERE status <> 'rejected'`
  );
  const codes = new Set(existing.rows.map((r) => r.member_code).filter(Boolean) as string[]);
  const dupes = dryRun ? findDuplicates(valid, existing.rows) : [];

  const settings = await getSettings();
  const today = nowAtFacility().date;
  const toInsert: { r: ImportRecord; code: string; token: string }[] = [];

  for (const [i, r] of valid.entries()) {
    const row = r.row;
    if (dryRun) {
      const d = dupes[i];
      outcomes.push(
        d && "ask" in d ? { row, result: "ask", reason: d.ask }
          : d && "warn" in d ? { row, result: "ready", warning: d.warn }
          : { row, result: "ready" }
      );
      continue;
    }
    let code = "";
    do code = formatMemberCode(Array.from({ length: 8 }, () => randomInt(MEMBER_CODE_ALPHABET_SIZE)));
    while (codes.has(code));
    codes.add(code);
    toInsert.push({ r, code, token: randomBytes(18).toString("base64url") });
  }

  if (!dryRun && toInsert.length) {
    const client = await db().connect();
    try {
      await client.query("BEGIN");
      for (const { r, code, token } of toInsert) {
        const note = [`Imported ${today}.`, r.notes].filter(Boolean).join(" ");
        await client.query(
          `INSERT INTO memberships (token, member_code, status, member_type, full_name, email, mobile, address, birthdate,
                                    gender, school, student_id, emergency_name, emergency_mobile, fee,
                                    payment_method, payment_status, member_since, starts_on, expires_on,
                                    staff_notes, approved_at)
           VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                   'cash', 'paid', $15, $15, $16, $17, now())`,
          [token, code, r.memberType, r.fullName.trim(), r.email.toLowerCase(), r.mobile, r.address, r.birthdate,
            r.gender, r.school, r.studentId, r.emergencyName, r.emergencyMobile,
            r.memberType === "student" ? settings.membership_fee_student : settings.membership_fee_adult,
            r.startsOn, r.expiresOn, note]
        );
        outcomes.push({
          row: r.row, result: "imported", fullName: r.fullName.trim(), memberCode: code, token,
          email: r.email.toLowerCase(), mobile: r.mobile, expiresOn: r.expiresOn,
        });
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  outcomes.sort((a, b) => a.row - b.row);
  return { ok: true, data: { outcomes } };
}

// ---- Staff: reminder emails to expired members ---------------------------------------------

export const EMAIL_BATCH = 10; // per request, so a batch finishes well within the server time limit

export type EmailOutcome = { id: string; name: string; ok: boolean; error?: string };

function reminderVars(m: Membership, origin: string): ReminderVars {
  return {
    first_name: m.full_name.split(" ")[0],
    name: m.full_name,
    expired_on: m.expires_on ? niceLongDate(m.expires_on) : "",
    fee: formatPeso(m.fee),
    member_code: m.member_code ?? "",
    member_page: `${origin}/membership/${m.token}`,
  };
}

const cleanTemplate = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Emails the "your membership expired — please renew" reminder, one email per member, to up to
 * EMAIL_BATCH expired members. Records the date on each one sent.
 */
export async function sendReminderEmails(
  ids: unknown,
  subject: unknown,
  body: unknown,
  origin: string
): Promise<Result<{ outcomes: EmailOutcome[] }>> {
  if (!emailSender()) return fail(400, "Email isn't set up yet. Add GMAIL_USER and GMAIL_APP_PASSWORD, then restart the app.");
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && isId(x)) : [];
  if (list.length === 0) return fail(400, "Choose who to email.");
  if (list.length > EMAIL_BATCH) return fail(400, `Send up to ${EMAIL_BATCH} at a time.`);
  const subj = cleanTemplate(subject, 200).trim();
  const text = cleanTemplate(body, 5000).trim();
  if (!subj || !text) return fail(400, "Write a subject and a message.");

  const { rows } = await db().query<Membership>(`SELECT ${COLUMNS} FROM memberships WHERE id = ANY($1::uuid[])`, [list]);
  const today = nowAtFacility().date;
  const outcomes: EmailOutcome[] = [];
  for (const m of rows) {
    if (membershipState(m, today) !== "expired") {
      outcomes.push({ id: m.id, name: m.full_name, ok: false, error: "Not expired any more" });
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m.email)) {
      outcomes.push({ id: m.id, name: m.full_name, ok: false, error: "No email address" });
      continue;
    }
    const vars = reminderVars(m, origin);
    try {
      await sendEmail(m.email, fillTemplate(subj, vars), fillTemplate(text, vars));
      // A reminder email counts as reminding them.
      await db().query(`UPDATE memberships SET emailed_on = $2, reminded_on = $2 WHERE id = $1`, [m.id, today]);
      outcomes.push({ id: m.id, name: m.full_name, ok: true });
    } catch (e) {
      const error = e instanceof Error ? e.message : "Sending failed";
      outcomes.push({ id: m.id, name: m.full_name, ok: false, error });
      // A login or limit problem affects everyone else too: stop here.
      if (/refused the login|sending limit/.test(error)) break;
    }
  }
  return { ok: true, data: { outcomes } };
}

/** Sends one filled-in reminder (using `id`'s details) to the club's own address, to check it. */
export async function sendTestReminder(id: unknown, subject: unknown, body: unknown, origin: string): Promise<Result<{ to: string }>> {
  const from = emailSender();
  if (!from) return fail(400, "Email isn't set up yet. Add GMAIL_USER and GMAIL_APP_PASSWORD, then restart the app.");
  if (typeof id !== "string" || !isId(id)) return fail(400, "Choose a member to preview.");
  const { rows } = await db().query<Membership>(`SELECT ${COLUMNS} FROM memberships WHERE id = $1`, [id]);
  if (!rows[0]) return fail(404, "Membership not found.");
  const vars = reminderVars(rows[0], origin);
  try {
    await sendEmail(from.address, `[Test] ${fillTemplate(cleanTemplate(subject, 200), vars)}`, fillTemplate(cleanTemplate(body, 5000), vars));
  } catch (e) {
    return fail(502, e instanceof Error ? e.message : "Sending failed");
  }
  return { ok: true, data: { to: from.address } };
}
