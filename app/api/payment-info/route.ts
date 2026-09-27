import { NextResponse } from "next/server";
import { getPaymentInfo } from "@/lib/bookings";
import { serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// Public: how to pay (GCash number, BPI account, QR Ph image). No staff-only data.
export async function GET() {
  try {
    return NextResponse.json(await getPaymentInfo(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}
