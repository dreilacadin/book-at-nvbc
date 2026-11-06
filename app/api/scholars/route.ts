import { NextRequest } from "next/server";
import { readJson, respond, serverError } from "@/lib/http";
import { applyToBeScholar } from "@/lib/scholars";

export const dynamic = "force-dynamic";

// Public: apply to be an NVBC Scholar. Returns the secret token for the guardian's consent link.
export async function POST(req: NextRequest) {
  try {
    return respond(await applyToBeScholar(await readJson(req)), 201);
  } catch (e) {
    return serverError(e);
  }
}
