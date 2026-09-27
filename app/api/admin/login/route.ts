import { NextRequest, NextResponse } from "next/server";
import { checkPassword, isAdmin, setAdminCookie } from "@/lib/admin-auth";
import { readJson, serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json({ loggedIn: isAdmin(req) });
}

export async function POST(req: NextRequest) {
  try {
    const { password } = await readJson(req);
    if (!checkPassword(password)) {
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      return NextResponse.json({ error: "Wrong password." }, { status: 401 });
    }
    const res = NextResponse.json({ loggedIn: true });
    setAdminCookie(res);
    return res;
  } catch (e) {
    return serverError(e);
  }
}
