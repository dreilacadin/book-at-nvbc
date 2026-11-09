import { NextRequest, NextResponse } from "next/server";
import { readJson, respond, serverError } from "@/lib/http";
import { checkOnDeckVoucher, onDeckAuthError, redeemOnDeckVoucher, undoOnDeckRedemption } from "@/lib/ondeck";

export const dynamic = "force-dynamic";

// NVBC On Deck's server only (Authorization: Bearer <ONDECK_API_KEY>), never a browser:
//   { action: "check", code, date?, sport? }                   → { voucher }
//   { action: "redeem", code, ref, date?, sport?, player?, by? } → { redemption, voucher }
//   { action: "undo", code, ref, by?, reason? }                 → { undone, voucher }
// See docs/ondeck-vouchers.md.
export async function POST(req: NextRequest) {
  const denied = await onDeckAuthError(req);
  if (denied) return denied;
  try {
    const b = await readJson(req);
    const headers = { "Cache-Control": "no-store" };
    const send = (r: Response) => (r.headers.set("Cache-Control", "no-store"), r);
    if (b.action === "check") return send(respond(await checkOnDeckVoucher(b)));
    if (b.action === "redeem") return send(respond(await redeemOnDeckVoucher(b)));
    if (b.action === "undo") return send(respond(await undoOnDeckRedemption(b)));
    return NextResponse.json({ error: 'action must be "check", "redeem" or "undo".' }, { status: 400, headers });
  } catch (e) {
    return serverError(e);
  }
}
