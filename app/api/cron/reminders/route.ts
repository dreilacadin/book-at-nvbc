import { NextRequest, NextResponse } from "next/server";
import { sendUpcomingReminders } from "@/lib/customer-notify";
import { serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// Optional: sends customers' "your court time is coming up" reminders. They also go out whenever
// the site is used, but a scheduler calling this every 5–10 minutes makes them punctual even at
// quiet times. Needs CRON_SECRET, sent as "Authorization: Bearer <CRON_SECRET>" (Vercel Cron does
// this automatically).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ sent: await sendUpcomingReminders(true) });
  } catch (e) {
    return serverError(e);
  }
}
