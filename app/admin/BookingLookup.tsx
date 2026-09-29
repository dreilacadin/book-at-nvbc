"use client";

import { useCallback, useRef, useState } from "react";
import { payByLabel } from "@/components/BookingPolicy";
import { REFUND_HOURS, refundOnCancel } from "@/lib/booking-policy";
import { formatClock, formatDateLong, formatRange } from "@/lib/format";
import {
  bookingStatusLabel,
  formatPeso,
  PAYMENT_METHODS,
  paymentLabel,
  paymentStatusLabel,
  rateTypeLabel,
  type PaymentMethod,
} from "@/lib/pricing";
import { sportEmoji } from "@/lib/sports";
import { nowAtFacility } from "@/lib/time";
import EditBooking from "./EditBooking";
import QrScanner from "./QrScanner";
import { api, type AdminBooking, type Court } from "./shared";

/** Refund wording for cancelling this booking now (online payments: 12-hour rule). */
export function refundNote(b: AdminBooking): string {
  const r = refundOnCancel({ ...b, start_hour: b.start_hour }, nowAtFacility());
  if (r === "refundable") return `\n\nPaid by ${paymentLabel(b.payment_method)} and cancelled ${REFUND_HOURS}+ hours before the start: eligible for a refund of ${formatPeso(b.amount)}.`;
  if (r === "non-refundable") return `\n\nPaid by ${paymentLabel(b.payment_method)}, less than ${REFUND_HOURS} hours before the start: non-refundable under the booking policy.`;
  if (b.payment_status === "paid") return `\n\nThis booking is PAID (${formatPeso(b.amount)}, ${paymentLabel(b.payment_method)}).`;
  return "";
}

/** "10:32 AM" in Manila time, from an ISO timestamp. */
export function clockFromIso(iso: string): string {
  const d = new Date(iso);
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const [h, m] = t.split(":").map(Number);
  return formatClock(h + m / 60);
}

/** When an unpaid active booking is released, in words. */
export function releaseNote(b: AdminBooking): string | null {
  if ((b.status !== "pending" && b.status !== "reserved") || b.payment_status !== "unpaid" || b.amount <= 0) return null;
  if (b.pay_by) return `Released at ${clockFromIso(b.pay_by)} if not paid online`;
  return `Released at ${payByLabel(b.date, b.start_hour)} if unpaid`;
}

/**
 * One booking with staff actions: confirm payment, edit, cancel. Used by the booking scanner in
 * /admin and by staff mode on the public booking grid.
 */
export function AdminBookingCard({
  b,
  onChanged,
  onOpenDate,
  onAuthError,
}: {
  b: AdminBooking;
  onChanged: () => void; // reload after a change
  onOpenDate?: (date: string) => void;
  onAuthError: (e: unknown) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>(b.payment_method);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [courts, setCourts] = useState<Court[] | null>(null); // loaded when editing
  const [editing, setEditing] = useState(false);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/bookings", body);
      onChanged();
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function startEdit() {
    try {
      if (!courts) setCourts((await api<{ courts: Court[] }>("/api/admin/courts")).courts);
      setEditing(true);
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Could not load courts");
    }
  }

  const released = b.status === "cancelled" && b.cancelled_by === "system";
  const release = releaseNote(b);
  const cancel = () => window.confirm(`Cancel ${b.name}'s booking (${b.code})?${refundNote(b)}`) && run({ action: "cancel", id: b.id });

  if (editing && courts)
    return (
      <div className={`lookup-result booking-${b.status}`}>
        <EditBooking booking={b} courts={courts} onAuthError={onAuthError} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChanged(); }} />
      </div>
    );

  return (
    <div className={`lookup-result booking-${released ? "released" : b.status}`}>
      <div className="lookup-status">
        <span className="lookup-icon" aria-hidden="true">
          {b.status === "confirmed" ? "✓" : b.status === "pending" ? "…" : b.status === "reserved" ? "R" : "×"}
        </span>
        <div>
          <strong>
            {b.status === "confirmed" ? "Confirmed"
              : b.status === "pending" ? (b.payment_status === "for_verification" ? "Pending — payment sent, please verify" : "Pending — waiting for payment")
              : b.status === "reserved" ? "Reserved — coach paying cash at the desk"
              : released ? "Released (not paid in time)"
              : `Cancelled${b.cancelled_by ? ` by ${b.cancelled_by}` : ""}`}
          </strong>
          <div>
            {b.code} · {sportEmoji(b.sport)} {b.court_name} · {formatDateLong(b.date)} · {formatRange(b.start_hour, b.end_hour)}
          </div>
        </div>
        {onOpenDate && (
          <button type="button" className="btn small secondary" style={{ marginLeft: "auto" }} onClick={() => onOpenDate(b.date)}>
            Open that day
          </button>
        )}
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
        {release && <div><dt>If unpaid</dt><dd><strong>{release}</strong></dd></div>}
        {b.notes && <div><dt>Notes</dt><dd>{b.notes}</dd></div>}
      </dl>

      {b.expired_member_id && (
        <div className="expired-flag" style={{ marginTop: 10 }}>
          ⚠ {b.expired_member_name}&apos;s membership expired — remind them to renew or forfeit.
        </div>
      )}
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}

      {b.status !== "cancelled" && (
        <div className="confirm-pay">
          {b.status !== "confirmed" && (
            <>
              <label htmlFor={`bl-method-${b.id}`} style={{ margin: 0 }}>Paid by</label>
              <select id={`bl-method-${b.id}`} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} style={{ width: "auto" }}>
                {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              <button className="btn" disabled={busy} onClick={() => run({ action: "payment", id: b.id, status: "paid", method })}>
                ✓ Payment received — confirm ({formatPeso(b.amount)})
              </button>
            </>
          )}
          <button className="btn secondary" disabled={busy} onClick={startEdit}>✎ Edit</button>
          <button className="btn secondary danger-text" disabled={busy} onClick={cancel}>Cancel booking</button>
        </div>
      )}
      <p className="hint" style={{ margin: "8px 0 0" }}>Status: {bookingStatusLabel(b.status)}</p>
    </div>
  );
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
  const [error, setError] = useState("");
  const [camera, setCamera] = useState(false);

  const lookup = useCallback(
    async (raw: string) => {
      if (!raw.trim()) return;
      setError("");
      try {
        setB(await api<AdminBooking>(`/api/admin/bookings?code=${encodeURIComponent(raw.trim())}`));
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
        <AdminBookingCard key={b.id + b.status + b.payment_status} b={b} onOpenDate={onOpenDate} onAuthError={onAuthError}
          onChanged={() => { onChanged(); lookup(b.code); }} />
      )}
      {camera && <QrScanner onCode={fromCamera} onClose={() => setCamera(false)} />}
    </div>
  );
}
