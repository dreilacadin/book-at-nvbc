import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const ADMIN_COOKIE = "nvbc_admin";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

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

export function checkPassword(input: unknown): boolean {
  if (typeof input !== "string") return false;
  // Compare hashes so the comparison time doesn't depend on the password length.
  return safeEqual(sign("pw:" + input), sign("pw:" + secret()));
}

/** Token = expiry.signature — changing ADMIN_PASSWORD logs everyone out. */
export function issueToken(): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  return `${exp}.${sign("admin:" + exp)}`;
}

export function isAdmin(req: NextRequest): boolean {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, sign("admin:" + exp));
}

export function setAdminCookie(res: NextResponse) {
  res.cookies.set(ADMIN_COOKIE, issueToken(), {
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
