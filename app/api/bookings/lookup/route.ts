import { NextRequest } from "next/server";
import { findByCode } from "@/lib/bookings";
import { guardBookingCode } from "@/lib/throttle";
import { readJson, respond, serverError } from "@/lib/http";

// POST (not GET) so booking codes don't end up in server logs or browser history.
async function handle(req: NextRequest) {
  try {
    const body = await readJson(req);
    return respond(await findByCode(body.code));
  } catch (e) {
    return serverError(e);
  }
}

// Unknown booking codes count towards a per-visitor limit (see guardBookingCode).
export async function POST(req: NextRequest) {
  return guardBookingCode(req, () => handle(req));
}
