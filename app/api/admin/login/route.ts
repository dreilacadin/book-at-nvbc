import { NextRequest, NextResponse } from "next/server";
import { checkPassword, getAdmin, OWNER, setAdminCookie } from "@/lib/admin-auth";
import { normalizeUsername, verifyLogin } from "@/lib/admin-users";
import { readJson, serverError } from "@/lib/http";
import { clearHits, clientIp, recordHit, tooMany } from "@/lib/throttle";

// Wrong-password limits: per username from one device/network, per network, and per username
// overall (stops slow guessing spread over many networks). The same answer whether or not the
// username exists, so it doesn't reveal which usernames are real.
const LIMITS = [
  { bucket: "login-user-ip", limit: 5, minutes: 15 },
  { bucket: "login-ip", limit: 20, minutes: 15 },
  { bucket: "login-user", limit: 50, minutes: 60 },
] as const;

export const dynamic = "force-dynamic";

// Who's logged in (used by /admin and by the booking page's staff mode).
export async function GET(req: NextRequest) {
  try {
    const me = await getAdmin(req);
    return NextResponse.json(me ? { loggedIn: true, name: me.name, username: me.username, id: me.id, role: me.role } : { loggedIn: false });
  } catch (e) {
    return serverError(e);
  }
}

// { username, password }. Username "owner" (or blank) + ADMIN_PASSWORD always works, for recovery.
export async function POST(req: NextRequest) {
  try {
    const { username, password } = await readJson(req);
    const u = normalizeUsername(username);
    const ip = clientIp(req);
    const keyOf = (bucket: string) => (bucket === "login-ip" ? ip : bucket === "login-user" ? u || "owner" : `${u || "owner"}|${ip}`);
    for (const l of LIMITS) {
      if (await tooMany(l.bucket, keyOf(l.bucket), l.limit, l.minutes))
        return NextResponse.json(
          { error: `Too many wrong passwords. Please wait ${l.minutes} minutes and try again.` },
          { status: 429 }
        );
    }
    let who: { id: number | null; version: number; name: string } | null = null;
    if (u === "" || u === OWNER.username) {
      if (checkPassword(password)) who = { id: null, version: 0, name: OWNER.name };
    } else {
      const user = await verifyLogin(u, password);
      if (user) who = { id: user.id, version: user.token_version, name: user.display_name };
    }
    if (!who) {
      for (const l of LIMITS) await recordHit(l.bucket, keyOf(l.bucket));
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
    }
    await clearHits("login-user-ip", keyOf("login-user-ip"));
    const res = NextResponse.json({ loggedIn: true, name: who.name });
    setAdminCookie(res, who.id, who.version);
    return res;
  } catch (e) {
    return serverError(e);
  }
}
