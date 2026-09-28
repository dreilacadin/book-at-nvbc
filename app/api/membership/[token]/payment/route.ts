import { NextRequest } from "next/server";
import { readJson, respond, serverError } from "@/lib/http";
import { submitMembershipPayment } from "@/lib/memberships";

// Applicant chooses how they pay, and for GCash / QR Ph / BPI sends the reference and/or screenshot.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const body = await readJson(req);
    return respond(await submitMembershipPayment((await params).token, body.method, body.reference, body.proof));
  } catch (e) {
    return serverError(e);
  }
}
