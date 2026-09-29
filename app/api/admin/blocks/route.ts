import { NextRequest, NextResponse } from "next/server";
import { isAdmin, unauthorized } from "@/lib/admin-auth";
import { createBlock, deleteBlock, listBlocks } from "@/lib/court-blocks";
import { readJson, respond, serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// Admin only: reserved times (Open Play, Queueing, …).
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return unauthorized();
  try {
    return NextResponse.json({ blocks: await listBlocks() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}

// { action: "create", label, courtIds, weekdays, startDate, endDate?, startHour, endHour, notes? } | { action: "delete", id }
export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return unauthorized();
  try {
    const body = await readJson(req);
    if (body.action === "create") return respond(await createBlock(body), 201);
    if (body.action === "delete") return respond(await deleteBlock(body.id));
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
