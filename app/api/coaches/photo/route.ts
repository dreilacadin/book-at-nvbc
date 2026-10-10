import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin-auth";
import { getCoach } from "@/lib/coach-auth";
import { coachPhoto } from "@/lib/coaches";
import { serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// ?id=<coach>[&kind=id]: the profile photo (public for active coaches) or the ID photo (staff and the coach only).
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const kind = req.nextUrl.searchParams.get("kind") === "id" ? "id" : "photo";
    const [staff, coach] = await Promise.all([getAdmin(req), getCoach(req)]);
    const url = await coachPhoto(id, kind, !!staff, coach?.id === id);
    const m = url ? /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(url) : null;
    if (!m) return NextResponse.json({ error: "No photo." }, { status: 404 });
    return new NextResponse(Buffer.from(m[2], "base64"), {
      headers: { "Content-Type": m[1], "Cache-Control": kind === "id" ? "private, no-store" : "public, max-age=300", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return serverError(e);
  }
}
