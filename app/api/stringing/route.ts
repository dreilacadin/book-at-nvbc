import { NextRequest, NextResponse } from "next/server";
import { readJson, respond, serverError } from "@/lib/http";
import {
  createStringingOrder,
  setStringingEmail,
  setStringingPush,
  stringingOptions,
  stringingPushOn,
  stringingStamp,
  stringingView,
  submitStringingFeedback,
  submitStringingPayment,
} from "@/lib/stringings";
import { pushConfig } from "@/lib/notify";
import { clientIp, recordHit, tooMany } from "@/lib/throttle";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

// Public: what the check-in form needs (strings for sale, suggestions, prices, payment methods).
export async function GET() {
  try {
    return NextResponse.json(await stringingOptions(), { headers: noStore });
  } catch (e) {
    return serverError(e);
  }
}

// Check-ins from one network per hour: plenty for a busy desk, but stops a flood of fake ones.
const CHECKINS_PER_HOUR = 15;

// Public:
//   { action: "create", name, mobile, email?, rackets: [...] }            → { token, tags }
//   { action: "view", token }                                            → the status page
//   { action: "stamp", token }                                           → { stamp } (changes when the page does)
//   { action: "pay", token, method, reference?, proof?, amountPaid? }
//   { action: "feedback", token, rating, comment? } | { action: "email", token, email }
//   { action: "push", token, on, subscription | endpoint } | { action: "push-status", token, endpoint }
export async function POST(req: NextRequest) {
  try {
    const b = await readJson(req);
    if (b.action === "create") {
      const ip = clientIp(req);
      if (await tooMany("stringing-new", ip, CHECKINS_PER_HOUR, 60))
        return NextResponse.json({ error: "Too many check-ins from here. Please ask the front desk." }, { status: 429 });
      const r = await createStringingOrder(b as Parameters<typeof createStringingOrder>[0], null);
      if (r.ok) await recordHit("stringing-new", ip);
      return respond(r, 201);
    }
    if (b.action === "view") return NextResponse.json(...viewOf(await stringingView(b.token)));
    // The open status page checks this every few seconds and loads the page only when it changed.
    if (b.action === "stamp") {
      const stamp = await stringingStamp(b.token);
      return NextResponse.json(stamp === null ? { error: "Not found." } : { stamp }, { status: stamp === null ? 404 : 200, headers: noStore });
    }
    if (b.action === "pay") return respond(await submitStringingPayment(b.token, b));
    if (b.action === "feedback") return respond(await submitStringingFeedback(b.token, b.rating, b.comment));
    if (b.action === "email") return respond(await setStringingEmail(b.token, b.email));
    if (b.action === "push") return respond(await setStringingPush(b.token, b.on === true, b.on === true ? b.subscription : { endpoint: b.endpoint }));
    if (b.action === "push-status")
      return NextResponse.json({ on: await stringingPushOn(b.token, b.endpoint), push: pushConfig() }, { headers: noStore });
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}

function viewOf(r: Awaited<ReturnType<typeof stringingView>>): [unknown, ResponseInit] {
  return r.ok ? [r.data, { headers: noStore }] : [{ error: r.error }, { status: r.status }];
}
