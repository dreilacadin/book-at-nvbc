import { NextRequest, NextResponse } from "next/server";
import { availableCoaches } from "@/lib/coaches";
import { serverError } from "@/lib/http";
import { ACTIVITY_ID } from "@/lib/sports";
import { isValidDate } from "@/lib/time";

export const dynamic = "force-dynamic";

// Public: ?sport=&date=&start=&end= → coaches free for that whole time (name, photo, rates, availability).
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const sport = q.get("sport") ?? "";
  const date = q.get("date");
  const start = Number(q.get("start"));
  const end = Number(q.get("end"));
  if (!ACTIVITY_ID.test(sport) || !isValidDate(date) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    return NextResponse.json({ coaches: await availableCoaches(sport, date, start, end) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}
