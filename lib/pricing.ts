// Pricing and payment definitions shared by the server and the browser.

export const RATE_TYPES = [
  { id: "regular", label: "Regular" },
  { id: "member", label: "Member" },
  { id: "coach", label: "Coach" },
] as const;
export type RateType = (typeof RATE_TYPES)[number]["id"];
export const isRateType = (v: unknown): v is RateType => RATE_TYPES.some((r) => r.id === v);
export const rateTypeLabel = (id: string) => RATE_TYPES.find((r) => r.id === id)?.label ?? id;

export const PAYMENT_METHODS = [
  { id: "cash", label: "Cash", hint: "Pay at the front desk" },
  { id: "gcash", label: "GCash", hint: "Send to our GCash number" },
  { id: "qrph", label: "QR Ph", hint: "Scan with any bank or e-wallet app" },
  { id: "bpi", label: "BPI transfer", hint: "Bank transfer to our BPI account" },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["id"];
export const isPaymentMethod = (v: unknown): v is PaymentMethod => PAYMENT_METHODS.some((m) => m.id === v);
export const paymentLabel = (id: string) => PAYMENT_METHODS.find((m) => m.id === id)?.label ?? id;

export const PAYMENT_STATUSES = [
  { id: "unpaid", label: "Unpaid" },
  { id: "for_verification", label: "For verification" },
  { id: "paid", label: "Paid" },
  { id: "waived", label: "No charge" },
  { id: "refunded", label: "Refunded" },
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]["id"];
export const isPaymentStatus = (v: unknown): v is PaymentStatus => PAYMENT_STATUSES.some((s) => s.id === v);
export const paymentStatusLabel = (id: string) => PAYMENT_STATUSES.find((s) => s.id === id)?.label ?? id;

export type BookingStatus = "pending" | "confirmed" | "cancelled";

/**
 * Every booking is "pending" until staff record the payment as received (Paid, or No charge) —
 * whatever the payment method, cash included. Nothing to pay (₱0) → confirmed.
 */
export function activeBookingStatus(paymentStatus: PaymentStatus, amount: number): "pending" | "confirmed" {
  return amount > 0 && paymentStatus !== "paid" && paymentStatus !== "waived" ? "pending" : "confirmed";
}

export const bookingStatusLabel = (s: string) =>
  s === "pending" ? "Pending" : s === "confirmed" ? "Confirmed" : s === "cancelled" ? "Cancelled" : s;

/** Hourly prices for one sport: regular, member and coach (₱ per court per hour). */
export type SportRates = { regular: number; member: number; coach: number };

export function rateFor(rates: SportRates, rateType: RateType): number {
  return rates[rateType] ?? rates.regular;
}

/**
 * A sport's full price plan, set in /admin → Settings.
 * - memberRates off: everyone pays one standard rate (member/coach are not offered).
 * - weekendRates off: Saturdays and Sundays use the weekday prices.
 */
export type SportPricing = {
  memberRates: boolean;
  weekendRates: boolean;
  weekday: SportRates;
  weekend: SportRates;
};

/** Saturday or Sunday ("YYYY-MM-DD"). */
export function isWeekend(date: string): boolean {
  const day = new Date(date + "T00:00:00Z").getUTCDay();
  return day === 0 || day === 6;
}

/** The prices that apply on a date. Without member rates, member/coach equal the standard rate. */
export function ratesForDate(p: SportPricing, date: string): SportRates {
  const r = p.weekendRates && isWeekend(date) ? p.weekend : p.weekday;
  return p.memberRates ? { ...r } : { regular: r.regular, member: r.regular, coach: r.regular };
}

/** Rate types players can choose for a sport. */
export function rateTypesFor(p: { memberRates: boolean }): RateType[] {
  return p.memberRates ? RATE_TYPES.map((r) => r.id) : ["regular"];
}

const money = (v: unknown, fallback: number) => {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? fallback : n;
};

function toRates(raw: unknown, fallback: SportRates): SportRates {
  const src = (raw ?? {}) as Record<string, unknown>;
  const regular = money(src.regular, fallback.regular);
  // A new regular price with no member/coach price → same as regular; nothing stored → the fallback's.
  const base = src.regular === undefined ? fallback : { regular, member: regular, coach: regular };
  return { regular, member: money(src.member, base.member), coach: money(src.coach, base.coach) };
}

/** Reads a stored price plan, filling anything missing from `fallback` (the pre-v6 prices). */
export function toSportPricing(raw: unknown, fallback: SportRates): SportPricing {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const weekday = toRates(src.weekday, fallback);
  return {
    memberRates: src.memberRates !== false,
    weekendRates: src.weekendRates === true,
    weekday,
    weekend: toRates(src.weekend, weekday),
  };
}

export type Price = {
  hourlyRate: number; // the rate actually charged
  regularRate: number;
  hours: number;
  total: number;
  savings: number; // vs. the regular rate (0 if none)
};

/** Price in pesos, rounded to the centavo. */
export function computePrice(hourlyRate: number, hours: number, regularRate = hourlyRate): Price {
  const total = Math.round(hourlyRate * hours * 100) / 100;
  const regularTotal = Math.round(regularRate * hours * 100) / 100;
  return { hourlyRate, regularRate, hours, total, savings: Math.max(0, Math.round((regularTotal - total) * 100) / 100) };
}

export function formatPeso(n: number): string {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

/** Largest payment screenshot accepted (as a data: URL). The browser shrinks uploads well below this. */
export const MAX_PROOF_CHARS = 1_000_000; // ~700 KB image

/** A payment screenshot: a PNG/JPEG/WebP data: URL under the size limit. */
export function isProofImage(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length <= MAX_PROOF_CHARS &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
  );
}

/** Online payments need proof: a reference number, a screenshot, or both. */
export const hasPaymentProof = (ref: string, proof: string) => ref.trim() !== "" || proof !== "";

/** What players see about payments (no staff-only data). */
export type PaymentInfo = {
  methods: PaymentMethod[];
  gcashName: string;
  gcashNumber: string;
  bpiAccountName: string;
  bpiAccountNumber: string;
  qrphImage: string;
  note: string;
};
