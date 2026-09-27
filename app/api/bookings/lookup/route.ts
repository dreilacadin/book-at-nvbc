import { NextRequest } from "next/server";
import { findByCode } from "@/lib/bookings";
import { readJson, respond, serverError } from "@/lib/http";

// POST (not GET) so booking codes don't end up in server logs or browser history.
export async function POST(req: NextRequest) {
  try {
    const body = await readJson(req);
    return respond(await findByCode(body.code));
  } catch (e) {
    return serverError(e);
  }
}
