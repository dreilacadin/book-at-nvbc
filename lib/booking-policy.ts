// Payment and refund rules for bookings. Shared by the server and the browser (no Node imports).

/** Unpaid bookings are released this many minutes before they start. */
export const RELEASE_MINUTES = 10;
/** Online payments are refundable when the booking is cancelled at least this many hours before it starts. */
export const REFUND_HOURS = 12;

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
 * An active booking with nothing paid is released once it is within RELEASE_MINUTES of its start.
 * Bookings whose online payment was sent (for verification) are kept: the player has paid.
 */
export function shouldRelease(
  b: { status: string; payment_status: string; amount: number; date: string; start_hour: number },
  now: Now
): boolean {
  return (
    b.status === "pending" && b.payment_status === "unpaid" && b.amount > 0 &&
    minutesUntilStart(b.date, b.start_hour, now) <= RELEASE_MINUTES
  );
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
