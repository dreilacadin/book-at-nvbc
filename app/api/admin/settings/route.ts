import { NextRequest, NextResponse } from "next/server";
import { isAdmin, unauthorized } from "@/lib/admin-auth";
import { db, getSettings } from "@/lib/db";
import { readJson, serverError } from "@/lib/http";
import { isPaymentMethod, MAX_EXTRA_GCASH, rateTypeLabel, type RateType, type SportPricing, type SportRates } from "@/lib/pricing";
import { SPORTS } from "@/lib/sports";

export const dynamic = "force-dynamic";

const MAX_QR_CHARS = 700_000; // ~500 KB image; the admin page shrinks uploads well below this

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return unauthorized();
  try {
    return NextResponse.json(await getSettings());
  } catch (e) {
    return serverError(e);
  }
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return unauthorized();
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

    // Price plan per sport (₱ per court per hour). Prices that are switched off are still
    // kept (or copied from the ones in use), so switching back on restores them.
    const plansIn = (b.rate_plans ?? {}) as Record<string, Record<string, unknown>>;
    const rate_plans: Record<string, SportPricing> = {};
    for (const sp of SPORTS) {
      const src = plansIn[sp.id] ?? {};
      const memberRates = src.memberRates === true;
      const coachRates = src.coachRates === true;
      const weekendRates = src.weekendRates === true;
      // A valid price, the fallback (for a price that is switched off), or an error message.
      const price = (day: "weekday" | "weekend", type: RateType, fallback?: number): number | string => {
        const raw = ((src[day] ?? {}) as Record<string, unknown>)[type];
        const r = Number(raw);
        if (raw === "" || raw === null || raw === undefined || !Number.isFinite(r) || r < 0 || r > 100_000) {
          if (fallback !== undefined) return fallback;
          const who = memberRates || coachRates ? `${rateTypeLabel(type).toLowerCase()} ` : "";
          return `Enter a valid ${day} ${who}price for ${sp.label}.`;
        }
        return Math.round(r * 100) / 100;
      };
      const readDay = (day: "weekday" | "weekend", off?: SportRates): SportRates | string => {
        const regular = price(day, "regular", off?.regular);
        if (typeof regular === "string") return regular;
        const member = price(day, "member", memberRates && !off ? undefined : off?.member ?? regular);
        if (typeof member === "string") return member;
        const coach = price(day, "coach", coachRates && !off ? undefined : off?.coach ?? regular);
        if (typeof coach === "string") return coach;
        return { regular, member, coach };
      };
      const weekday = readDay("weekday");
      if (typeof weekday === "string") return bad(weekday);
      const weekend = readDay("weekend", weekendRates ? undefined : weekday);
      if (typeof weekend === "string") return bad(weekend);
      rate_plans[sp.id] = { memberRates, coachRates, weekendRates, weekday, weekend };
    }

    // Payment methods
    const methods = Array.isArray(b.payment_methods) ? b.payment_methods.filter(isPaymentMethod) : [];
    const payment_methods = [...new Set(methods)];
    if (payment_methods.length === 0) return bad("Turn on at least one payment method.");
    if (payment_methods.includes("gcash") && !s.gcash_number) return bad("Enter the GCash number, or turn GCash off.");

    // Extra GCash accounts. Blank rows are dropped; older admin pages don't send them (keep them).
    const current = await getSettings();
    let gcashMore = current.gcash_more;
    if (b.gcash_more !== undefined) {
      if (!Array.isArray(b.gcash_more)) return bad("Invalid extra GCash accounts.");
      gcashMore = b.gcash_more
        .map((a: { name?: unknown; number?: unknown }) => ({ name: text(a?.name, 80), number: text(a?.number, 40) }))
        .filter((a) => a.name || a.number);
      if (gcashMore.some((a) => !a.number)) return bad("Enter the number for each extra GCash account, or remove it.");
      if (gcashMore.length > MAX_EXTRA_GCASH) return bad(`You can add up to ${MAX_EXTRA_GCASH} extra GCash accounts.`);
      const numbers = [s.gcash_number, ...gcashMore.map((a) => a.number)].map((x) => x.replace(/\D/g, "")).filter(Boolean);
      if (new Set(numbers).size !== numbers.length) return bad("The same GCash number is listed twice.");
    }
    if (payment_methods.includes("bpi") && !s.bpi_account_number)
      return bad("Enter the BPI account number, or turn BPI transfer off.");
    if (payment_methods.includes("qrph") && !s.qrph_image) return bad("Upload the QR Ph code image, or turn QR Ph off.");
    if (s.qrph_image && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s.qrph_image) || s.qrph_image.length > MAX_QR_CHARS))
      return bad("The QR image must be a PNG, JPG or WebP under 500 KB.");

    // Membership fees (₱). Missing values keep the current fee (older admin pages don't send them).
    const fee = (v: unknown, keep: number) => (v === undefined || v === null || v === "" ? keep : Number(v));
    const feeStudent = fee(b.membership_fee_student, current.membership_fee_student);
    const feeAdult = fee(b.membership_fee_adult, current.membership_fee_adult);
    if (![feeStudent, feeAdult].every((f) => Number.isFinite(f) && f >= 0 && f <= 100_000))
      return bad("Enter valid membership fees.");

    await db().query(
      `UPDATE settings SET
         open_hour = $1, close_hour = $2, max_hours_per_booking = $3, max_hours_per_day = $4,
         booking_window_days = $5, announcement = $6,
         rate_plans = $7::jsonb,
         member_code = $8, coach_code = $9, payment_methods = $10::text[],
         gcash_name = $11, gcash_number = $12, bpi_account_name = $13, bpi_account_number = $14,
         qrph_image = $15, payment_note = $16, membership_fee_student = $17, membership_fee_adult = $18,
         gcash_more = $19::jsonb
       WHERE id = 1`,
      [
        s.open_hour, s.close_hour, s.max_hours_per_booking, s.max_hours_per_day, s.booking_window_days, s.announcement,
        JSON.stringify(rate_plans), s.member_code, s.coach_code,
        `{${payment_methods.join(",")}}`,
        s.gcash_name, s.gcash_number, s.bpi_account_name, s.bpi_account_number, s.qrph_image, s.payment_note,
        Math.round(feeStudent * 100) / 100, Math.round(feeAdult * 100) / 100,
        JSON.stringify(gcashMore),
      ]
    );
    return NextResponse.json(await getSettings());
  } catch (e) {
    return serverError(e);
  }
}
