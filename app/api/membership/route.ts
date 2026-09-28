import { NextRequest, NextResponse } from "next/server";
import { readJson, respond, serverError } from "@/lib/http";
import { applyForMembership } from "@/lib/memberships";
import { getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

// Public: membership fees, for the sign-up page.
export async function GET() {
  try {
    const s = await getSettings();
    return NextResponse.json({ fees: { student: s.membership_fee_student, adult: s.membership_fee_adult } });
  } catch (e) {
    return serverError(e);
  }
}

// Public: apply for membership. Returns the secret token for the applicant's status page.
export async function POST(req: NextRequest) {
  try {
    return respond(await applyForMembership(await readJson(req)), 201);
  } catch (e) {
    return serverError(e);
  }
}
