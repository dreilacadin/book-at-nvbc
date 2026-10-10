import { NextRequest, NextResponse } from "next/server";
import { setCoachCookie } from "@/lib/coach-auth";
import { registerCoach, signupKeyValid } from "@/lib/coaches";
import { getSettings } from "@/lib/db";
import { readJson, serverError } from "@/lib/http";
import { clientIp, recordHit, tooMany } from "@/lib/throttle";

export const dynamic = "force-dynamic";

// GET ?key= — is this sign-up link valid?
export async function GET(req: NextRequest) {
  try {
    const s = await getSettings(); // custom activities (e.g. Zumba) a coach can choose
    return NextResponse.json({ valid: await signupKeyValid(req.nextUrl.searchParams.get("key")), activities: s.activities });
  } catch (e) {
    return serverError(e);
  }
}

// POST { key, fullName, email, mobile, phpaId, phpaPhoto?, photo, sports, rates, availability, password }
// Creates the coach (waiting for approval) and logs them in. At most 5 sign-ups per network per hour.
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (await tooMany("coach-signup", ip, 5, 60))
      return NextResponse.json({ error: "Too many sign-ups from this network — please try again later." }, { status: 429 });
    const r = await registerCoach(await readJson(req));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await recordHit("coach-signup", ip);
    const res = NextResponse.json({ ok: true }, { status: 201 });
    setCoachCookie(res, r.data.id, r.data.version);
    return res;
  } catch (e) {
    return serverError(e);
  }
}
