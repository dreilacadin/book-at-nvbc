import { randomBytes } from "node:crypto";
import { db } from "./db";
import { notifyStaff } from "./notify";
import { hashPassword, verifyPassword } from "./password";
import {
  fullName,
  INVITE_DAYS,
  isSignupRole,
  isStaffRole,
  MIN_PASSWORD,
  normalizeUsername,
  roleName,
  USERNAME,
  validateProfile,
  validateSignup,
  type StaffRole,
} from "./staff";
import { nowAtFacility } from "./time";

// Staff accounts for /admin. Passwords are stored as salted scrypt hashes, never as text.

export { normalizeUsername };

export type AdminUser = {
  id: number;
  username: string;
  display_name: string;
  is_active: boolean;
  token_version: number;
  created_at: string;
  last_login_at: string | null;
  created_by: string;
  role: StaffRole;
  /** A Scholar who also strings rackets. */
  is_stringer: boolean;
  first_name: string;
  last_name: string;
  birthdate: string | null;
  mobile: string;
  email: string;
  /** Signed up with a registration link, waiting for approval (can't log in yet). */
  pending: boolean;
  invite_id: number | null;
  approved_by: string | null;
  approved_at: string | null;
};
export type AdminListUser = AdminUser & { invite_label: string | null };

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

const COLUMNS = `id, username, display_name, is_active, token_version, created_at, last_login_at, created_by, role, is_stringer,
  first_name, last_name, to_char(birthdate, 'YYYY-MM-DD') AS birthdate, mobile, email, pending, invite_id, approved_by, approved_at`;
const ROLE_ERROR = "Choose Manager, Staff, Scholar or Stringer.";

// A fixed hash to compare against when the username doesn't exist, so a wrong username takes
// as long as a wrong password (no hint about which usernames exist).
const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));

function checkNewPassword(v: unknown): string | null {
  return typeof v === "string" && v.length >= MIN_PASSWORD && v.length <= 200 ? v : null;
}
const today = () => nowAtFacility().date;
const taken = (username: string) => fail(409, `The username “${username}” is taken. Choose another one.`);
const isUniqueError = (e: unknown) => (e as { code?: string }).code === "23505";

export async function findActiveAdmin(id: number): Promise<AdminUser | null> {
  if (!Number.isInteger(id)) return null;
  const { rows } = await db().query<AdminUser>(`SELECT ${COLUMNS} FROM admin_users WHERE id = $1 AND is_active`, [id]);
  return rows[0] ?? null;
}

/**
 * Username + password login for a staff account. "pending": the password is right, but the account
 * (made with a registration link) hasn't been approved yet.
 */
export async function verifyLogin(usernameRaw: unknown, password: unknown): Promise<AdminUser | "pending" | null> {
  const username = normalizeUsername(usernameRaw);
  const pw = typeof password === "string" ? password : "";
  const { rows } = await db().query<AdminUser & { password_hash: string }>(
    `SELECT ${COLUMNS}, password_hash FROM admin_users WHERE username = $1`,
    [username]
  );
  const user = rows[0];
  const ok = verifyPassword(pw, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) return null;
  if (user.pending) return "pending";
  if (!user.is_active) return null;
  await db().query(`UPDATE admin_users SET last_login_at = now() WHERE id = $1`, [user.id]);
  return user;
}

export async function listAdmins(): Promise<AdminListUser[]> {
  const { rows } = await db().query<AdminListUser>(
    `SELECT ${COLUMNS}, (SELECT label FROM staff_invites i WHERE i.id = admin_users.invite_id) AS invite_label
       FROM admin_users ORDER BY pending DESC, is_active DESC, display_name`
  );
  return rows;
}

/** An account made by the owner or a manager: name, username, password and role; other details optional. */
export async function createAdmin(input: Record<string, unknown>, createdBy: string): Promise<Result<AdminUser>> {
  const p = validateProfile(input, today(), false);
  if (typeof p === "string") return fail(400, p);
  const username = normalizeUsername(input.username);
  const password = checkNewPassword(input.password);
  if (!USERNAME.test(username)) return fail(400, "Usernames are 3–30 letters, numbers, dots, dashes or underscores.");
  if (username === "owner") return fail(400, "“owner” is reserved. Choose another username.");
  if (!password) return fail(400, `Passwords need at least ${MIN_PASSWORD} characters.`);
  const role = input.role === undefined ? "staff" : input.role;
  if (!isStaffRole(role)) return fail(400, ROLE_ERROR);
  try {
    const { rows } = await db().query<AdminUser>(
      `INSERT INTO admin_users (username, display_name, password_hash, created_by, role, is_stringer, first_name, last_name, birthdate, mobile, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLUMNS}`,
      [username, fullName(p), hashPassword(password), createdBy, role, role === "scholar" && input.stringer === true,
        p.firstName, p.lastName, p.birthdate, p.mobile, p.email]
    );
    return { ok: true, data: rows[0] };
  } catch (e) {
    if (isUniqueError(e)) return taken(username);
    throw e;
  }
}

/**
 * Change an account's details, enable or disable it, or change its role (and, for a Scholar,
 * whether they string rackets). Disabling logs the person out everywhere.
 */
export async function updateAdmin(id: unknown, input: Record<string, unknown>, me: number | null): Promise<Result<AdminUser>> {
  const n = Number(id);
  if (!Number.isInteger(n)) return fail(400, "Invalid account.");
  let p = null;
  if (input.firstName !== undefined) {
    const v = validateProfile(input, today(), false);
    if (typeof v === "string") return fail(400, v);
    p = v;
  }
  const active = typeof input.active === "boolean" ? input.active : undefined;
  if (active === false && n === me) return fail(400, "You can't disable your own account.");
  const role = input.role === undefined ? undefined : input.role;
  if (role !== undefined && !isStaffRole(role)) return fail(400, ROLE_ERROR);
  const stringer = typeof input.stringer === "boolean" ? input.stringer : undefined;
  if ((role !== undefined || stringer !== undefined) && n === me) return fail(400, "You can't change your own role.");
  const { rows: found } = await db().query<{ pending: boolean }>(`SELECT pending FROM admin_users WHERE id = $1`, [n]);
  if (!found[0]) return fail(404, "Account not found.");
  if (found[0].pending && active !== undefined) return fail(400, "Approve or decline this sign-up first.");
  const { rows } = await db().query<AdminUser>(
      `UPDATE admin_users SET
              display_name = COALESCE($2, display_name),
              first_name = COALESCE($3, first_name), last_name = COALESCE($4, last_name),
              birthdate = CASE WHEN $2::text IS NULL THEN birthdate ELSE $5::date END,
              mobile = COALESCE($6, mobile), email = COALESCE($7, email),
              is_active = COALESCE($8, is_active),
              role = COALESCE($9, role),
              is_stringer = COALESCE($9, role) = 'scholar' AND COALESCE($10, is_stringer),
              token_version = token_version + CASE WHEN $8::boolean IS FALSE THEN 1 ELSE 0 END
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [n, p ? fullName(p) : null, p?.firstName ?? null, p?.lastName ?? null, p?.birthdate ?? null, p?.mobile ?? null, p?.email ?? null,
        active ?? null, role ?? null, stringer ?? null]
    );
  return { ok: true, data: rows[0] };
}

/** Let a sign-up in, as the role they chose or another one. */
export async function approveAdmin(id: unknown, input: Record<string, unknown>, by: string): Promise<Result<AdminUser>> {
  const n = Number(id);
  if (!Number.isInteger(n)) return fail(400, "Invalid account.");
  const role = input.role === undefined ? undefined : input.role;
  if (role !== undefined && !isStaffRole(role)) return fail(400, ROLE_ERROR);
  const stringer = typeof input.stringer === "boolean" ? input.stringer : undefined;
  const { rows } = await db().query<AdminUser>(
    `UPDATE admin_users SET pending = FALSE, is_active = TRUE, approved_by = $2, approved_at = now(),
            role = COALESCE($3, role),
            is_stringer = COALESCE($3, role) = 'scholar' AND COALESCE($4, is_stringer)
      WHERE id = $1 AND pending RETURNING ${COLUMNS}`,
    [n, by, role ?? null, stringer ?? null]
  );
  if (!rows[0]) return fail(404, "That sign-up was already approved or declined.");
  return { ok: true, data: rows[0] };
}

/** Turn a sign-up down: the account is removed (they can sign up again while the link works). */
export async function declineAdmin(id: unknown): Promise<Result<{ id: number }>> {
  const n = Number(id);
  if (!Number.isInteger(n)) return fail(400, "Invalid account.");
  const { rowCount } = await db().query(`DELETE FROM admin_users WHERE id = $1 AND pending`, [n]);
  if (!rowCount) return fail(404, "That sign-up was already approved or declined.");
  return { ok: true, data: { id: n } };
}

/** Set a new password. Logs that account out of its other sessions (the caller re-issues its own). */
export async function setAdminPassword(id: unknown, password: unknown): Promise<Result<AdminUser>> {
  const n = Number(id);
  const pw = checkNewPassword(password);
  if (!Number.isInteger(n)) return fail(400, "Invalid account.");
  if (!pw) return fail(400, `Passwords need at least ${MIN_PASSWORD} characters.`);
  const { rows } = await db().query<AdminUser>(
    `UPDATE admin_users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING ${COLUMNS}`,
    [n, hashPassword(pw)]
  );
  if (!rows[0]) return fail(404, "Account not found.");
  return { ok: true, data: rows[0] };
}

export async function deleteAdmin(id: unknown, me: number | null): Promise<Result<{ id: number }>> {
  const n = Number(id);
  if (!Number.isInteger(n)) return fail(400, "Invalid account.");
  if (n === me) return fail(400, "You can't delete your own account.");
  const { rowCount } = await db().query(`DELETE FROM admin_users WHERE id = $1`, [n]);
  if (!rowCount) return fail(404, "Account not found.");
  return { ok: true, data: { id: n } };
}

// ---- Registration links ----------------------------------------------------------------------

export type StaffInvite = {
  id: number;
  token: string;
  label: string;
  roles: string[];
  created_by: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  signups: number;
};
const INVITE_COLUMNS = `id, token, label, roles, created_by, created_at, expires_at, revoked_at, revoked_by,
  (SELECT count(*)::int FROM admin_users u WHERE u.invite_id = staff_invites.id) AS signups`;
const validToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{20,40}$/.test(t);

/** Newest first; links turned off or expired more than 60 days ago are left out. */
export async function listInvites(): Promise<StaffInvite[]> {
  const { rows } = await db().query<StaffInvite>(
    `SELECT ${INVITE_COLUMNS} FROM staff_invites
      WHERE COALESCE(LEAST(revoked_at, expires_at), now()) > now() - interval '60 days' -- LEAST skips NULLs
      ORDER BY created_at DESC LIMIT 50`
  );
  return rows;
}

/** { label?, days: 1 | 7 | 30 | null, roles: ["staff", "scholar", "stringer"] } */
export async function createInvite(input: Record<string, unknown>, by: string): Promise<Result<StaffInvite>> {
  const label = typeof input.label === "string" ? input.label.trim().replace(/\s+/g, " ").slice(0, 60) : "";
  const days = input.days === null ? null : Number(input.days);
  if (!(INVITE_DAYS as readonly (number | null)[]).includes(days)) return fail(400, "Choose how long the link works.");
  const roles = Array.isArray(input.roles) ? [...new Set(input.roles.filter(isSignupRole))] : [];
  if (!roles.length) return fail(400, "Choose who the link is for.");
  const { rows } = await db().query<StaffInvite>(
    `INSERT INTO staff_invites (token, label, roles, created_by, expires_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(days => $5::int) END)
     RETURNING ${INVITE_COLUMNS}`,
    [randomBytes(18).toString("base64url"), label, roles, by, days]
  );
  return { ok: true, data: rows[0] };
}

/** Turn a link off: it stops working at once. Accounts already made with it stay. */
export async function revokeInvite(id: unknown, by: string): Promise<Result<StaffInvite>> {
  const n = Number(id);
  if (!Number.isInteger(n)) return fail(400, "Invalid link.");
  const { rows } = await db().query<StaffInvite>(
    `UPDATE staff_invites SET revoked_at = COALESCE(revoked_at, now()), revoked_by = COALESCE(revoked_by, $2)
      WHERE id = $1 RETURNING ${INVITE_COLUMNS}`,
    [n, by]
  );
  if (!rows[0]) return fail(404, "Link not found.");
  return { ok: true, data: rows[0] };
}

/** A working link (not turned off or expired), or null. */
export async function activeInvite(token: unknown): Promise<{ id: number; roles: string[] } | null> {
  if (!validToken(token)) return null;
  const { rows } = await db().query<{ id: number; roles: string[] }>(
    `SELECT id, roles FROM staff_invites WHERE token = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [token]
  );
  return rows[0] ?? null;
}

/** Sign up with a registration link. The account waits for the owner or a manager to approve it. */
export async function signUpWithInvite(token: unknown, input: Record<string, unknown>): Promise<Result<{ name: string }>> {
  const invite = await activeInvite(token);
  if (!invite) return fail(404, "This registration link has expired or was turned off. Please ask NVBC for a new one.");
  const s = validateSignup(input, today(), invite.roles);
  if (typeof s === "string") return fail(400, s);
  const name = fullName(s);
  try {
    await db().query(
      `INSERT INTO admin_users (username, display_name, password_hash, created_by, role, is_stringer,
                                first_name, last_name, birthdate, mobile, email, is_active, pending, invite_id)
       VALUES ($1, $2, $3, 'Registration link', $4, $5, $6, $7, $8, $9, $10, FALSE, TRUE, $11)`,
      [s.username, name, hashPassword(s.password), s.role, s.stringer, s.firstName, s.lastName, s.birthdate, s.mobile, s.email, invite.id]
    );
  } catch (e) {
    if (isUniqueError(e)) return taken(s.username);
    throw e;
  }
  const short = `${s.firstName} ${s.lastName.charAt(0)}.`;
  await notifyStaff([{
    kind: "staff_signup",
    title: `${name} signed up as ${roleName(s.role, s.stringer)} — approve or decline under Staff`,
    pushTitle: `New staff sign-up: ${short}`,
    body: `${roleName(s.role, s.stringer)} · username ${s.username}`,
  }]);
  return { ok: true, data: { name: s.firstName } };
}
