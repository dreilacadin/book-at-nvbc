import { NextRequest, NextResponse } from "next/server";
import { canManage, forbidden, getAdmin, unauthorized } from "@/lib/admin-auth";
import { bookingHistory, staffActivity } from "@/lib/booking-history";
import { serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// Admin only. ?booking=<id>: that booking's history (oldest first).
// Otherwise: recent staff actions across all bookings (?actor=<staff name> to filter, ?limit=).
export async function GET(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  const q = req.nextUrl.searchParams;
  try {
    const booking = q.get("booking");
    if (booking !== null) {
      if (!/^[0-9a-f-]{36}$/i.test(booking)) return NextResponse.json({ error: "Invalid booking id." }, { status: 400 });
      return NextResponse.json({ entries: await bookingHistory(booking) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!canManage(me)) return forbidden(); // the activity log across all staff
    const actor = q.get("actor")?.trim() || null;
    return NextResponse.json(await staffActivity(actor, Number(q.get("limit")) || 100), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}
