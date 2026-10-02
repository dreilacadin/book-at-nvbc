import { NextRequest, NextResponse } from "next/server";
import { canManage, forbidden, getAdmin, isAdmin, unauthorized } from "@/lib/admin-auth";
import { readJson, respond, serverError } from "@/lib/http";
import { emailSender } from "@/lib/mailer";
import {
  importMembers,
  approveMembership,
  deleteMembership,
  forfeitMembership,
  markReminded,
  markRemindedMany,
  sendReminderEmails,
  sendTestReminder,
  updateMembership,
  findByMemberCode,
  listMemberships,
  rejectMembership,
  renewMembership,
  setMembershipPayment,
} from "@/lib/memberships";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // sending a batch of reminder emails can take a few seconds

// Admin only: all applications and members, or one member by code (?code=, from a QR scan).
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return unauthorized();
  try {
    const code = req.nextUrl.searchParams.get("code");
    if (code !== null) return respond(await findByMemberCode(code));
    const sender = emailSender();
    return NextResponse.json(
      { members: await listMemberships(), email: sender ? { ready: true, from: sender.address } : { ready: false } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return serverError(e);
  }
}

// { action: "payment", id, status } | { action: "approve", id } | { action: "renew", id }
// | { action: "reject", id, reason? } | { action: "delete", id }
// | { action: "update", id, fullName, email, mobile, …, startsOn, expiresOn }
// | { action: "forfeit", id, reason? } | { action: "remind", id } | { action: "remind", ids: [...] }  (expired)
// | { action: "import", records, dryRun }
// | { action: "email", ids, subject, body }  (reminders to expired members, up to 10 per call)
// | { action: "email-test", id, subject, body }  (one filled-in reminder to the club's own address)  (existing members from a spreadsheet)
export async function POST(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  try {
    const b = await readJson(req);
    const id = String(b.id ?? "");
    // Deleting members, importing and bulk emails: owner/managers only.
    if (["delete", "import", "email", "email-test"].includes(String(b.action)) && !canManage(me)) return forbidden();
    if (b.action === "email") return respond(await sendReminderEmails(b.ids, b.subject, b.body, req.nextUrl.origin));
    if (b.action === "email-test") return respond(await sendTestReminder(b.id, b.subject, b.body, req.nextUrl.origin));
    if (b.action === "import") return respond(await importMembers(b.records, b.dryRun !== false));
    if (b.action === "payment") return respond(await setMembershipPayment(id, b.status));
    if (b.action === "approve") return respond(await approveMembership(id));
    if (b.action === "forfeit") return respond(await forfeitMembership(id, b.reason));
    if (b.action === "remind" && Array.isArray(b.ids)) return respond(await markRemindedMany(b.ids));
    if (b.action === "remind") return respond(await markReminded(id));
    if (b.action === "renew") return respond(await renewMembership(id));
    if (b.action === "reject") return respond(await rejectMembership(id, b.reason));
    if (b.action === "update") return respond(await updateMembership(id, b));
    if (b.action === "delete") return respond(await deleteMembership(id));
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
