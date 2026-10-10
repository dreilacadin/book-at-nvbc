import { NextRequest, NextResponse } from "next/server";
import { canManage, forbidden, getAdmin, unauthorized } from "@/lib/admin-auth";
import { coachBookings, listCoaches, makeResetLink, newSignupKey, setCoachNotes, setCoachStatus } from "@/lib/coaches";
import { siteOrigin } from "@/lib/customer-notify";
import { db, getSettings } from "@/lib/db";
import { readJson, respond, serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// Owner/managers: all coaches (or ?coach=<id> for one coach's bookings), the sign-up link, and the shared-code switch.
export async function GET(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  if (!canManage(me)) return forbidden();
  try {
    const one = req.nextUrl.searchParams.get("coach");
    if (one) return NextResponse.json({ bookings: await coachBookings(one) }, { headers: { "Cache-Control": "no-store" } });
    const s = await getSettings();
    return NextResponse.json(
      {
        coaches: await listCoaches(),
        signupUrl: `${siteOrigin()}/coach/join?key=${s.coach_signup_key}`,
        sharedCode: { set: s.coach_code.trim() !== "", enabled: s.shared_coach_code_enabled },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return serverError(e);
  }
}

// { action: "status", id, to: "approve" | "activate" | "deactivate" | "reject" | "new-code" }
// | { action: "notes", id, notes } | { action: "reset-link", id } | { action: "new-signup-link" } | { action: "shared-code", enabled }
export async function POST(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  if (!canManage(me)) return forbidden();
  try {
    const b = await readJson(req);
    if (b.action === "status") return respond(await setCoachStatus(b.id, b.to, me.name));
    if (b.action === "notes") return respond(await setCoachNotes(b.id, b.notes));
    if (b.action === "reset-link") return respond(await makeResetLink(String(b.id ?? "")));
    if (b.action === "new-signup-link") {
      const key = await newSignupKey();
      return NextResponse.json({ signupUrl: `${siteOrigin()}/coach/join?key=${key}` });
    }
    if (b.action === "shared-code") {
      await db().query(`UPDATE settings SET shared_coach_code_enabled = $1`, [b.enabled === true]);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
