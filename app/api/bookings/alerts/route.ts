import { NextRequest, NextResponse } from "next/server";
import { normalizeCode } from "@/lib/bookings";
import { customerAlerts, removeCustomerPush, saveCustomerPush, setCustomerEmail } from "@/lib/customer-notify";
import { readJson, serverError } from "@/lib/http";

export const dynamic = "force-dynamic";

// Public, by booking code (whoever has the code manages the booking): notifications about it.
// { code, action: "status", endpoint? } | { code, action: "push-on", subscription }
// | { code, action: "push-off", endpoint } | { code, action: "email", email }   ("" = stop emails)
export async function POST(req: NextRequest) {
  try {
    const b = await readJson(req);
    const code = normalizeCode(b.code);
    if (!code) return NextResponse.json({ error: "Booking codes look like NV-ABC123." }, { status: 400 });
    const bad = (error: string | null) => (error ? NextResponse.json({ error }, { status: 400 }) : null);
    if (b.action === "push-on") {
      const r = bad(await saveCustomerPush(code, b.subscription));
      if (r) return r;
    } else if (b.action === "push-off") {
      await removeCustomerPush(code, b.endpoint);
    } else if (b.action === "email") {
      const r = bad(await setCustomerEmail(code, b.email));
      if (r) return r;
    } else if (b.action !== "status") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    const status = await customerAlerts(code, b.action === "push-on" ? (b.subscription as { endpoint?: unknown })?.endpoint : b.endpoint);
    if (!status) return NextResponse.json({ error: "No booking found with that code." }, { status: 404 });
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return serverError(e);
  }
}
