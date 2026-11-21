import { NextRequest, NextResponse } from "next/server";
import { activeInvite, signUpWithInvite } from "@/lib/admin-users";
import { readJson, serverError } from "@/lib/http";
import { clientIp, recordHit, tooMany } from "@/lib/throttle";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

// Registration links (/team/join#<token>): anyone with a working link can sign up as Staff, a
// Scholar or a Stringer (the roles the link allows). The account waits for the owner or a manager.
// Limits: unknown links per network (guessing), and sign-ups per network (spam).
const MISSES = { bucket: "team-join-miss", limit: 20, minutes: 15 };
const SIGNUPS = { bucket: "team-join", limit: 6, minutes: 60 };
const GONE = "This registration link has expired or was turned off. Please ask NVBC for a new one.";

async function guard(req: NextRequest) {
  const ip = clientIp(req);
  if (await tooMany(MISSES.bucket, ip, MISSES.limit, MISSES.minutes))
    return { ip, stop: NextResponse.json({ error: "Too many tries. Please wait 15 minutes." }, { status: 429 }) };
  return { ip, stop: null };
}

// ?token=… → { roles } for a working link, or 404.
export async function GET(req: NextRequest) {
  try {
    const { ip, stop } = await guard(req);
    if (stop) return stop;
    const invite = await activeInvite(req.nextUrl.searchParams.get("token"));
    if (!invite) {
      await recordHit(MISSES.bucket, ip);
      return NextResponse.json({ error: GONE }, { status: 404, headers: noStore });
    }
    return NextResponse.json({ roles: invite.roles }, { headers: noStore });
  } catch (e) {
    return serverError(e);
  }
}

// { token, firstName, lastName, birthdate, mobile, email, username, password, role, stringer? }
export async function POST(req: NextRequest) {
  try {
    const { ip, stop } = await guard(req);
    if (stop) return stop;
    if (await tooMany(SIGNUPS.bucket, ip, SIGNUPS.limit, SIGNUPS.minutes))
      return NextResponse.json({ error: "Too many sign-ups from this network. Please try again later." }, { status: 429 });
    const b = await readJson(req);
    const r = await signUpWithInvite(b.token, b);
    if (!r.ok) {
      if (r.status === 404) await recordHit(MISSES.bucket, ip);
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    await recordHit(SIGNUPS.bucket, ip);
    return NextResponse.json(r.data, { status: 201 });
  } catch (e) {
    return serverError(e);
  }
}
