import { NextRequest, NextResponse } from "next/server";
import { getAvailability } from "@/lib/bookings";
import { serverError } from "@/lib/http";
import { ACTIVITY_ID } from "@/lib/sports";
import { isValidDate, nowAtFacility } from "@/lib/time";

export const dynamic = "force-dynamic";

// Public: which court/hour slots are taken on a date (?date=YYYY-MM-DD&sport=badminton or an activity). No names or contact details.
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") || nowAtFacility().date;
  if (!isValidDate(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  const sport = req.nextUrl.searchParams.get("sport");
  // A sport or activity id; unknown ones fall back to the default tab.
  if (sport !== null && !ACTIVITY_ID.test(sport))
    return NextResponse.json({ error: "Unknown sport" }, { status: 400 });
  try {
    return NextResponse.json(await getAvailability(date, sport ?? undefined), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return serverError(e);
  }
}
