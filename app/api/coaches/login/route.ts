import { NextRequest, NextResponse } from "next/server";
import { setCoachCookie } from "@/lib/coach-auth";
import { coachLogin } from "@/lib/coaches";
import { readJson, serverError } from "@/lib/http";
import { clearHits, clientIp, recordHit, tooMany } from "@/lib/throttle";

export const dynamic = "force-dynamic";

// { email, password } — the same wrong-password limits as staff logins.
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await readJson(req);
    const e = typeof email === "string" ? email.trim().toLowerCase() : "";
    const ip = clientIp(req);
    const limits = [
      { bucket: "coach-login-user-ip", key: `${e}|${ip}`, limit: 5, minutes: 15 },
      { bucket: "coach-login-ip", key: ip, limit: 20, minutes: 15 },
    ];
    for (const l of limits)
      if (await tooMany(l.bucket, l.key, l.limit, l.minutes))
        return NextResponse.json({ error: "Too many wrong passwords. Please wait 15 minutes and try again." }, { status: 429 });
    const who = await coachLogin(e, password);
    if (!who) {
      for (const l of limits) await recordHit(l.bucket, l.key);
      await new Promise((r) => setTimeout(r, 800));
      return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
    }
    await clearHits("coach-login-user-ip", `${e}|${ip}`);
    const res = NextResponse.json({ ok: true });
    setCoachCookie(res, who.id, who.version);
    return res;
  } catch (e) {
    return serverError(e);
  }
}
