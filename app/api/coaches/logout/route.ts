import { NextResponse } from "next/server";
import { clearCoachCookie } from "@/lib/coach-auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearCoachCookie(res);
  return res;
}
