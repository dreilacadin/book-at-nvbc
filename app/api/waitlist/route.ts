import { NextRequest, NextResponse } from "next/server";
import { readJson, respond, serverError } from "@/lib/http";
import { clientIp, recordHit, tooMany } from "@/lib/throttle";
import { joinWaitlist } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

// Public: { sport, date, start, end, email?, subscription? } — tell me if this time opens up.
// At most 15 requests per visitor per hour.
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (await tooMany("waitlist", ip, 15, 60))
      return NextResponse.json({ error: "You've joined several waitlists — please try again later." }, { status: 429 });
    const r = await joinWaitlist(await readJson(req));
    if (r.ok) await recordHit("waitlist", ip);
    return respond(r, 201);
  } catch (e) {
    return serverError(e);
  }
}
