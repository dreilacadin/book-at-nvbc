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

/** Hourly prices for one sport: regular, member and coach (₱ per court per hour). */
export type SportRates = { regular: number; member: number; coach: number };

export function rateFor(rates: SportRates, rateType: RateType): number {
  return rates[rateType] ?? rates.regular;
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
