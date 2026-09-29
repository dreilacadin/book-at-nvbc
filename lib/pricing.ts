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

export type BookingStatus = "pending" | "reserved" | "confirmed" | "cancelled";
export type ActiveStatus = "pending" | "reserved" | "confirmed";

/**
 * A booking is confirmed only once staff record the payment as received (Paid, or No charge).
 * Until then: "reserved" when it's to be paid in cash at the desk (coaches), otherwise "pending"
 * (waiting for / verifying an online payment). Nothing to pay (₱0) → confirmed.
 */
export function activeBookingStatus(method: PaymentMethod, paymentStatus: PaymentStatus, amount: number): ActiveStatus {
  if (amount <= 0 || paymentStatus === "paid" || paymentStatus === "waived") return "confirmed";
  return method === "cash" ? "reserved" : "pending";
}

export const bookingStatusLabel = (s: string) =>
  ({ pending: "Pending", reserved: "Reserved", confirmed: "Confirmed", cancelled: "Cancelled" })[s] ?? s;

/** Booking statuses that hold a court (everything except cancelled). */
export const isActiveStatus = (s: string): s is ActiveStatus => s === "pending" || s === "reserved" || s === "confirmed";

/** Hourly prices for one sport: regular, member and coach (₱ per court per hour). */
export type SportRates = { regular: number; member: number; coach: number };

export function rateFor(rates: SportRates, rateType: RateType): number {
  return rates[rateType] ?? rates.regular;
}

/**
 * A sport's full price plan, set in /admin → Settings.
 * - memberRates off: the Member rate isn't offered (members pay the regular rate).
 * - coachRates off: the Coach rate isn't offered. Both off → one standard rate for everyone.
 * - weekendRates off: Saturdays and Sundays use the weekday prices.
 */
export type SportPricing = {
  memberRates: boolean;
  coachRates: boolean;
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
  return { regular: r.regular, member: p.memberRates ? r.member : r.regular, coach: p.coachRates ? r.coach : r.regular };
}

/** Rate types players can choose for a sport. */
export function rateTypesFor(p: { memberRates: boolean; coachRates: boolean }): RateType[] {
  return RATE_TYPES.map((r) => r.id).filter((id) => id === "regular" || (id === "member" ? p.memberRates : p.coachRates));
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
    // Plans saved before the coach switch existed had one switch for both.
    coachRates: typeof src.coachRates === "boolean" ? src.coachRates : src.memberRates !== false,
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
