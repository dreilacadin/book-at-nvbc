import { NextRequest } from "next/server";
import { cancelByCode } from "@/lib/bookings";
import { readJson, respond, serverError } from "@/lib/http";

export async function POST(req: NextRequest) {
  try {
    const body = await readJson(req);
    return respond(await cancelByCode(body.code));
  } catch (e) {
    return serverError(e);
  }
}
