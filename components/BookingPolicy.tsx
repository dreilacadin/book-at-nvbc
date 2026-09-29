import { PAY_WINDOW_MINUTES, REFUND_HOURS, RELEASE_MINUTES, releaseAt } from "@/lib/booking-policy";
import { formatClock } from "@/lib/format";

/** "9:50 AM on Thu, Oct 1" — when an unpaid booking is released. */
export function payByLabel(date: string, startHour: number): string {
  const r = releaseAt(date, startHour);
  const day = new Date(r.date + "T00:00:00Z").toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${formatClock(r.time)} on ${day}`;
}

/** Payment deadline and refund policy, shown before booking and on the booking itself. */
export default function BookingPolicy({ title = "Before you book" }: { title?: string }) {
  return (
    <div className="policy-box">
      <strong>{title}</strong>
      <ul>
        <li>
          After booking, you have <strong>{PAY_WINDOW_MINUTES} minutes</strong> to pay by GCash, QR Ph or bank transfer and
          send your receipt or reference number. Bookings not paid within that time are released automatically so other
          players can book the court.
        </li>
        <li>
          Coaches paying in cash: your slot is <strong>Reserved</strong>. Please settle your payment at the front desk at
          least <strong>{RELEASE_MINUTES} minutes before your start time</strong>, or the slot will be released.
        </li>
        <li>
          Paid by GCash, QR Ph or bank transfer? You&apos;re eligible for a refund if you cancel at least{" "}
          <strong>{REFUND_HOURS} hours before your start time</strong>. Cancellations made less than {REFUND_HOURS} hours
          before the start time are non-refundable.
        </li>
      </ul>
    </div>
  );
}
