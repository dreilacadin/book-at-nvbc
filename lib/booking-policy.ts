// Payment and refund rules for bookings. Shared by the server and the browser (no Node imports).

/** Unpaid bookings are released this many minutes before they start. */
export const RELEASE_MINUTES = 10;
/** Online payments are refundable when the booking is cancelled at least this many hours before it starts. */
export const REFUND_HOURS = 12;
/** After booking online, players have this long to pay and send their receipt or reference number. */
export const PAY_WINDOW_MINUTES = 15;

type Now = { date: string; time: number }; // time of day in hours, e.g. 9.75 = 9:45 AM

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

/** Minutes from `now` until the booking starts (negative once it has started). */
export function minutesUntilStart(date: string, startHour: number, now: Now): number {
  return Math.round(dayDiff(now.date, date) * 1440 + (startHour - now.time) * 60);
}

/** When an unpaid booking is released: RELEASE_MINUTES before its start (may be the day before). */
export function releaseAt(date: string, startHour: number): { date: string; time: number } {
  const t = startHour - RELEASE_MINUTES / 60;
  if (t >= 0) return { date, time: t };
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return { date: d.toISOString().slice(0, 10), time: t + 24 };
}

/**
 * When an online booking must be paid by (ms since epoch): PAY_WINDOW_MINUTES after booking, or
 * RELEASE_MINUTES before the start if that comes first.
 */
export function paymentDeadline(nowMs: number, date: string, startHour: number, now: Now): number {
  const untilRelease = (minutesUntilStart(date, startHour, now) - RELEASE_MINUTES) * 60_000;
  return nowMs + Math.min(PAY_WINDOW_MINUTES * 60_000, untilRelease);
}

/**
 * A pending or reserved booking with nothing paid is released once it is within RELEASE_MINUTES
 * of its start, or once its online payment window (pay_by) has run out. Bookings whose online
 * payment was sent (for verification) are kept: the player has paid.
 */
export function shouldRelease(
  b: {
    status: string; payment_status: string; amount: number; date: string; start_hour: number; pay_by?: string | null;
    phase?: string | null; // marked in progress / completed by staff: never released
    auto_release?: boolean; // false once staff restored it: never released again
  },
  now: Now,
  nowMs: number = Date.now()
): boolean {
  if ((b.status !== "pending" && b.status !== "reserved") || b.payment_status !== "unpaid" || b.amount <= 0) return false;
  if (b.phase || b.auto_release === false) return false;
  return minutesUntilStart(b.date, b.start_hour, now) <= RELEASE_MINUTES || (!!b.pay_by && Date.parse(b.pay_by) <= nowMs);
}

/**
 * Refund policy when a booking is cancelled now: payments made online (GCash, QR Ph, bank transfer)
 * are refundable at least REFUND_HOURS before the start, non-refundable after. Otherwise: no refund
 * question (nothing paid, or paid in cash at the desk).
 */
export function refundOnCancel(
  b: { payment_method: string; payment_status: string; date: string; start_hour: number },
  now: Now
): "refundable" | "non-refundable" | "none" {
  if (b.payment_method === "cash" || (b.payment_status !== "paid" && b.payment_status !== "for_verification")) return "none";
  return minutesUntilStart(b.date, b.start_hour, now) >= REFUND_HOURS * 60 ? "refundable" : "non-refundable";
}

// ---- In progress / completed ------------------------------------------------------------

export type Phase = "in_progress" | "completed";
export const phaseLabel = (p: Phase) => (p === "in_progress" ? "In progress" : "Completed");

/**
 * Where a booking is in its day. Staff can set it by hand (`phase`); otherwise a PAID booking
 * (payment Paid or No charge, or nothing to pay) is "in_progress" from its start time and
 * "completed" from its end time. Unpaid or cancelled bookings have no phase unless staff set one.
 * (The payment is checked, not just "confirmed": older bookings could be confirmed but unpaid.)
 */
export function bookingPhase(
  b: { status: string; phase: string | null; payment_status: string; amount: number; date: string; start_hour: number; end_hour: number },
  now: Now
): Phase | null {
  if (b.status === "cancelled") return null;
  if (b.phase === "in_progress" || b.phase === "completed") return b.phase;
  const paid = b.payment_status === "paid" || b.payment_status === "waived" || b.amount <= 0;
  if (!paid) return null;
  if (minutesUntilStart(b.date, b.end_hour, now) <= 0) return "completed";
  if (minutesUntilStart(b.date, b.start_hour, now) <= 0) return "in_progress";
  return null;
}

/** The booking has started but its online payment still hasn't been verified by staff. */
export function startedUnverified(
  b: { status: string; payment_status: string; phase: string | null; date: string; start_hour: number },
  now: Now
): boolean {
  return b.status === "pending" && b.payment_status === "for_verification" && !b.phase && minutesUntilStart(b.date, b.start_hour, now) <= 0;
}
