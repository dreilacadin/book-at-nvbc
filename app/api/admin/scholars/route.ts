import { NextRequest, NextResponse } from "next/server";
import { canManage, forbidden, getAdmin, unauthorized } from "@/lib/admin-auth";
import { readJson, respond, serverError } from "@/lib/http";
import { deleteScholarApplication, listScholarApplications, updateScholarApplication } from "@/lib/scholars";

export const dynamic = "force-dynamic";

// Owner and managers only: applications hold minors' contact and health details, so staff accounts
// (which scholars on duty may use) can't read them.
export async function GET(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  if (!canManage(me)) return forbidden();
  try {
    return NextResponse.json({ applications: await listScholarApplications() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}

// { action: "update", id, status, notes } | { action: "delete", id }
export async function POST(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  if (!canManage(me)) return forbidden();
  try {
    const b = await readJson(req);
    const id = String(b.id ?? "");
    if (b.action === "update") return respond(await updateScholarApplication(id, b));
    if (b.action === "delete") return respond(await deleteScholarApplication(id));
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
