import { NextRequest } from "next/server";
import { createBooking } from "@/lib/bookings";
import { readJson, respond, serverError } from "@/lib/http";

// Public: create an anonymous booking. Returns a booking code for managing it later.
export async function POST(req: NextRequest) {
  try {
    return respond(await createBooking(await readJson(req)), 201);
  } catch (e) {
    return serverError(e);
  }
}
