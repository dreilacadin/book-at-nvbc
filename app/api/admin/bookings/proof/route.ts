import { NextRequest, NextResponse } from "next/server";
import { isAdmin, unauthorized } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// Admin only: the payment screenshot a player uploaded, served as an image (?id=<booking id>).
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return unauthorized();
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid booking id." }, { status: 400 });
  try {
    const { rows } = await db().query<{ payment_proof: string }>(`SELECT payment_proof FROM bookings WHERE id = $1`, [id]);
    const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(rows[0]?.payment_proof ?? "");
    if (!m) return NextResponse.json({ error: "No screenshot for this booking." }, { status: 404 });
    return new NextResponse(Buffer.from(m[2], "base64"), {
      headers: { "Content-Type": m[1], "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return serverError(e);
  }
}
