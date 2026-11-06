import { NextRequest, NextResponse } from "next/server";
import { readJson, respond, serverError } from "@/lib/http";
import { getConsentView, submitGuardianConsent } from "@/lib/scholars";

export const dynamic = "force-dynamic";

// Public, but only with the secret token from the consent link.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const r = await getConsentView((await params).token);
    return r.ok
      ? NextResponse.json(r.data, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } })
      : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    return respond(await submitGuardianConsent((await params).token, await readJson(req)));
  } catch (e) {
    return serverError(e);
  }
}
