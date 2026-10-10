import { NextRequest, NextResponse } from "next/server";
import { coachForCode } from "@/lib/coaches";
import { readJson, serverError } from "@/lib/http";
import { clientIp, recordHit, tooMany } from "@/lib/throttle";

export const dynamic = "force-dynamic";

// Public, for the booking form: { code } → the coach's details to fill in (name, mobile, email).
// Wrong codes count towards a per-visitor limit, so codes can't be guessed.
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (await tooMany("coach-code-miss", ip, 15, 15))
      return NextResponse.json({ error: "Too many wrong coach codes. Please wait 15 minutes." }, { status: 429 });
    const { code } = await readJson(req);
    const c = await coachForCode(code);
    if (c === null) return NextResponse.json({ coach: null }); // not a personal coach code (maybe the shared one)
    if (typeof c === "string") {
      await recordHit("coach-code-miss", ip);
      return NextResponse.json({ error: c }, { status: 400 });
    }
    return NextResponse.json({ coach: { name: c.name, mobile: c.mobile, email: c.email } });
  } catch (e) {
    return serverError(e);
  }
}
