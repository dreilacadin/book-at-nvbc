import { NextRequest, NextResponse } from "next/server";
import { canManage, forbidden, getAdmin, unauthorized } from "@/lib/admin-auth";
import { readJson, respond, serverError } from "@/lib/http";
import { createVouchers, deleteVouchers, listVouchers, setVoucherStatus, updateVoucher, voucherDetail, vouchersByIds } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

// All staff: the vouchers (?q= to search), one voucher with its uses and history (?id=), or several
// to print (?ids=a,b,c).
export async function GET(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (id) return respond(await voucherDetail(id));
    const ids = req.nextUrl.searchParams.get("ids");
    if (ids) return NextResponse.json({ vouchers: await vouchersByIds(ids.split(",")) }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ vouchers: await listVouchers(req.nextUrl.searchParams.get("q") ?? "") }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}

// Owner/managers: { action: "create", kind, value, quantity, … } | { action: "update", id, … }
//                 | { action: "status", id, status: "active" | "paused" | "void", reason? } | { action: "delete", ids }
export async function POST(req: NextRequest) {
  const me = await getAdmin(req);
  if (!me) return unauthorized();
  if (!canManage(me)) return forbidden();
  try {
    const b = await readJson(req);
    if (b.action === "create") return respond(await createVouchers(b, me.name), 201);
    if (b.action === "update") return respond(await updateVoucher(String(b.id ?? ""), b, me.name));
    if (b.action === "status") return respond(await setVoucherStatus(String(b.id ?? ""), b.status, me.name, b.reason));
    if (b.action === "delete") return respond(await deleteVouchers(b.ids, me.name));
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return serverError(e);
  }
}
