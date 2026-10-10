import { NextRequest, NextResponse } from "next/server";
import { setCoachCookie } from "@/lib/coach-auth";
import { resetPassword } from "@/lib/coaches";
import { readJson, serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// { token, password } — a one-time link from NVBC staff. Logs the coach in.
export async function POST(req: NextRequest) {
  try {
    const b = await readJson(req);
    const r = await resetPassword(b.token, b.password);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    const res = NextResponse.json({ ok: true });
    setCoachCookie(res, r.data.id, r.data.version);
    return res;
  } catch (e) {
    return serverError(e);
  }
}
