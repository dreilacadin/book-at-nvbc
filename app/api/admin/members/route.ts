import { NextRequest, NextResponse } from "next/server";
import { isAdmin, unauthorized } from "@/lib/admin-auth";
import { readJson, respond, serverError } from "@/lib/http";
import {
  approveMembership,
  deleteMembership,
  findByMemberCode,
  listMemberships,
  rejectMembership,
  renewMembership,
  setMembershipPayment,
} from "@/lib/memberships";

export const dynamic = "force-dynamic";

// Admin only: all applications and members, or one member by code (?code=, from a QR scan).
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const code = req.nextUrl.searchParams.get("code");
    if (code !== null) return respond(await findByMemberCode(code));
    return NextResponse.json({ members: await listMemberships() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}

// { action: "payment", id, status } | { action: "approve", id } | { action: "renew", id }
// | { action: "reject", id, reason? } | { action: "delete", id }  (declined applications only)
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const b = await readJson(req);
    const id = String(b.id ?? "");
    if (b.action === "payment") return respond(await setMembershipPayment(id, b.status));
    if (b.action === "approve") return respond(await approveMembership(id));
    if (b.action === "renew") return respond(await renewMembership(id));
    if (b.action === "reject") return respond(await rejectMembership(id, b.reason));
    if (b.action === "delete") return respond(await deleteMembership(id));
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
