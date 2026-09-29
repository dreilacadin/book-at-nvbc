import { NextRequest, NextResponse } from "next/server";
import { checkPassword, getAdmin, OWNER, setAdminCookie } from "@/lib/admin-auth";
import { normalizeUsername, verifyLogin } from "@/lib/admin-users";
import { readJson, serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// Who's logged in (used by /admin and by the booking page's staff mode).
export async function GET(req: NextRequest) {
  try {
    const me = await getAdmin(req);
    return NextResponse.json(me ? { loggedIn: true, name: me.name, username: me.username, id: me.id } : { loggedIn: false });
  } catch (e) {
    return serverError(e);
  }
}

// { username, password }. Username "owner" (or blank) + ADMIN_PASSWORD always works, for recovery.
export async function POST(req: NextRequest) {
  try {
    const { username, password } = await readJson(req);
    const u = normalizeUsername(username);
    let who: { id: number | null; version: number; name: string } | null = null;
    if (u === "" || u === OWNER.username) {
      if (checkPassword(password)) who = { id: null, version: 0, name: OWNER.name };
    } else {
      const user = await verifyLogin(u, password);
      if (user) who = { id: user.id, version: user.token_version, name: user.display_name };
    }
    if (!who) {
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
    }
    const res = NextResponse.json({ loggedIn: true, name: who.name });
    setAdminCookie(res, who.id, who.version);
    return res;
  } catch (e) {
    return serverError(e);
  }
}
