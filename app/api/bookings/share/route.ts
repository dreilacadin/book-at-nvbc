import { NextRequest } from "next/server";
import { shareLink } from "@/lib/bookings";
import { readJson, respond, serverError } from "@/lib/http";
import { guardBookingCode } from "@/lib/throttle";

// Public: { code } → the booking's view-only link. Unknown codes count towards a per-visitor limit.
export async function POST(req: NextRequest) {
  return guardBookingCode(req, async () => {
    try {
      return respond(await shareLink((await readJson(req)).code));
    } catch (e) {
      return serverError(e);
    }
  });
}
