import { NextRequest, NextResponse } from "next/server";
import { getAdmin, isAdmin, unauthorized } from "@/lib/admin-auth";
import { staffSend, staffThread } from "@/lib/booking-messages";
import { readJson, respond, serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// Admin only. GET ?booking=<id>: the booking's messages (marks the customer's as read).
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return unauthorized();
  try {
    return respond(await staffThread(req.nextUrl.searchParams.get("booking") ?? ""));
  } catch (e) {
    return serverError(e);
  }
}

// { booking, body }: reply to the customer (they're notified by push / email if they turned it on).
export async function POST(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  try {
    const b = await readJson(req);
    if (typeof b.booking !== "string") return NextResponse.json({ error: "Invalid booking id." }, { status: 400 });
    return respond(await staffSend(b.booking, b.body, me.name));
  } catch (e) {
    return serverError(e);
  }
}
