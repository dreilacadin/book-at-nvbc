// Vouchers: what each kind is worth on a booking, when one can be used, and its terms. Shared by
// the server and the browser (no Node imports), so it can be tested.
import { formatDateLong } from "./format.ts";
import { sportLabel } from "./sports.ts";

export const VOUCHER_KINDS = [
  { id: "free_hours", label: "Free court hours", hint: "A number of court hours for free. Unused hours stay on the voucher." },
  { id: "fixed", label: "Fixed discount", hint: "A set amount off the court fee of a booking (e.g. ₱200 off)." },
  { id: "percent", label: "Percentage discount", hint: "A percentage off the court fee of a booking, with an optional cap." },
  { id: "cash", label: "Cash voucher", hint: "A peso amount to spend on court fees. Unused balance stays on the voucher." },
] as const;
export type VoucherKind = (typeof VOUCHER_KINDS)[number]["id"];
export const isVoucherKind = (v: unknown): v is VoucherKind => VOUCHER_KINDS.some((k) => k.id === v);
export const voucherKindLabel = (k: string) => VOUCHER_KINDS.find((x) => x.id === k)?.label ?? k;

/** Set by staff: active, paused for now (e.g. while checking something), or void for good. */
export type VoucherStatus = "active" | "paused" | "void";
export const isVoucherStatus = (v: unknown): v is VoucherStatus => v === "active" || v === "paused" || v === "void";

/** Kinds that carry a balance (hours or pesos left); the others count uses. */
export const hasBalance = (k: VoucherKind) => k === "free_hours" || k === "cash";

export type Voucher = {
  code: string;
  kind: VoucherKind;
  value: number; // hours (free_hours), pesos (fixed, cash) or percent (percent)
  maxDiscount: number | null; // percent: at most this many pesos off per use
  balance: number; // free_hours: hours left; cash: pesos left; others: unused
  maxUses: number; // bookings it can be used on (fixed / percent)
  uses: number; // bookings it's on now (cancelled ones give their use back)
  status: VoucherStatus;
  validFrom: string | null; // "YYYY-MM-DD": bookings from this day
  expiresOn: string | null; // bookings up to this day (null: no expiry)
  sports: string[]; // empty: every sport and activity
  title: string; // e.g. "Opening promo" (optional)
  issuedTo: string; // who it was given to (optional; anyone with the code can use it)
  terms: string; // terms & conditions, with {placeholders} (see renderTerms)
};

/** A voucher as shown on a booking: what it is, what it took off (all the booking's courts), and its dates. */
export type BookingVoucherInfo = Pick<Voucher, "code" | "title" | "kind" | "value" | "maxDiscount" | "validFrom" | "expiresOn"> & {
  id?: string; // staff only: opens the voucher's admin page
  discount: number;
};

/** SQL for a booking's voucher as JSON (BookingVoucherInfo without the discount); `root` is the group's first booking. */
export const voucherInfoSql = (root: string, withId: boolean) =>
  `(SELECT json_build_object(${withId ? "'id', v.id, " : ""}'code', v.code, 'title', v.title, 'kind', v.kind, 'value', v.value::float8,
           'maxDiscount', v.max_discount::float8, 'validFrom', v.valid_from, 'expiresOn', v.expires_on)
      FROM bookings g JOIN vouchers v ON v.id = g.voucher_id
     WHERE COALESCE(g.group_id, g.id) = ${root} AND g.status <> 'cancelled' LIMIT 1)`;

// ---- Codes -------------------------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
export const VOUCHER_CODE_ALPHABET_SIZE = CODE_ALPHABET.length;

/** "VCH-7K3Q-9PXM" from 8 random indexes. Pass crypto-random numbers. */
export function formatVoucherCode(random: number[]): string {
  const s = random.slice(0, 8).map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join("");
  return `VCH-${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

/** Accepts "vch 7k3q 9pxm", "VCH-7K3Q-9PXM", "7K3Q9PXM", or the voucher page's link (scanned QR). */
export function normalizeVoucherCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const fromLink = v.match(/voucher#([A-Za-z0-9 -]+)\s*$/);
  const c = (fromLink ? fromLink[1] : v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = c.startsWith("VCH") ? c.slice(3) : c;
  return /^[A-Z0-9]{8}$/.test(body) ? `VCH-${body.slice(0, 4)}-${body.slice(4)}` : null;
}

/** The voucher's page: what its QR code opens. The code goes after "#", so it never reaches server logs. */
export const voucherPath = (code: string) => `/voucher#${code}`;

// ---- What it's worth ---------------------------------------------------------------------------

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const hoursText = (h: number) => `${h % 1 ? h.toFixed(1) : h} hour${h === 1 ? "" : "s"}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The headline: "2 free hours", "₱200 off", "20% off", "₱1,000". */
export function voucherValueLabel(v: Pick<Voucher, "kind" | "value" | "maxDiscount">): string {
  if (v.kind === "free_hours") return `${hoursText(v.value)} free`;
  if (v.kind === "fixed") return `${peso(v.value)} off`;
  if (v.kind === "percent") return `${v.value}% off${v.maxDiscount ? ` (up to ${peso(v.maxDiscount)})` : ""}`;
  return peso(v.value);
}

/** What's left: "1.5 of 3 hours left", "₱550 of ₱1,000 left", "2 of 5 uses left", "Not used yet". */
export function voucherLeftLabel(v: Pick<Voucher, "kind" | "value" | "balance" | "maxUses" | "uses">): string {
  if (v.kind === "free_hours") return `${hoursText(v.balance).replace(/ hours?$/, "")} of ${hoursText(v.value)} left`;
  if (v.kind === "cash") return `${peso(v.balance)} of ${peso(v.value)} left`;
  if (v.maxUses > 1) return `${Math.max(0, v.maxUses - v.uses)} of ${v.maxUses} uses left`;
  return v.uses >= 1 ? "Used" : "Not used yet";
}

export type VoucherState = "ready" | "paused" | "void" | "expired" | "used_up" | "not_yet";

/** Where a voucher stands today. */
export function voucherState(v: Pick<Voucher, "kind" | "balance" | "maxUses" | "uses" | "status" | "validFrom" | "expiresOn">, today: string): VoucherState {
  if (v.status === "void") return "void";
  if (v.expiresOn && v.expiresOn < today) return "expired";
  if (hasBalance(v.kind) ? v.balance <= 0 : v.uses >= v.maxUses) return "used_up";
  if (v.status === "paused") return "paused";
  if (v.validFrom && v.validFrom > today) return "not_yet";
  return "ready";
}

export const voucherStateLabel = (s: VoucherState) =>
  ({ ready: "Ready to use", paused: "Paused", void: "Void", expired: "Expired", used_up: "Used up", not_yet: "Not valid yet" })[s];

/**
 * Why this voucher can't be used for a booking of `activity` on `date` (made `today`), or null if it
 * can. A booking's date must be within the voucher's dates (from valid-from to the expiry date).
 */
export function voucherProblem(
  v: Pick<Voucher, "kind" | "balance" | "maxUses" | "uses" | "status" | "validFrom" | "expiresOn" | "sports">,
  b: { today: string; date: string; activity: string }
): string | null {
  const state = voucherState(v, b.today);
  if (state === "void") return "This voucher is no longer valid.";
  if (state === "expired") return `This voucher expired on ${formatDateLong(v.expiresOn!)}.`;
  if (state === "used_up") return "This voucher has been fully used.";
  if (state === "paused") return "This voucher is paused for now. Please ask the front desk.";
  if (v.expiresOn && b.date > v.expiresOn) return `This voucher is for bookings on or before ${formatDateLong(v.expiresOn)}.`;
  if (v.validFrom && b.date < v.validFrom) return `This voucher is for bookings from ${formatDateLong(v.validFrom)}.`;
  if (v.sports.length && !v.sports.includes(b.activity)) return `This voucher is for ${v.sports.map(sportLabel).join(" or ")} only.`;
  return null;
}

/** One court of a booking: its length, the rate charged, and its price before the voucher. */
export type VoucherCourt = { hours: number; rate: number; amount: number };

/**
 * What the voucher takes off each court of a booking (in order), and the free hours it uses. Free
 * hours cover court time at the rate charged; fixed and percent discounts and cash cover the courts
 * in turn. Nothing goes below ₱0.
 */
export function splitDiscount(
  v: Pick<Voucher, "kind" | "value" | "maxDiscount" | "balance">,
  courts: VoucherCourt[]
): { shares: { amount: number; hours: number }[]; total: number; hours: number } {
  const shares: { amount: number; hours: number }[] = [];
  if (v.kind === "free_hours") {
    let left = v.balance;
    for (const c of courts) {
      const h = Math.max(0, Math.min(left, c.hours));
      shares.push({ amount: Math.min(round2(c.rate * h), c.amount), hours: h });
      left -= h;
    }
  } else {
    const price = courts.reduce((s, c) => s + c.amount, 0);
    let left =
      v.kind === "fixed" ? v.value
      : v.kind === "cash" ? v.balance
      : Math.min(round2((price * v.value) / 100), v.maxDiscount ?? Infinity);
    for (const c of courts) {
      const a = round2(Math.max(0, Math.min(left, c.amount)));
      shares.push({ amount: a, hours: 0 });
      left = round2(left - a);
    }
  }
  return {
    shares,
    total: round2(shares.reduce((s, x) => s + x.amount, 0)),
    hours: shares.reduce((s, x) => s + x.hours, 0),
  };
}

// ---- Terms & conditions ------------------------------------------------------------------------

/** Placeholders the terms can use; filled in from the voucher when shown or printed. */
export const TERMS_PLACEHOLDERS = [
  { key: "value", hint: "what it's worth, e.g. “₱1,000” or “2 hours free”" },
  { key: "validity", hint: "“Valid for bookings on or before …” (or “No expiry date.”)" },
  { key: "sports", hint: "the sports it's for, e.g. “badminton and pickleball”" },
  { key: "cap", hint: "percentage vouchers: “, up to ₱500 off each time” (or nothing)" },
  { key: "uses", hint: "how many times it can be used" },
  { key: "site", hint: "where to book online" },
] as const;

const FIRST_LINE: Record<VoucherKind, string> = {
  free_hours:
    "Good for {value} of court time at NV Badminton Center for {sports}, booked in 30-minute steps. Hours you don't use stay on this voucher.",
  fixed: "Takes {value} the court fee of a booking for {sports}. If the fee is lower, the rest is forfeited. {uses}",
  percent: "Takes {value} the court fee of a booking for {sports}{cap}. {uses}",
  cash: "Worth {value} towards court fees at NV Badminton Center for {sports}. Any balance you don't use stays on this voucher for your next booking.",
};

/** Default terms for a new voucher of this kind (staff can edit them). */
export function defaultTerms(kind: VoucherKind): string {
  return [
    FIRST_LINE[kind],
    "{validity}",
    "Use it when you book online at {site} (enter the code, or scan the QR code), or show it at the front desk before you pay.",
    "One voucher per booking. Covers court fees only — not coaching fees, rentals or other purchases.",
    "Not exchangeable for cash, and no change is given.",
    "If a booking made with this voucher is cancelled, or released because it wasn't paid in time, the voucher gets that value back (unless it has expired).",
    "Anyone with this code can use it, so keep it safe. Report a lost voucher to the front desk right away so it can be blocked.",
    "NVBC may refuse or void vouchers that are altered, copied or misused.",
  ].join("\n");
}

/** The terms with their placeholders filled in, one line per term. */
export function renderTerms(
  v: Pick<Voucher, "kind" | "value" | "maxDiscount" | "maxUses" | "validFrom" | "expiresOn" | "sports" | "terms">,
  site: string
): string[] {
  const value =
    v.kind === "free_hours" ? hoursText(v.value)
    : v.kind === "fixed" ? `${peso(v.value)} off`
    : v.kind === "percent" ? `${v.value}% off`
    : peso(v.value);
  const cap = v.kind === "percent" && v.maxDiscount ? `, up to ${peso(v.maxDiscount)} off each time` : "";
  const validity =
    v.validFrom && v.expiresOn ? `Valid for bookings from ${formatDateLong(v.validFrom)} to ${formatDateLong(v.expiresOn)}.`
    : v.expiresOn ? `Valid for bookings on or before ${formatDateLong(v.expiresOn)}.`
    : v.validFrom ? `Valid for bookings from ${formatDateLong(v.validFrom)}. No expiry date.`
    : "No expiry date.";
  const sports = v.sports.length ? v.sports.map((s) => sportLabel(s).toLowerCase()).join(" and ") : "any sport";
  const uses = v.maxUses > 1 ? `Can be used on up to ${v.maxUses} bookings.` : "Can be used once.";
  const fill: Record<string, string> = { value, cap, validity, sports, uses, site };
  return v.terms
    .replace(/\{(\w+)\}/g, (m, k: string) => fill[k] ?? m)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
