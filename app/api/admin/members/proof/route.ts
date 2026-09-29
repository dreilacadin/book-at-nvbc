import { NextRequest, NextResponse } from "next/server";
import { isAdmin, unauthorized } from "@/lib/admin-auth";
import { serverError } from "@/lib/http";
import { membershipProof } from "@/lib/memberships";

export const dynamic = "force-dynamic";

// Admin only: the membership-fee receipt screenshot, served as an image (?id=<membership id>).
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return unauthorized();
  try {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec((await membershipProof(req.nextUrl.searchParams.get("id") ?? "")) ?? "");
    if (!m) return NextResponse.json({ error: "No screenshot." }, { status: 404 });
    return new NextResponse(Buffer.from(m[2], "base64"), {
      headers: { "Content-Type": m[1], "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return serverError(e);
  }
}
