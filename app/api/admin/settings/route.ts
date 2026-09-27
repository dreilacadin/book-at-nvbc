import { NextRequest, NextResponse } from "next/server";
import { isAdmin, unauthorized } from "@/lib/admin-auth";
import { db, getSettings } from "@/lib/db";
import { readJson, serverError } from "@/lib/http";
import { isPaymentMethod } from "@/lib/pricing";
import { SPORTS } from "@/lib/sports";

export const dynamic = "force-dynamic";

const MAX_QR_CHARS = 700_000; // ~500 KB image; the admin page shrinks uploads well below this

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  try {
    return NextResponse.json(await getSettings());
  } catch (e) {
    return serverError(e);
  }
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const b = await readJson(req);
    const n = (k: string) => Number(b[k]);

    const s = {
      open_hour: n("open_hour"),
      close_hour: n("close_hour"),
      max_hours_per_booking: n("max_hours_per_booking"),
      max_hours_per_day: n("max_hours_per_day"),
      booking_window_days: n("booking_window_days"),
      announcement: text(b.announcement, 300),
      member_discount_pct: n("member_discount_pct"),
      coach_discount_pct: n("coach_discount_pct"),
      member_code: text(b.member_code, 40),
      coach_code: text(b.coach_code, 40),
      gcash_name: text(b.gcash_name, 80),
      gcash_number: text(b.gcash_number, 40),
      bpi_account_name: text(b.bpi_account_name, 80),
      bpi_account_number: text(b.bpi_account_number, 40),
      payment_note: text(b.payment_note, 300),
      qrph_image: typeof b.qrph_image === "string" ? b.qrph_image : "",
    };

    const ints = [s.open_hour, s.close_hour, s.max_hours_per_booking, s.max_hours_per_day, s.booking_window_days];
    if (!ints.every(Number.isInteger)) return bad("Hours and days must be whole numbers.");
    if (s.open_hour < 0 || s.close_hour > 24 || s.close_hour <= s.open_hour)
      return bad("Closing time must be after opening time.");
    if (s.max_hours_per_booking < 1 || s.max_hours_per_booking > 12 || s.max_hours_per_day < 1 || s.max_hours_per_day > 24)
      return bad("Hour limits are out of range.");
    if (s.booking_window_days < 0 || s.booking_window_days > 90) return bad("Booking window must be 0–90 days.");

    // Rates per sport
    const ratesIn = (b.hourly_rates ?? {}) as Record<string, unknown>;
    const hourly_rates: Record<string, number> = {};
    for (const sp of SPORTS) {
      const r = Number(ratesIn[sp.id]);
      if (!Number.isFinite(r) || r < 0 || r > 100_000) return bad(`Enter a valid hourly rate for ${sp.label}.`);
      hourly_rates[sp.id] = Math.round(r * 100) / 100;
    }

    for (const [label, v] of [["Member", s.member_discount_pct], ["Coach", s.coach_discount_pct]] as const)
      if (!Number.isFinite(v) || v < 0 || v > 100) return bad(`${label} discount must be 0–100%.`);

    // Payment methods
    const methods = Array.isArray(b.payment_methods) ? b.payment_methods.filter(isPaymentMethod) : [];
    const payment_methods = [...new Set(methods)];
    if (payment_methods.length === 0) return bad("Turn on at least one payment method.");
    if (payment_methods.includes("gcash") && !s.gcash_number) return bad("Enter the GCash number, or turn GCash off.");
    if (payment_methods.includes("bpi") && !s.bpi_account_number)
      return bad("Enter the BPI account number, or turn BPI transfer off.");
    if (payment_methods.includes("qrph") && !s.qrph_image) return bad("Upload the QR Ph code image, or turn QR Ph off.");
    if (s.qrph_image && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s.qrph_image) || s.qrph_image.length > MAX_QR_CHARS))
      return bad("The QR image must be a PNG, JPG or WebP under 500 KB.");

    await db().query(
      `UPDATE settings SET
         open_hour = $1, close_hour = $2, max_hours_per_booking = $3, max_hours_per_day = $4,
         booking_window_days = $5, announcement = $6,
         hourly_rates = $7::jsonb, member_discount_pct = $8, coach_discount_pct = $9,
         member_code = $10, coach_code = $11, payment_methods = $12::text[],
         gcash_name = $13, gcash_number = $14, bpi_account_name = $15, bpi_account_number = $16,
         qrph_image = $17, payment_note = $18
       WHERE id = 1`,
      [
        s.open_hour, s.close_hour, s.max_hours_per_booking, s.max_hours_per_day, s.booking_window_days, s.announcement,
        JSON.stringify(hourly_rates), s.member_discount_pct, s.coach_discount_pct, s.member_code, s.coach_code,
        `{${payment_methods.join(",")}}`,
        s.gcash_name, s.gcash_number, s.bpi_account_name, s.bpi_account_number, s.qrph_image, s.payment_note,
      ]
    );
    return NextResponse.json(await getSettings());
  } catch (e) {
    return serverError(e);
  }
}
