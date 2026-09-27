import { NextResponse } from "next/server";
import { clearAdminCookie } from "@/lib/admin-auth";

export async function POST() {
  const res = NextResponse.json({ loggedIn: false });
  clearAdminCookie(res);
  return res;
}
