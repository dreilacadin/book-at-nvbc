import { NextResponse } from "next/server";
import type { Result } from "./bookings";

export function respond<T>(r: Result<T>, okStatus = 200) {
  return r.ok
    ? NextResponse.json(r.data, { status: okStatus })
    : NextResponse.json({ error: r.error }, { status: r.status });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

export function serverError(e: unknown) {
  console.error(e);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
