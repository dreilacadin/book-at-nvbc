import { NextRequest, NextResponse } from "next/server";
import { canManage, forbidden, getAdmin, getStringingStaff, setAdminCookie, unauthorized } from "@/lib/admin-auth";
import {
  approveAdmin,
  createAdmin,
  createInvite,
  declineAdmin,
  deleteAdmin,
  listAdmins,
  listInvites,
  revokeInvite,
  setAdminPassword,
  updateAdmin,
} from "@/lib/admin-users";
import { readJson, respond, serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// Staff accounts (the Staff tab), and registration links for the owner and managers. Scholars don't
// get the Staff tab: they may only change their own password here.
export async function GET(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  if (me.role === "scholar") return forbidden();
  try {
    const manage = canManage(me);
    const users = (await listAdmins())
      // Staff accounts see the team, not sign-ups or anyone's private details.
      .filter((u) => manage || !u.pending)
      .map((u) => (manage || u.id === me.id ? u : { ...u, birthdate: null, mobile: "", email: "" }));
    return NextResponse.json({ users, me, invites: manage ? await listInvites() : [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}

// { action: "create", firstName, lastName, birthdate?, mobile?, email?, username, password, role, stringer? }
// | { action: "update", id, firstName?, lastName?, birthdate?, mobile?, email?, active?, role?, stringer? }
// | { action: "approve", id, role?, stringer? } | { action: "decline", id }
// | { action: "password", id, password } | { action: "delete", id }
// | { action: "invite", label?, days, roles } | { action: "invite-off", id }
export async function POST(req: NextRequest) {
  const me = await getStringingStaff(req); // stringers too, for their own password
  if (!me) return unauthorized();
  try {
    const b = await readJson(req);
    // Staff, Scholars and Stringers may only change their own password; everything else is for the owner/managers.
    const ownPassword = b.action === "password" && me.id !== null && Number(b.id) === me.id;
    if (!ownPassword && !canManage(me)) return forbidden();
    if (b.action === "create") return respond(await createAdmin(b, me.name), 201);
    if (b.action === "update") return respond(await updateAdmin(b.id, b, me.id));
    if (b.action === "approve") return respond(await approveAdmin(b.id, b, me.name));
    if (b.action === "decline") return respond(await declineAdmin(b.id));
    if (b.action === "delete") return respond(await deleteAdmin(b.id, me.id));
    if (b.action === "invite") return respond(await createInvite(b, me.name), 201);
    if (b.action === "invite-off") return respond(await revokeInvite(b.id, me.name));
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
