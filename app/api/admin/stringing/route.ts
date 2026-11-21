import { NextRequest, NextResponse } from "next/server";
import { canManage, forbidden, getStringingStaff, unauthorized } from "@/lib/admin-auth";
import { readJson, respond, serverError } from "@/lib/http";
import { readTag } from "@/lib/stringing";
import {
  allStrings,
  createStringingOrder,
  customerByMobile,
  deleteString,
  deleteStringingOrder,
  editCustomer,
  editRacket,
  orderIdForTag,
  racketsForTags,
  recentFeedback,
  adjustStock,
  saveString,
  saveStringingPrices,
  setRemarks,
  setStringingPayment,
  smsTemplates,
  stepRackets,
  stringerReport,
  stringingOrder,
  stringingProof,
  stringingQueue,
  stockMoves,
} from "@/lib/stringings";
import { getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

// Staff and stringers. Stringers only see the queue (waiting, stringing, ready) and start/finish rackets.
//   ?view=waiting&q=…  the queue      ?order=<id>  one check-in     ?tag=127  the check-in a tag belongs to
//   ?proof=<id>        the screenshot  ?customer=<mobile>  earlier check-ins (staff check-in)
//   ?print=1&ids=a,b | ?print=1&order=<id>  rackets for their tags
//   ?strings=1  ?moves=<string id>  (staff)   ?feedback=1  ?report=1&from=…&to=…  (owner/manager)
export async function GET(req: NextRequest) {
  const me = await getStringingStaff(req);
  if (!me) return unauthorized();
  const stringer = me.role === "stringer";
  const q = req.nextUrl.searchParams;
  try {
    if (q.has("tag")) {
      const tag = readTag(q.get("tag"));
      const id = tag === null ? null : await orderIdForTag(tag);
      if (!id) return NextResponse.json({ error: "No racket with that tag number." }, { status: 404 });
      return NextResponse.json({ orderId: stringer ? null : id }, { headers: noStore });
    }
    if (!["order", "proof", "customer", "strings", "moves", "feedback", "report", "print"].some((k) => q.has(k)))
      return NextResponse.json(await stringingQueue(q.get("view"), q.get("q"), stringer), { headers: noStore });
    if (stringer) return forbidden();
    if (q.has("print"))
      return NextResponse.json({
        rackets: await racketsForTags((q.get("ids") ?? "").split(","), q.get("order")),
        qr: (await getSettings()).stringing.tagQr,
      }, { headers: noStore });
    if (q.has("order")) return respond(await stringingOrder(q.get("order") ?? ""));
    if (q.has("proof")) {
      const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(await stringingProof(q.get("proof") ?? ""));
      if (!m) return NextResponse.json({ error: "No screenshot." }, { status: 404 });
      return new NextResponse(Buffer.from(m[2], "base64"), {
        headers: { "Content-Type": m[1], "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      });
    }
    if (q.has("customer")) return NextResponse.json({ customer: await customerByMobile(q.get("customer")) }, { headers: noStore });
    if (q.has("strings")) return NextResponse.json({ strings: await allStrings() }, { headers: noStore });
    if (q.has("moves")) return NextResponse.json({ moves: await stockMoves(q.get("moves")) }, { headers: noStore });
    if (!canManage(me)) return forbidden();
    if (q.has("feedback")) return NextResponse.json({ feedback: await recentFeedback() }, { headers: noStore });
    return respond(await stringerReport(q.get("from"), q.get("to")));
  } catch (e) {
    return serverError(e);
  }
}

// { action: "step", ids, step: "receive" | "start" | "done" | "pickup" | "undo" | "cancel", paidMethod? } (received by: the logged-in staff)
// { action: "create", …check-in, receive?, paidMethod? }   { action: "edit", id, …racket }
// { action: "customer", id, name, mobile, email }   { action: "payment", id, status, method?, reference?, note? }
// { action: "remarks", id, remarks } (stringers too, like "step")
// { action: "sms", id }   { action: "string-save", … }   { action: "string-stock", id, mode: "add" | "set", counts: {colour: sets}, note? }
// owner/manager: { action: "delete", id } | "string-delete" | "prices"
export async function POST(req: NextRequest) {
  const me = await getStringingStaff(req);
  if (!me) return unauthorized();
  const stringer = me.role === "stringer";
  try {
    const b = await readJson(req);
    if (b.action === "step") return respond(await stepRackets(b.ids, b.step, { name: me.name, stringer, strings: me.strings }, b));
    if (b.action === "remarks") return respond(await setRemarks(String(b.id ?? ""), b.remarks, me.name));
    if (stringer) return forbidden();
    if (b.action === "create") return respond(await createStringingOrder(b as Parameters<typeof createStringingOrder>[0], me.name), 201);
    if (b.action === "edit") return respond(await editRacket(String(b.id ?? ""), b, me.name));
    if (b.action === "customer") return respond(await editCustomer(String(b.id ?? ""), b, me.name));
    if (b.action === "payment") return respond(await setStringingPayment(String(b.id ?? ""), b, me.name));
    if (b.action === "sms") return respond(await smsTemplates(String(b.id ?? "")));
    if (b.action === "string-save") return respond(await saveString(b, me.name));
    if (b.action === "string-stock") return respond(await adjustStock(b.id, b, me.name));
    if (!canManage(me)) return forbidden();
    if (b.action === "delete") return respond(await deleteStringingOrder(String(b.id ?? ""), me.name));
    if (b.action === "string-delete") return respond(await deleteString(b.id));
    if (b.action === "prices") return respond(await saveStringingPrices(b.prices));
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
