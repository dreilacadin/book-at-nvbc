import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getCoach, setCoachCookie } from "@/lib/coach-auth";
import { changeCoachPassword, coachBookings, coachById, coachPushOn, removeCoachPush, respondCoaching, saveCoachPush, setCoachRemind, updateCoachProfile } from "@/lib/coaches";
import { getSettings } from "@/lib/db";
import { readJson, respond, serverError } from "@/lib/http";
import { pushConfig } from "@/lib/notify";

export const dynamic = "force-dynamic";
const out = () => NextResponse.json({ error: "Please log in." }, { status: 401 });

// The logged-in coach: profile, QR of their coach code, bookings. ?endpoint= says whether this device has push on.
export async function GET(req: NextRequest) {
  const me = await getCoach(req);
  if (!me) return out();
  try {
    const [coach, bookings, pushOn] = await Promise.all([
      coachById(me.id),
      coachBookings(me.id),
      coachPushOn(me.id, req.nextUrl.searchParams.get("endpoint")),
    ]);
    if (!coach) return out();
    const qr = coach.coach_code ? await QRCode.toDataURL(coach.coach_code, { margin: 2, width: 300, errorCorrectionLevel: "M" }) : null;
    const { activities } = await getSettings();
    return NextResponse.json({ coach, qr, bookings, push: pushConfig(), pushOn, activities }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}

// { action: "profile", ...fields } | { action: "password", current, next } | { action: "respond", bookingId, accept, note }
// | { action: "remind", bookingId, on } | { action: "push-on", subscription } | { action: "push-off", endpoint }
export async function POST(req: NextRequest) {
  const me = await getCoach(req);
  if (!me) return out();
  try {
    const b = await readJson(req);
    if (b.action === "profile") return respond(await updateCoachProfile(me.id, b));
    if (b.action === "password") {
      const r = await changeCoachPassword(me.id, b.current, b.next);
      if (!r.ok) return respond(r);
      const res = NextResponse.json({ ok: true });
      setCoachCookie(res, me.id, r.data.version); // keep this device logged in
      return res;
    }
    // Pending coaches can't take sessions yet (they aren't listed to customers anyway).
    if (b.action === "respond") return respond(await respondCoaching(me.id, b.bookingId, b.accept, b.note));
    if (b.action === "remind") return respond(await setCoachRemind(me.id, b.bookingId, b.on));
    if (b.action === "push-on") {
      const err = await saveCoachPush(me.id, b.subscription);
      return err ? NextResponse.json({ error: err }, { status: 400 }) : NextResponse.json({ ok: true });
    }
    if (b.action === "push-off") {
      await removeCoachPush(me.id, b.endpoint);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
