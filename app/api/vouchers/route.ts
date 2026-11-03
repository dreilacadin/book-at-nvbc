import { NextRequest } from "next/server";
import { readJson, respond, serverError } from "@/lib/http";
import { guardVoucherCode } from "@/lib/throttle";
import { publicVoucher } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

// Public: { code } → the voucher page's details (what it's worth, what's left, dates, terms).
// Unknown codes count towards a per-visitor limit (see guardVoucherCode).
export async function POST(req: NextRequest) {
  return guardVoucherCode(req, async () => {
    try {
      return respond(await publicVoucher((await readJson(req)).code));
    } catch (e) {
      return serverError(e);
    }
  });
}
