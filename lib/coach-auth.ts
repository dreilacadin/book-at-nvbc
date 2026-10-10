import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { db } from "./db";

// Coach logins: a signed cookie (coach id, password version, expiry), separate from the staff
// login so a coach can never reach the admin panel. Server only.

export const COACH_COOKIE = "nvbc_coach";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days on their own phone

function sign(payload: string): string {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || pw.length < 8) throw new Error("ADMIN_PASSWORD must be set (at least 8 characters).");
  return createHmac("sha256", pw).update("coach:" + payload).digest("base64url");
}

export type CoachSession = { id: string; name: string; status: string };

export function setCoachCookie(res: NextResponse, id: string, version: number) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  res.cookies.set(COACH_COOKIE, `${id}.${version}.${exp}.${sign(`${id}:${version}:${exp}`)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearCoachCookie(res: NextResponse) {
  res.cookies.set(COACH_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** The logged-in coach (any status but rejected), or null. Re-checked against the database. */
export async function getCoach(req: NextRequest): Promise<CoachSession | null> {
  const token = req.cookies.get(COACH_COOKIE)?.value;
  if (!token) return null;
  const [id, version, exp, sig] = token.split(".");
  if (!id || !version || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  const expected = sign(`${id}:${version}:${exp}`);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await db().query<{ full_name: string; status: string; token_version: number }>(
    `SELECT full_name, status, token_version FROM coaches WHERE id = $1`,
    [id]
  );
  const c = rows[0];
  if (!c || c.status === "rejected" || c.token_version !== Number(version)) return null;
  return { id, name: c.full_name, status: c.status };
}
