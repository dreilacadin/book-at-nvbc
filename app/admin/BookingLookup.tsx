"use client";

import { useCallback, useRef, useState } from "react";
import { payByLabel } from "@/components/BookingPolicy";
import { REFUND_HOURS, refundOnCancel } from "@/lib/booking-policy";
import { formatDateLong, formatRange } from "@/lib/format";
import {
  formatPeso,
  PAYMENT_METHODS,
  paymentLabel,
  paymentStatusLabel,
  rateTypeLabel,
  type PaymentMethod,
} from "@/lib/pricing";
import { sportEmoji } from "@/lib/sports";
import { nowAtFacility } from "@/lib/time";
import QrScanner from "./QrScanner";
import { api, type AdminBooking } from "./shared";

/** Refund wording for cancelling this booking now (online payments: 12-hour rule). */
export function refundNote(b: AdminBooking): string {
  const r = refundOnCancel({ ...b, start_hour: b.start_hour }, nowAtFacility());
  if (r === "refundable") return `\n\nPaid by ${paymentLabel(b.payment_method)} and cancelled ${REFUND_HOURS}+ hours before the start: eligible for a refund of ${formatPeso(b.amount)}.`;
  if (r === "non-refundable") return `\n\nPaid by ${paymentLabel(b.payment_method)}, less than ${REFUND_HOURS} hours before the start: non-refundable under the booking policy.`;
  if (b.payment_status === "paid") return `\n\nThis booking is PAID (${formatPeso(b.amount)}, ${paymentLabel(b.payment_method)}).`;
  return "";
}

/** Staff: scan a player's booking QR (or type the code) to check it and confirm payment. */
export default function BookingLookup({
  onChanged,
  onOpenDate,
  onAuthError,
}: {
  onChanged: () => void; // reload the day's list
  onOpenDate: (date: string) => void;
  onAuthError: (e: unknown) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [b, setB] = useState<AdminBooking | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState("");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);

  const lookup = useCallback(
    async (raw: string) => {
      if (!raw.trim()) return;
      setError("");
      try {
        const found = await api<AdminBooking>(`/api/admin/bookings?code=${encodeURIComponent(raw.trim())}`);
        setB(found);
        setMethod(found.payment_method);
      } catch (e) {
        onAuthError(e);
        setB(null);
        setError(e instanceof Error ? e.message : "Lookup failed");
      }
      setCode("");
      input.current?.focus();
    },
    [onAuthError]
  );

  const fromCamera = useCallback((text: string) => {
    setCamera(false);
    lookup(text);
  }, [lookup]);

  async function run(body: Record<string, unknown>) {
    if (!b) return;
    setBusy(true);
    try {
      await api("/api/admin/bookings", body);
      onChanged();
      await lookup(b.code);
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const released = b?.status === "cancelled" && b.cancelled_by === "system";

  return (
    <div className="card">
      <form onSubmit={(e) => { e.preventDefault(); lookup(code); }} className="lookup-bar">
        <input ref={input} type="text" autoComplete="off" spellCheck={false} aria-label="Booking code"
          placeholder="Scan booking QR or type code (NV-XXXXXX)" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn">Check</button>
        <button type="button" className="btn secondary" onClick={() => setCamera(true)}>📷 Camera</button>
      </form>
      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      {b && (
        <div className={`lookup-result booking-${released ? "released" : b.status}`}>
          <div className="lookup-status">
            <span className="lookup-icon" aria-hidden="true">{b.status === "confirmed" ? "✓" : b.status === "pending" ? "…" : "×"}</span>
            <div>
              <strong>
                {b.status === "confirmed" ? "Confirmed" : b.status === "pending" ? "Pending — waiting for payment" : released ? "Released (not paid in time)" : "Cancelled"}
              </strong>
              <div>
                {b.code} · {sportEmoji(b.sport)} {b.court_name} · {formatDateLong(b.date)} · {formatRange(b.start_hour, b.end_hour)}
              </div>
            </div>
            <button type="button" className="btn small secondary" style={{ marginLeft: "auto" }} onClick={() => onOpenDate(b.date)}>
              Open that day
            </button>
          </div>

          <dl className="member-details">
            <div><dt>Name</dt><dd><strong>{b.name}</strong></dd></div>
            <div><dt>Contact</dt><dd>{b.contact}</dd></div>
            <div>
              <dt>Rate</dt>
              <dd>{rateTypeLabel(b.rate_type)}{b.member_code ? ` · ${b.member_code}` : ""} · {formatPeso(b.hourly_rate)}/hr</dd>
            </div>
            <div><dt>Amount</dt><dd><strong>{formatPeso(b.amount)}</strong></dd></div>
            <div>
              <dt>Payment</dt>
              <dd>
                {paymentLabel(b.payment_method)} · {paymentStatusLabel(b.payment_status)}
                {b.payment_ref && <> · <span style={{ fontFamily: "ui-monospace, monospace" }}>{b.payment_ref}</span></>}
                {b.has_proof && <> · <a href={`/api/admin/bookings/proof?id=${b.id}`} target="_blank" rel="noopener noreferrer">📷 Screenshot</a></>}
              </dd>
            </div>
            {b.status === "pending" && b.payment_status === "unpaid" && (
              <div><dt>Released if unpaid by</dt><dd><strong>{payByLabel(b.date, b.start_hour)}</strong></dd></div>
            )}
            {b.notes && <div><dt>Notes</dt><dd>{b.notes}</dd></div>}
          </dl>

          {b.expired_member_id && (
            <div className="expired-flag" style={{ marginTop: 10 }}>
              ⚠ {b.expired_member_name}&apos;s membership expired — remind them to renew or forfeit.
            </div>
          )}

          {b.status === "pending" && (
            <div className="confirm-pay">
              <label htmlFor="bl-method" style={{ margin: 0 }}>Paid by</label>
              <select id="bl-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} style={{ width: "auto" }}>
                {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              <button className="btn" disabled={busy}
                onClick={() => run({ action: "payment", id: b.id, status: "paid", method })}>
                ✓ Payment received — confirm ({formatPeso(b.amount)})
              </button>
              <button className="btn secondary danger-text" disabled={busy}
                onClick={() => window.confirm(`Cancel ${b.name}'s booking (${b.code})?${refundNote(b)}`) && run({ action: "cancel", id: b.id })}>
                Cancel booking
              </button>
            </div>
          )}
          {b.status === "confirmed" && (
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              <button className="btn secondary danger-text" disabled={busy}
                onClick={() => window.confirm(`Cancel ${b.name}'s booking (${b.code})?${refundNote(b)}`) && run({ action: "cancel", id: b.id })}>
                Cancel booking
              </button>
            </div>
          )}
        </div>
      )}
      {camera && <QrScanner onCode={fromCamera} onClose={() => setCamera(false)} />}
    </div>
  );
}
