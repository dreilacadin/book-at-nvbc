import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/http";
import { getMembershipView } from "@/lib/memberships";

export const dynamic = "force-dynamic";

// Public, but only with the secret token from the applicant's link: status, payment and member QR.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const r = await getMembershipView((await params).token);
    return r.ok
      ? NextResponse.json(r.data, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } })
      : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (e) {
    return serverError(e);
  }
}
