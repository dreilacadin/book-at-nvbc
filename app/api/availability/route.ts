import { NextRequest, NextResponse } from "next/server";
import { getAvailability } from "@/lib/bookings";
import { getCoach } from "@/lib/coach-auth";
import { serverError } from "@/lib/http";
import { ACTIVITY_ID } from "@/lib/sports";
import { isValidDate, nowAtFacility } from "@/lib/time";

export const dynamic = "force-dynamic";

// Public: which court/hour slots are taken on a date (?date=YYYY-MM-DD&sport=badminton or an activity). No names or contact details.
// A coach logged in on this device also gets their own coach code and the reserved times coaches can book.
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") || nowAtFacility().date;
  if (!isValidDate(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  const sport = req.nextUrl.searchParams.get("sport");
  // A sport or activity id; unknown ones fall back to the default tab.
  if (sport !== null && !ACTIVITY_ID.test(sport))
    return NextResponse.json({ error: "Unknown sport" }, { status: 400 });
  try {
    const coach = await getCoach(req);
    return NextResponse.json(await getAvailability(date, sport ?? undefined, coach?.id ?? null), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return serverError(e);
  }
}
