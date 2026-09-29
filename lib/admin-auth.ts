import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { findActiveAdmin } from "./admin-users";

export const ADMIN_COOKIE = "nvbc_admin";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

/** Who is logged in: a staff account, or the owner (ADMIN_PASSWORD, for recovery). */
export type AdminSession = { id: number | null; username: string; name: string };

export const OWNER: AdminSession = { id: null, username: "owner", name: "Owner" };

function secret(): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || pw.length < 8) throw new Error("ADMIN_PASSWORD must be set (at least 8 characters).");
  return pw;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** The owner password (ADMIN_PASSWORD). */
export function checkPassword(input: unknown): boolean {
  if (typeof input !== "string") return false;
  // Compare hashes so the comparison time doesn't depend on the password length.
  return safeEqual(sign("pw:" + input), sign("pw:" + secret()));
}

/**
 * Token = who.version.expiry.signature. `who` is "owner" or a staff account id; `version` changes
 * when that account's password changes or it's disabled, which logs its old sessions out.
 * Changing ADMIN_PASSWORD logs everyone out.
 */
export function issueToken(who: number | null, version: number): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const id = who === null ? "owner" : String(who);
  return `${id}.${version}.${exp}.${sign(`admin:${id}:${version}:${exp}`)}`;
}

/** The logged-in admin, or null. Staff accounts are re-checked (still active, same version). */
export async function getAdmin(req: NextRequest): Promise<AdminSession | null> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const [id, version, exp, sig] = token.split(".");
  if (!id || !version || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  if (!safeEqual(sig, sign(`admin:${id}:${version}:${exp}`))) return null;
  if (id === "owner") return OWNER;
  const user = await findActiveAdmin(Number(id));
  if (!user || user.token_version !== Number(version)) return null;
  return { id: user.id, username: user.username, name: user.display_name };
}

export async function isAdmin(req: NextRequest): Promise<boolean> {
  return (await getAdmin(req)) !== null;
}

export function setAdminCookie(res: NextResponse, who: number | null, version: number) {
  res.cookies.set(ADMIN_COOKIE, issueToken(who, version), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearAdminCookie(res: NextResponse) {
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export function unauthorized() {
  return NextResponse.json({ error: "Please log in again." }, { status: 401 });
}
