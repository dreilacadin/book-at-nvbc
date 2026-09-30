import { NextRequest, NextResponse } from "next/server";
import { getAdmin, unauthorized } from "@/lib/admin-auth";
import { readJson, serverError } from "@/lib/http";
import { scheduleReminders } from "@/lib/customer-notify";
import {
  deletePushSubscription,
  getNotifications,
  markSeen,
  savePushSubscription,
  setKinds,
  testPush,
  whoOf,
} from "@/lib/notify";

export const dynamic = "force-dynamic";

// Admin only: this staff member's notifications (latest 30, unread count, settings).
export async function GET(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  try {
    scheduleReminders(); // staff panels poll often: a good moment to send customers' reminders
    return NextResponse.json(await getNotifications(whoOf(me)), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}

// { action: "seen", upTo } | { action: "kinds", kinds } | { action: "subscribe", subscription, device }
// | { action: "unsubscribe", endpoint } | { action: "test" }
export async function POST(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  const who = whoOf(me);
  try {
    const b = await readJson(req);
    if (b.action === "seen") {
      await markSeen(who, b.upTo);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "kinds") return NextResponse.json({ kinds: await setKinds(who, b.kinds) });
    if (b.action === "subscribe") {
      const err = await savePushSubscription(who, b.subscription, b.device);
      return err ? NextResponse.json({ error: err }, { status: 400 }) : NextResponse.json({ ok: true });
    }
    if (b.action === "unsubscribe") {
      await deletePushSubscription(who, b.endpoint);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "test") {
      const r = await testPush(who);
      return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json(r);
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
