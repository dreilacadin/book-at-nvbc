import { randomBytes } from "node:crypto";
import { db } from "./db";
import { hashPassword, verifyPassword } from "./password";

// Staff accounts for /admin. Passwords are stored as salted scrypt hashes, never as text.

export type AdminUser = {
  id: number;
  username: string;
  display_name: string;
  is_active: boolean;
  token_version: number;
  created_at: string;
  last_login_at: string | null;
  created_by: string;
};

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

const COLUMNS = `id, username, display_name, is_active, token_version, created_at, last_login_at, created_by`;

// A fixed hash to compare against when the username doesn't exist, so a wrong username takes
// as long as a wrong password (no hint about which usernames exist).
const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));

export const normalizeUsername = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;

function checkName(v: unknown): string | null {
  const name = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return name.length >= 2 && name.length <= 60 ? name : null;
}
function checkNewPassword(v: unknown): string | null {
  return typeof v === "string" && v.length >= 8 && v.length <= 200 ? v : null;
}

export async function findActiveAdmin(id: number): Promise<AdminUser | null> {
  if (!Number.isInteger(id)) return null;
  const { rows } = await db().query<AdminUser>(`SELECT ${COLUMNS} FROM admin_users WHERE id = $1 AND is_active`, [id]);
  return rows[0] ?? null;
}

/** Username + password login for a staff account. */
export async function verifyLogin(usernameRaw: unknown, password: unknown): Promise<AdminUser | null> {
  const username = normalizeUsername(usernameRaw);
  const pw = typeof password === "string" ? password : "";
  const { rows } = await db().query<AdminUser & { password_hash: string }>(
    `SELECT ${COLUMNS}, password_hash FROM admin_users WHERE username = $1`,
    [username]
  );
  const user = rows[0];
  const ok = verifyPassword(pw, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok || !user.is_active) return null;
  await db().query(`UPDATE admin_users SET last_login_at = now() WHERE id = $1`, [user.id]);
  return user;
}

export async function listAdmins(): Promise<AdminUser[]> {
  const { rows } = await db().query<AdminUser>(`SELECT ${COLUMNS} FROM admin_users ORDER BY is_active DESC, display_name`);
  return rows;
}

export async function createAdmin(input: Record<string, unknown>, createdBy: string): Promise<Result<AdminUser>> {
  const username = normalizeUsername(input.username);
  const name = checkName(input.name);
  const password = checkNewPassword(input.password);
  if (!USERNAME.test(username)) return fail(400, "Usernames are 3–30 letters, numbers, dots, dashes or underscores.");
  if (username === "owner") return fail(400, "“owner” is reserved. Choose another username.");
  if (!name) return fail(400, "Enter the person's name.");
  if (!password) return fail(400, "Passwords need at least 8 characters.");
  try {
    const { rows } = await db().query<AdminUser>(
      `INSERT INTO admin_users (username, display_name, password_hash, created_by)
       VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [username, name, hashPassword(password), createdBy]
    );
    return { ok: true, data: rows[0] };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return fail(409, `The username “${username}” is taken.`);
    throw e;
  }
}

/** Rename, enable or disable an account. Disabling logs the person out everywhere. */
export async function updateAdmin(id: unknown, input: Record<string, unknown>, me: number | null): Promise<Result<AdminUser>> {
  const n = Number(id);
  if (!Number.isInteger(n)) return fail(400, "Invalid account.");
  const name = input.name === undefined ? undefined : checkName(input.name);
  if (name === null) return fail(400, "Enter the person's name.");
  const active = typeof input.active === "boolean" ? input.active : undefined;
  if (active === false && n === me) return fail(400, "You can't disable your own account.");
  const { rows } = await db().query<AdminUser>(
    `UPDATE admin_users SET display_name = COALESCE($2, display_name),
            is_active = COALESCE($3, is_active),
            token_version = token_version + CASE WHEN $3::boolean IS FALSE THEN 1 ELSE 0 END
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [n, name ?? null, active ?? null]
  );
  if (!rows[0]) return fail(404, "Account not found.");
  return { ok: true, data: rows[0] };
}

/** Set a new password. Logs that account out of its other sessions (the caller re-issues its own). */
export async function setAdminPassword(id: unknown, password: unknown): Promise<Result<AdminUser>> {
  const n = Number(id);
  const pw = checkNewPassword(password);
  if (!Number.isInteger(n)) return fail(400, "Invalid account.");
  if (!pw) return fail(400, "Passwords need at least 8 characters.");
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
