import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getCoach, setCoachCookie } from "@/lib/coach-auth";
import { cancelByCoach, coachMethods } from "@/lib/bookings";
import {
  changeCoachPassword, coachArrived, coachBookings, coachById, coachPaidAtDesk, coachPushOn, confirmComing, removeCoachPush,
  respondCoaching, saveCoachPush, setBookingClient, setCoachRemind, updateCoachProfile,
} from "@/lib/coaches";
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
    const settings = await getSettings();
    // How they can pay for a session afterwards: cash at the desk (if allowed), or online.
    const methods = coachMethods(settings, true);
    const payment = { desk: methods.includes("cash"), online: methods.filter((m) => m !== "cash") };
    return NextResponse.json(
      { coach, qr, bookings, push: pushConfig(), pushOn, activities: settings.activities, payment },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return serverError(e);
  }
}

// { action: "profile", ...fields } | { action: "password", current, next } | { action: "respond", bookingId, accept, note }
// | { action: "remind", bookingId, on } | { action: "push-on", subscription } | { action: "push-off", endpoint }
// Their own bookings: | { action: "confirm" | "arrived" | "paid-desk" | "cancel", bookingId } | { action: "client", bookingId, client }
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
    if (b.action === "confirm") return respond(await confirmComing(me.id, b.bookingId));
    if (b.action === "client") return respond(await setBookingClient(me.id, b.bookingId, b.client));
    if (b.action === "arrived") return respond(await coachArrived(me.id, b.bookingId));
    if (b.action === "cancel") return respond(await cancelByCoach(me.id, b.bookingId));
    if (b.action === "paid-desk")
      return respond(await coachPaidAtDesk(me.id, b.bookingId, coachMethods(await getSettings(), true).includes("cash")));
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
