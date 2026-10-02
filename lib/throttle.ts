import type { NextRequest } from "next/server";
import { db } from "./db";

// Slows down guessing (passwords, booking codes) by counting recent failures in the database, so
// limits hold across all servers. Server only.

/** The visitor's IP address (the first one in X-Forwarded-For on Vercel), or "unknown". */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

/** True when `key` has `limit` or more failures in `bucket` within the last `minutes`. */
export async function tooMany(bucket: string, key: string, limit: number, minutes: number): Promise<boolean> {
  const { rows } = await db().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM throttle_hits WHERE bucket = $1 AND key = $2 AND at > now() - make_interval(mins => $3)`,
    [bucket, key, minutes]
  );
  return rows[0].n >= limit;
}

/** Records one failure. Now and then, forgets failures older than a day. */
export async function recordHit(bucket: string, key: string): Promise<void> {
  await db().query(`INSERT INTO throttle_hits (bucket, key) VALUES ($1, $2)`, [bucket, key.slice(0, 200)]);
  if (Math.random() < 0.02) await db().query(`DELETE FROM throttle_hits WHERE at < now() - interval '1 day'`);
}

export async function clearHits(bucket: string, key: string): Promise<void> {
  await db().query(`DELETE FROM throttle_hits WHERE bucket = $1 AND key = $2`, [bucket, key]);
}

// Booking codes: a visitor who tries this many unknown codes in CODE_WINDOW minutes is paused.
const CODE_MISSES = 30;
const CODE_WINDOW = 15;

/**
 * Wraps a public route that takes a booking code: refuses visitors who've tried too many unknown
 * codes, and counts a "No booking found" answer (404) as a miss. Real customers never get near it.
 */
export async function guardBookingCode(req: NextRequest, handler: () => Promise<Response>): Promise<Response> {
  const ip = clientIp(req);
  if (await tooMany("code-miss", ip, CODE_MISSES, CODE_WINDOW))
    return Response.json(
      { error: "Too many booking codes tried. Please wait 15 minutes, or ask the front desk for help." },
      { status: 429 }
    );
  const res = await handler();
  if (res.status === 404) await recordHit("code-miss", ip);
  return res;
}
