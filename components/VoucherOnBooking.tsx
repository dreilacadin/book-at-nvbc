import type { ReactNode } from "react";
import { formatDateLong } from "@/lib/format";
import { formatPeso } from "@/lib/pricing";
import { voucherKindLabel, voucherValueLabel, type BookingVoucherInfo } from "@/lib/voucher";

/**
 * The voucher on a booking: its name and code (linked to the voucher's page), what it took off, and
 * until when it's valid. On the booking confirmation, My booking, and the staff booking card.
 */
export default function VoucherOnBooking({
  v,
  href,
  amountLeft,
  action,
}: {
  v: BookingVoucherInfo;
  href: string; // the voucher's page (public, or the admin page for staff)
  amountLeft?: number; // what's left to pay on the booking
  action?: ReactNode; // e.g. staff's Remove
}) {
  const validity = v.expiresOn
    ? `Valid for bookings until ${formatDateLong(v.expiresOn)}`
    : v.validFrom ? `Valid for bookings from ${formatDateLong(v.validFrom)} · no expiry` : "No expiry date";
  return (
    <div className="voucher-on-booking">
      <span className="vob-icon" aria-hidden="true">🎟</span>
      <div className="vob-body">
        <div>
          <strong>{v.title || voucherKindLabel(v.kind)}</strong> ·{" "}
          <a href={href} className="mono" title="Open the voucher's page">{v.code}</a>
        </div>
        <div className="muted">
          {v.kind === "free_hours"
            ? `${v.value} free court ${v.value === 1 ? "hour" : "hours"}`
            : `${voucherValueLabel(v)} ${v.kind === "cash" ? "cash voucher" : "voucher"}`} · took{" "}
          <strong>{formatPeso(v.discount)}</strong> off{amountLeft !== undefined && amountLeft <= 0 ? " — nothing left to pay" : ""}
        </div>
        <div className="muted">{validity}</div>
      </div>
      <div className="vob-actions">
        <a href={href} className="btn small secondary">View voucher</a>
        {action}
      </div>
    </div>
  );
}
