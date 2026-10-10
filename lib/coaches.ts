import { randomBytes, randomInt } from "node:crypto";
import webpush from "web-push";
import { db, getSettings } from "./db";
import { availableAt, availabilityText, newCoachCode, normalizeCoachCode, validateCoachForm, type AvailabilitySlot, type CoachStatus } from "./coach";
import { later, siteOrigin } from "./customer-notify";
import { formatDateLong, formatRange, publicName } from "./format";
import { emailSender, sendEmail } from "./mailer";
import { notifyStaff, setupVapid } from "./notify";
import { hashPassword, verifyPassword } from "./password";
import { allActivities, sportLabel } from "./sports";
import { nowAtFacility } from "./time";

// Coaches: sign-up (shared link, approved by the owner or a manager), login, profile, their own
// coach code, coaching requests from customers, and reminders. Server only.

type Fail = { ok: false; status: number; error: string };
type Ok<T> = { ok: true; data: T };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const MAX_PHOTO = 700_000; // characters of a data: URL (~500 KB image; the pages shrink photos well below this)
const isPhoto = (v: unknown): v is string =>
  typeof v === "string" && v.length <= MAX_PHOTO && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v);

/** The name customers and bookings show: the nickname (e.g. "Coach Marvin"), or the legal name. */
export const COACH_NAME = (t = "") => `COALESCE(NULLIF(${t ? t + "." : ""}nickname, ''), ${t ? t + "." : ""}full_name)`;

export type CoachRow = {
  id: string; full_name: string; nickname: string; gender: string; gender_self: string; birthday: string | null;
  credentials: string; bio: string; email: string; mobile: string; phpa_id: string; has_phpa_photo: boolean;
  has_photo: boolean; photo_v: number; sports: string[]; rates: string; availability: AvailabilitySlot[]; status: CoachStatus;
  coach_code: string | null; remind_bookings: boolean; staff_notes: string; created_at: string;
  approved_at: string | null; approved_by: string | null; status_by: string | null; last_login_at: string | null;
};
const COLUMNS = `id, full_name, nickname, gender, gender_self, birthday, credentials, bio, email, mobile, phpa_id, (phpa_photo <> '') AS has_phpa_photo, (photo <> '') AS has_photo, length(photo) AS photo_v,
  sports, rates, availability, status, coach_code, remind_bookings, staff_notes, created_at, approved_at, approved_by,
  status_by, last_login_at`;

/** The coach's photo / ID photo as an image URL for pages (served by /api/coaches/photo). */
export const photoUrl = (id: string, kind: "photo" | "id" = "photo") => `/api/coaches/photo?id=${id}${kind === "id" ? "&kind=id" : ""}`;

// ---- Sign-up and login ---------------------------------------------------------------------

export async function signupKeyValid(key: unknown): Promise<boolean> {
  const s = await getSettings();
  return typeof key === "string" && key.length > 0 && key === s.coach_signup_key;
}

/** A coach applies with the shared link. They can log in straight away but wait for approval. */
export async function registerCoach(input: Record<string, unknown>): Promise<Ok<{ id: string; version: number }> | Fail> {
  if (!(await signupKeyValid(input.key))) return fail(403, "This sign-up link isn't valid any more. Please ask NVBC for the current link.");
  const form = validateCoachForm(input, allActivities().map((a) => a.id));
  if (typeof form === "string") return fail(400, form);
  const password = typeof input.password === "string" ? input.password : "";
  if (password.length < 8 || password.length > 200) return fail(400, "Choose a password of at least 8 characters.");
  const photo = input.photo ? input.photo : ""; // optional: can be added later on the dashboard
  if (photo !== "" && !isPhoto(photo)) return fail(400, "The profile photo must be a PNG, JPG or WebP image.");
  const phpaPhoto = input.phpaPhoto ? input.phpaPhoto : "";
  if (phpaPhoto !== "" && !isPhoto(phpaPhoto)) return fail(400, "The ID photo must be a PNG, JPG or WebP image.");
  try {
    const { rows } = await db().query<{ id: string }>(
      `INSERT INTO coaches (full_name, email, mobile, phpa_id, phpa_photo, photo, sports, rates, availability, password_hash,
                            nickname, gender, gender_self, birthday, credentials, bio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [form.fullName, form.email, form.mobile, form.phpaId, phpaPhoto, photo, form.sports, form.rates,
        JSON.stringify(form.availability), hashPassword(password),
        form.nickname, form.gender, form.genderSelf, form.birthday, form.credentials, form.bio]
    );
    await notifyStaff([{
      kind: "coach_applied",
      title: `New coach application — ${form.nickname} (${form.fullName})`,
      pushTitle: `New coach application — ${form.nickname}`,
      body: `${form.sports.map(sportLabel).join(", ")} · ${form.mobile} · review it in the Coaches tab`,
    }]);
    return { ok: true, data: { id: rows[0].id, version: 0 } };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return fail(409, "There's already a coach account with that email — please log in instead.");
    throw e;
  }
}

export async function coachLogin(email: unknown, password: unknown): Promise<{ id: string; version: number } | null> {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  const { rows } = await db().query<{ id: string; password_hash: string; token_version: number; status: string }>(
    `SELECT id, password_hash, token_version, status FROM coaches WHERE lower(email) = $1`,
    [e]
  );
  const c = rows[0];
  // Compare even when there's no such coach, so a wrong email takes as long as a wrong password.
  const ok = verifyPassword(typeof password === "string" ? password : "", c?.password_hash ?? hashPassword(randomBytes(9).toString("hex")));
  if (!c || !ok || c.status === "rejected") return null;
  await db().query(`UPDATE coaches SET last_login_at = now() WHERE id = $1`, [c.id]);
  return { id: c.id, version: c.token_version };
}

// ---- The coach's own profile ----------------------------------------------------------------

export async function coachById(id: string): Promise<CoachRow | null> {
  if (!isId(id)) return null;
  const { rows } = await db().query<CoachRow>(`SELECT ${COLUMNS} FROM coaches WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** The coach edits their profile. Photos are only replaced when a new one is sent ("" removes the ID photo). */
export async function updateCoachProfile(id: string, input: Record<string, unknown>): Promise<Ok<CoachRow> | Fail> {
  const form = validateCoachForm(input, allActivities().map((a) => a.id));
  if (typeof form === "string") return fail(400, form);
  if (input.photo !== undefined && input.photo !== "" && !isPhoto(input.photo)) return fail(400, "The profile photo must be a PNG, JPG or WebP image.");
  if (input.phpaPhoto !== undefined && input.phpaPhoto !== "" && !isPhoto(input.phpaPhoto)) return fail(400, "The ID photo must be a PNG, JPG or WebP image.");
  try {
    const { rows } = await db().query<CoachRow>(
      `UPDATE coaches SET full_name = $2, email = $3, mobile = $4, phpa_id = $5, sports = $6, rates = $7, availability = $8::jsonb,
              photo = COALESCE($9, photo), phpa_photo = COALESCE($10, phpa_photo),
              remind_bookings = COALESCE($11, remind_bookings),
              nickname = $12, gender = $13, gender_self = $14, birthday = $15, credentials = $16, bio = $17
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, form.fullName, form.email, form.mobile, form.phpaId, form.sports, form.rates, JSON.stringify(form.availability),
        input.photo === undefined ? null : input.photo, input.phpaPhoto === undefined ? null : input.phpaPhoto,
        typeof input.remindBookings === "boolean" ? input.remindBookings : null,
        form.nickname, form.gender, form.genderSelf, form.birthday, form.credentials, form.bio]
    );
    if (!rows[0]) return fail(404, "Coach not found.");
    return { ok: true, data: rows[0] };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return fail(409, "Another coach account uses that email.");
    throw e;
  }
}

/** Changing the password logs out the coach's other devices. */
export async function changeCoachPassword(id: string, current: unknown, next: unknown): Promise<Ok<{ version: number }> | Fail> {
  if (typeof next !== "string" || next.length < 8 || next.length > 200) return fail(400, "Choose a new password of at least 8 characters.");
  const { rows } = await db().query<{ password_hash: string }>(`SELECT password_hash FROM coaches WHERE id = $1`, [id]);
  if (!rows[0]) return fail(404, "Coach not found.");
  if (!verifyPassword(typeof current === "string" ? current : "", rows[0].password_hash)) return fail(400, "Your current password isn't right.");
  const r = await db().query<{ token_version: number }>(
    `UPDATE coaches SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING token_version`,
    [id, hashPassword(next)]
  );
  return { ok: true, data: { version: r.rows[0].token_version } };
}

/** A one-time reset link (made by staff for a coach who forgot their password). */
export async function makeResetLink(coachId: string): Promise<Ok<{ url: string }> | Fail> {
  if (!isId(coachId)) return fail(400, "Invalid coach.");
  const token = randomBytes(24).toString("base64url");
  const { rowCount } = await db().query(
    `INSERT INTO coach_tokens (token, coach_id, purpose, expires_at) SELECT $1, id, 'reset', now() + interval '3 days' FROM coaches WHERE id = $2`,
    [token, coachId]
  );
  if (!rowCount) return fail(404, "Coach not found.");
  return { ok: true, data: { url: `${siteOrigin()}/coach/reset?token=${token}` } };
}

export async function resetPassword(token: unknown, password: unknown): Promise<Ok<{ id: string; version: number }> | Fail> {
  if (typeof password !== "string" || password.length < 8 || password.length > 200) return fail(400, "Choose a password of at least 8 characters.");
  const { rows } = await db().query<{ id: string; token_version: number }>(
    `WITH t AS (
       UPDATE coach_tokens SET used_at = now()
        WHERE token = $1 AND purpose = 'reset' AND used_at IS NULL AND expires_at > now() RETURNING coach_id
     )
     UPDATE coaches SET password_hash = $2, token_version = token_version + 1
      WHERE id = (SELECT coach_id FROM t) RETURNING id, token_version`,
    [typeof token === "string" ? token : "", hashPassword(password)]
  );
  if (!rows[0]) return fail(400, "This reset link has expired or was already used. Please ask NVBC for a new one.");
  return { ok: true, data: { id: rows[0].id, version: rows[0].token_version } };
}

// ---- Coach codes on bookings -----------------------------------------------------------------

export type CodeCoach = { id: string; name: string; mobile: string; email: string; sports: string[] }; // name: as shown on bookings

/**
 * A coach code typed on the booking form: the active coach it belongs to, or a message. Pending
 * and inactive coaches' codes don't work (no coach rate, no cash at the desk).
 */
export async function coachForCode(raw: unknown): Promise<CodeCoach | string | null> {
  const code = normalizeCoachCode(raw);
  if (!code) return null; // not a personal coach code (maybe the old shared code)
  const { rows } = await db().query<CodeCoach & { status: CoachStatus }>(
    `SELECT id, ${COACH_NAME()} AS name, mobile, email, sports, status FROM coaches WHERE coach_code = $1`,
    [code]
  );
  const c = rows[0];
  if (!c) return "That coach code isn't right. Check it, or book at the Regular rate.";
  if (c.status !== "active") return "That coach code isn't active right now. Please contact the front desk.";
  return { id: c.id, name: c.name, mobile: c.mobile, email: c.email, sports: c.sports };
}

export async function activeCoachCount(): Promise<number> {
  const { rows } = await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM coaches WHERE status = 'active'`);
  return rows[0].n;
}

// ---- Coaching sessions requested by customers ---------------------------------------------------

export type AvailableCoach = {
  id: string; name: string; photo: string | null; rates: string; availability: string; credentials: string; bio: string;
};

/**
 * Active coaches for `sport` who are available for the whole of [start, end) on `date` and aren't
 * already booked then (their own court bookings or accepted coaching sessions).
 */
export async function availableCoaches(sport: string, date: string, start: number, end: number, exceptBooking?: string): Promise<AvailableCoach[]> {
  const { rows } = await db().query<{ id: string; name: string; has_photo: boolean; rates: string; availability: AvailabilitySlot[]; credentials: string; bio: string }>(
    `SELECT c.id, ${COACH_NAME("c")} AS name, (c.photo <> '') AS has_photo, c.rates, c.availability, c.credentials, c.bio FROM coaches c
      WHERE c.status = 'active' AND $1 = ANY(c.sports)
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
           WHERE b.booking_date = $2 AND b.status <> 'cancelled' AND b.start_hour < $4 AND b.end_hour > $3
             AND ($5::uuid IS NULL OR COALESCE(b.group_id, b.id) <> $5::uuid)
             AND (b.coach_id = c.id OR (b.coaching_coach_id = c.id AND b.coaching_status IN ('requested', 'accepted'))))
      ORDER BY name`,
    [sport, date, start, end, exceptBooking ?? null]
  );
  return rows
    .filter((c) => availableAt(c.availability, date, start, end))
    .map((c) => ({
      id: c.id, name: c.name, photo: c.has_photo ? photoUrl(c.id) : null, rates: c.rates,
      availability: availabilityText(c.availability), credentials: c.credentials, bio: c.bio,
    }));
}

/** Emails / pushes a coach. Never throws. */
async function tellCoach(coachId: string, push: { title: string; body: string; url: string }, email?: { subject: string; text: string }) {
  try {
    const { rows } = await db().query<{ email: string }>(`SELECT email FROM coaches WHERE id = $1`, [coachId]);
    if (!rows[0]) return;
    const subs = await db().query<{ endpoint: string; p256dh: string; auth: string }>(
      `SELECT endpoint, p256dh, auth FROM coach_push_subscriptions WHERE coach_id = $1`,
      [coachId]
    );
    if (subs.rows.length && setupVapid()) {
      for (const s of subs.rows) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ ...push, tag: `nvbc-coach-${push.url}` }), { TTL: 6 * 3600 });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await db().query(`DELETE FROM coach_push_subscriptions WHERE endpoint = $1`, [s.endpoint]);
        }
      }
    }
    if (email && emailSender()) await sendEmail(rows[0].email, email.subject, email.text);
  } catch (e) {
    console.error("coach notification failed", e instanceof Error ? e.message : e);
  }
}

type BookingInfo = { code: string; name: string; contact: string; court: string; sport: string; date: string; start: number; end: number };
const when = (b: BookingInfo) => `${formatDateLong(b.date)}, ${formatRange(b.start, b.end)}`;

/** A customer asked for a coaching session with this coach (after the response is sent). */
export function notifyCoachingRequest(coachId: string, b: BookingInfo) {
  later(() =>
    tellCoach(
      coachId,
      { title: "New coaching request", body: `${publicName(b.name)} · ${sportLabel(b.sport)} · ${when(b)}`, url: "/coach" },
      {
        subject: `Coaching request: ${sportLabel(b.sport)}, ${formatDateLong(b.date)}`,
        text:
          `Hi!\n\n${b.name} booked ${b.court} for ${when(b)} and asked for a coaching session with you.\n\n` +
          `Contact: ${b.contact}\nBooking code: ${b.code}\n\nPlease accept or decline on your Coaches Dashboard:\n${siteOrigin()}/coach\n\n` +
          `The customer pays your coaching fee directly to you.\n\nNV Badminton Center`,
      }
    )
  );
}

/** A booking was made with the coach's own code — so they'd spot a code that's being misused. */
export function notifyCoachCodeUsed(coachId: string, b: BookingInfo) {
  later(() =>
    tellCoach(
      coachId,
      { title: "Booking with your coach code", body: `${b.court} · ${when(b)}`, url: "/coach" },
      {
        subject: `Booking made with your coach code — ${formatDateLong(b.date)}`,
        text:
          `Hi!\n\nA booking was just made with your coach code:\n\n${b.court}, ${when(b)}\nBooking code: ${b.code}\n\n` +
          `It's on your Coaches Dashboard: ${siteOrigin()}/coach\n\nIf you didn't make it, please tell NVBC — someone may be using your code. ` +
          `NVBC can give you a new one.\n\nNV Badminton Center`,
      }
    )
  );
}

/** Bookings with a coaching request were cancelled or released: tell their coaches. */
export async function coachingCancelled(bookingIds: string[]) {
  if (!bookingIds.length) return;
  const { rows } = await db().query<{ coaching_coach_id: string; cancel_code: string; player_name: string; booking_date: string; start_hour: number; end_hour: number }>(
    `UPDATE bookings SET coaching_status = 'cancelled'
      WHERE id = ANY($1::uuid[]) AND coaching_status IN ('requested', 'accepted')
      RETURNING coaching_coach_id, cancel_code, player_name, booking_date, start_hour::float8, end_hour::float8`,
    [bookingIds]
  );
  for (const r of rows)
    later(() =>
      tellCoach(
        r.coaching_coach_id,
        { title: "Coaching session cancelled", body: `${publicName(r.player_name)} · ${formatDateLong(r.booking_date)}`, url: "/coach" },
        {
          subject: `Coaching session cancelled — ${formatDateLong(r.booking_date)}`,
          text: `Hi!\n\nThe booking ${r.cancel_code} (${r.player_name}, ${formatDateLong(r.booking_date)}, ${formatRange(r.start_hour, r.end_hour)}) was cancelled, so its coaching session is off.\n\nNV Badminton Center`,
        }
      )
    );
}

export type CoachBooking = {
  id: string; code: string; date: string; start_hour: number; end_hour: number; court_name: string; sport: string;
  status: string; payment_status: string; amount: number; kind: "own" | "coaching";
  customer_name: string | null; customer_contact: string | null; coaching_status: string | null; coaching_note: string;
  remind: boolean; misuse: boolean; group_courts: number;
};

/** A coach's bookings: made with their code, and coaching sessions requested with them. */
export async function coachBookings(coachId: string): Promise<CoachBooking[]> {
  const { rows } = await db().query<CoachBooking>(
    `SELECT b.id, b.cancel_code AS code, b.booking_date AS date, b.start_hour::float8 AS start_hour, b.end_hour::float8 AS end_hour,
            c.name AS court_name, COALESCE(b.activity, c.sport) AS sport, b.status, b.payment_status, b.amount::float8 AS amount,
            CASE WHEN b.coach_id = $1 THEN 'own' ELSE 'coaching' END AS kind,
            CASE WHEN b.coaching_coach_id = $1 THEN b.player_name END AS customer_name,
            CASE WHEN b.coaching_coach_id = $1 AND b.coaching_status IN ('requested', 'accepted') THEN b.contact END AS customer_contact,
            b.coaching_status, b.coaching_note,
            COALESCE(b.coach_remind, co.remind_bookings) AS remind, b.coach_code_misuse AS misuse,
            (SELECT count(*)::int FROM bookings g WHERE g.group_id = b.id AND g.status <> 'cancelled') AS group_courts
       FROM bookings b JOIN courts c ON c.id = b.court_id JOIN coaches co ON co.id = $1
      WHERE (b.coach_id = $1 AND b.group_id IS NULL) OR b.coaching_coach_id = $1
      ORDER BY b.booking_date DESC, b.start_hour DESC
      LIMIT 300`,
    [coachId]
  );
  return rows;
}

/** The coach accepts or declines a coaching request. The customer is told. */
export async function respondCoaching(coachId: string, bookingId: unknown, accept: unknown, note: unknown): Promise<Ok<{ id: string }> | Fail> {
  if (!isId(bookingId)) return fail(400, "Invalid booking.");
  const msg = typeof note === "string" ? note.trim().slice(0, 300) : "";
  if (accept === true) {
    // Not if they've taken another session (or booked a court) at that time since.
    const { rows } = await db().query<{ booking_date: string; start_hour: number; end_hour: number }>(
      `SELECT booking_date, start_hour::float8, end_hour::float8 FROM bookings WHERE id = $1 AND coaching_coach_id = $2`,
      [bookingId, coachId]
    );
    if (rows[0]) {
      const clash = await db().query(
        `SELECT 1 FROM bookings WHERE id <> $1 AND booking_date = $2 AND status <> 'cancelled' AND start_hour < $4 AND end_hour > $3
            AND (coach_id = $5 OR (coaching_coach_id = $5 AND coaching_status = 'accepted')) LIMIT 1`,
        [bookingId, rows[0].booking_date, rows[0].start_hour, rows[0].end_hour, coachId]
      );
      if (clash.rows.length) return fail(409, "You already have a booking or session at that time.");
    }
  }
  const { rows } = await db().query<{ id: string }>(
    `UPDATE bookings SET coaching_status = $3, coaching_note = $4, coaching_responded_at = now()
      WHERE id = $1 AND coaching_coach_id = $2 AND coaching_status = 'requested' AND status <> 'cancelled' RETURNING id`,
    [bookingId, coachId, accept === true ? "accepted" : "declined", msg]
  );
  if (!rows[0]) return fail(400, "This request was already answered or cancelled.");
  const { notifyCustomerCoaching } = await import("./customer-notify");
  notifyCustomerCoaching(rows[0].id, accept === true ? "coaching_accepted" : "coaching_declined");
  return { ok: true, data: { id: rows[0].id } };
}

/** Per booking: remind the coach 1 hour before (or not). */
export async function setCoachRemind(coachId: string, bookingId: unknown, on: unknown): Promise<Ok<{ id: string }> | Fail> {
  if (!isId(bookingId)) return fail(400, "Invalid booking.");
  const { rowCount } = await db().query(
    `UPDATE bookings SET coach_remind = $3 WHERE id = $1 AND (coach_id = $2 OR coaching_coach_id = $2)`,
    [bookingId, coachId, on === true]
  );
  return rowCount ? { ok: true, data: { id: bookingId } } : fail(404, "Booking not found.");
}

/**
 * Coaches' "coming up" reminders, 1 hour before their own bookings and accepted sessions (unless
 * turned off). Each booking is claimed with an UPDATE so it's sent once.
 */
export async function sendCoachReminders(): Promise<number> {
  const start = `((b.booking_date + make_interval(mins => (b.start_hour * 60)::int)) AT TIME ZONE 'Asia/Manila')`;
  const { rows } = await db().query<{ coach: string; code: string; court: string; date: string; start_hour: number; end_hour: number; kind: string; player: string }>(
    `UPDATE bookings b SET coach_reminded_at = now()
       FROM coaches co, courts c
      WHERE c.id = b.court_id AND b.status <> 'cancelled' AND b.coach_reminded_at IS NULL AND b.group_id IS NULL
        AND (b.coach_id = co.id OR (b.coaching_coach_id = co.id AND b.coaching_status = 'accepted'))
        AND COALESCE(b.coach_remind, co.remind_bookings)
        AND b.booking_date BETWEEN (now() AT TIME ZONE 'Asia/Manila')::date - 1 AND (now() AT TIME ZONE 'Asia/Manila')::date + 1
        AND ${start} > now() AND ${start} <= now() + interval '60 minutes'
      RETURNING co.id AS coach, b.cancel_code AS code, c.name AS court, b.booking_date AS date, b.start_hour::float8 AS start_hour,
                b.end_hour::float8 AS end_hour, CASE WHEN b.coach_id = co.id THEN 'own' ELSE 'coaching' END AS kind, b.player_name AS player`
  );
  for (const r of rows) {
    const what = r.kind === "own" ? r.court : `Coaching ${r.player} · ${r.court}`;
    await tellCoach(
      r.coach,
      { title: "Coming up in 1 hour", body: `${what} · ${formatRange(r.start_hour, r.end_hour)}`, url: "/coach" },
      { subject: `Reminder: ${what} at ${formatRange(r.start_hour, r.end_hour).split(" – ")[0]} today`, text: `Hi!\n\nJust a reminder: ${what}, ${formatDateLong(r.date)}, ${formatRange(r.start_hour, r.end_hour)} (booking ${r.code}).\n\nNV Badminton Center` }
    );
  }
  return rows.length;
}

// ---- Coaches' devices (push) ----------------------------------------------------------------

export async function saveCoachPush(coachId: string, sub: unknown): Promise<string | null> {
  const s = (sub ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof s.endpoint === "string" ? s.endpoint : "";
  const p256dh = typeof s.keys?.p256dh === "string" ? s.keys.p256dh : "";
  const auth = typeof s.keys?.auth === "string" ? s.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return "This device couldn't be registered.";
  await db().query(
    `INSERT INTO coach_push_subscriptions (coach_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
     ON CONFLICT (coach_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [coachId, endpoint, p256dh, auth]
  );
  return null;
}

export async function removeCoachPush(coachId: string, endpoint: unknown) {
  if (typeof endpoint === "string") await db().query(`DELETE FROM coach_push_subscriptions WHERE coach_id = $1 AND endpoint = $2`, [coachId, endpoint]);
}

export async function coachPushOn(coachId: string, endpoint: unknown): Promise<boolean> {
  if (typeof endpoint !== "string" || !endpoint) return false;
  const { rowCount } = await db().query(`SELECT 1 FROM coach_push_subscriptions WHERE coach_id = $1 AND endpoint = $2`, [coachId, endpoint]);
  return (rowCount ?? 0) > 0;
}

// ---- Staff (owner / managers) ------------------------------------------------------------------

export type AdminCoach = CoachRow & { upcoming: number; past: number; sessions: number; misuse: number; requests: number };

export async function listCoaches(): Promise<AdminCoach[]> {
  const today = nowAtFacility().date;
  const { rows } = await db().query<AdminCoach>(
    `SELECT ${COLUMNS},
            (SELECT count(*)::int FROM bookings b WHERE b.coach_id = co.id AND b.group_id IS NULL AND b.status <> 'cancelled' AND b.booking_date >= $1) AS upcoming,
            (SELECT count(*)::int FROM bookings b WHERE b.coach_id = co.id AND b.group_id IS NULL AND b.status <> 'cancelled' AND b.booking_date < $1) AS past,
            (SELECT count(*)::int FROM bookings b WHERE b.coaching_coach_id = co.id AND b.coaching_status = 'accepted') AS sessions,
            (SELECT count(*)::int FROM bookings b WHERE b.coaching_coach_id = co.id AND b.coaching_status = 'requested') AS requests,
            (SELECT count(*)::int FROM bookings b WHERE b.coach_id = co.id AND b.coach_code_misuse) AS misuse
       FROM coaches co
      ORDER BY CASE co.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 WHEN 'inactive' THEN 2 ELSE 3 END, co.full_name`,
    [today]
  );
  return rows;
}

async function uniqueCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = newCoachCode(randomInt);
    const { rowCount } = await db().query(`SELECT 1 FROM coaches WHERE coach_code = $1`, [code]);
    if (!rowCount) return code;
  }
  throw new Error("Could not make a unique coach code");
}

/**
 * Owner/managers: approve (gives a coach code), set active / inactive, reject, or give a new code
 * (the old one stops working — e.g. it was shared with customers).
 */
export async function setCoachStatus(id: unknown, action: unknown, by: string): Promise<Ok<CoachRow> | Fail> {
  if (!isId(id)) return fail(400, "Invalid coach.");
  const c = await coachById(id);
  if (!c) return fail(404, "Coach not found.");
  let status: CoachStatus = c.status;
  let code = c.coach_code;
  if (action === "approve" || action === "activate") {
    status = "active";
    code = code ?? (await uniqueCode());
  } else if (action === "deactivate") status = "inactive";
  else if (action === "reject") status = "rejected";
  else if (action === "new-code") code = await uniqueCode();
  else return fail(400, "Unknown action.");
  const { rows } = await db().query<CoachRow>(
    `UPDATE coaches SET status = $2, coach_code = $3, status_by = $4,
            approved_at = CASE WHEN $2 = 'active' AND approved_at IS NULL THEN now() ELSE approved_at END,
            approved_by = CASE WHEN $2 = 'active' AND approved_at IS NULL THEN $4 ELSE approved_by END,
            token_version = token_version + CASE WHEN $2 = 'rejected' THEN 1 ELSE 0 END
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, status, code, by.slice(0, 60)]
  );
  const updated = rows[0];
  if (action === "approve" && c.status === "pending")
    later(() =>
      tellCoach(id, { title: "You're approved as an NVBC coach", body: `Your coach code is ${code}`, url: "/coach" }, {
        subject: "Welcome to NVBC — your coach account is approved",
        text:
          `Hi ${c.nickname || c.full_name.split(" ")[0]}!\n\nYour NVBC coach account is approved. Your personal coach code is:\n\n${code}\n\n` +
          `Use it on the booking page (choose the Coach rate) — it fills in your details and allows paying cash at the desk. ` +
          `Please keep it to yourself: bookings made with it show up on your dashboard.\n\nYour Coaches Dashboard: ${siteOrigin()}/coach\n\nNV Badminton Center`,
      })
    );
  if (action === "new-code")
    later(() =>
      tellCoach(id, { title: "Your coach code changed", body: `New code: ${code}`, url: "/coach" }, {
        subject: "Your NVBC coach code has changed",
        text: `Hi!\n\nNVBC gave you a new coach code: ${code}\nYour old code no longer works.\n\nNV Badminton Center`,
      })
    );
  return { ok: true, data: updated };
}

export async function setCoachNotes(id: unknown, notes: unknown): Promise<Ok<{ id: string }> | Fail> {
  if (!isId(id)) return fail(400, "Invalid coach.");
  await db().query(`UPDATE coaches SET staff_notes = $2 WHERE id = $1`, [id, typeof notes === "string" ? notes.slice(0, 1000) : ""]);
  return { ok: true, data: { id } };
}

export async function newSignupKey(): Promise<string> {
  const key = randomBytes(12).toString("hex");
  await db().query(`UPDATE settings SET coach_signup_key = $1`, [key]);
  return key;
}

/** A coach's photo or ID photo (data URL). The profile photo is public for active coaches; the ID photo is staff-only. */
export async function coachPhoto(id: string, kind: "photo" | "id", staff: boolean, self: boolean): Promise<string | null> {
  if (!isId(id)) return null;
  const { rows } = await db().query<{ photo: string; phpa_photo: string; status: string }>(
    `SELECT photo, phpa_photo, status FROM coaches WHERE id = $1`,
    [id]
  );
  const c = rows[0];
  if (!c) return null;
  if (kind === "id") return staff || self ? c.phpa_photo || null : null;
  return staff || self || c.status === "active" ? c.photo || null : null;
}

/**
 * A customer asks for a coaching session on a booking they already made (or another coach after
 * one declined). Not for bookings made with a coach code, cancelled ones, or once a coach accepted.
 */
export async function requestCoachingForBooking(code: string, coachId: unknown): Promise<Ok<{ coach: string }> | Fail> {
  if (!isId(coachId)) return fail(400, "Choose a coach.");
  const { rows } = await db().query<{ id: string; player_name: string; contact: string; status: string; coach_id: string | null;
    coaching_status: string | null; booking_date: string; start_hour: number; end_hour: number; activity: string; court: string }>(
    `SELECT b.id, b.player_name, b.contact, b.status, b.coach_id, b.coaching_status, b.booking_date,
            b.start_hour::float8 AS start_hour, b.end_hour::float8 AS end_hour, COALESCE(b.activity, c.sport) AS activity,
            (SELECT string_agg(gc.name, ' + ' ORDER BY gc.sort_order) FROM bookings g JOIN courts gc ON gc.id = g.court_id
              WHERE (g.id = b.id OR g.group_id = b.id) AND g.status <> 'cancelled') AS court
       FROM bookings b JOIN courts c ON c.id = b.court_id WHERE b.cancel_code = $1`,
    [code]
  );
  const b = rows[0];
  if (!b) return fail(404, "No booking found with that code.");
  if (b.status === "cancelled") return fail(400, "This booking is cancelled.");
  if (b.coach_id) return fail(400, "This booking was made with a coach code.");
  if (b.coaching_status === "requested" || b.coaching_status === "accepted") return fail(400, "A coach has already been asked for this booking.");
  const free = await availableCoaches(b.activity, b.booking_date, b.start_hour, b.end_hour, b.id);
  const pick = free.find((c) => c.id === coachId);
  if (!pick) return fail(409, "That coach isn't available at this time any more. Please choose another.");
  await db().query(
    `UPDATE bookings SET coaching_coach_id = $2, coaching_status = 'requested', coaching_note = '', coaching_responded_at = NULL WHERE id = $1`,
    [b.id, coachId]
  );
  notifyCoachingRequest(coachId, { code, name: b.player_name, contact: b.contact, court: b.court, sport: b.activity, date: b.booking_date, start: b.start_hour, end: b.end_hour });
  return { ok: true, data: { coach: pick.name } };
}
