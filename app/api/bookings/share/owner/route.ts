import { NextRequest } from "next/server";
import { shareLinkOwner } from "@/lib/bookings";
import { readJson, respond, serverError } from "@/lib/http";
import { guardBookingCode } from "@/lib/throttle";

// Public: { token, codes } → { code } when one of the booking codes (saved on this phone, or typed)
// holds the booking behind the view-only link /b/<token>. Not a match counts towards the
// per-visitor limit on booking codes, so it can't be used to guess one.
export async function POST(req: NextRequest) {
  return guardBookingCode(req, async () => {
    try {
      const body = await readJson(req);
      return respond(await shareLinkOwner(body.token, body.codes));
    } catch (e) {
      return serverError(e);
    }
  });
}
