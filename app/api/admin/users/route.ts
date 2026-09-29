import { NextRequest, NextResponse } from "next/server";
import { getAdmin, setAdminCookie, unauthorized } from "@/lib/admin-auth";
import { createAdmin, deleteAdmin, listAdmins, setAdminPassword, updateAdmin } from "@/lib/admin-users";
import { readJson, respond, serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// Admin only: staff accounts.
export async function GET(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  try {
    return NextResponse.json({ users: await listAdmins(), me }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}

// { action: "create", username, name, password } | { action: "update", id, name?, active? }
// | { action: "password", id, password } | { action: "delete", id }
export async function POST(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  try {
    const b = await readJson(req);
    if (b.action === "create") return respond(await createAdmin(b, me.name), 201);
    if (b.action === "update") return respond(await updateAdmin(b.id, b, me.id));
    if (b.action === "delete") return respond(await deleteAdmin(b.id, me.id));
    if (b.action === "password") {
      const r = await setAdminPassword(b.id, b.password);
      if (!r.ok || Number(b.id) !== me.id) return respond(r);
      // Changing your own password logs out your other sessions — keep this one signed in.
      const res = NextResponse.json(r.data);
      setAdminCookie(res, r.data.id, r.data.token_version);
      return res;
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
