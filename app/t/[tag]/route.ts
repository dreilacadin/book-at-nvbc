import { NextRequest, NextResponse } from "next/server";

// The short link in a label-printer tag's QR code (/t/127), so it fits a small QR code on a 12 mm
// label. Opens the racket in the staff page, as the A4 tags' /admin?tag=127 does.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  const to = new URL(/^\d{1,7}$/.test(tag) ? `/admin?tag=${tag}` : "/admin?tab=stringing", req.nextUrl.origin);
  return NextResponse.redirect(to, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
