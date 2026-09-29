"use client";

import { useEffect, useState } from "react";
import { formatDateLong, formatRange } from "@/lib/format";
import { forgetCode, loadCodes, type SavedCode } from "@/lib/saved-codes";
import { sportLabel } from "@/lib/sports";
import BookingPolicy, { payByLabel } from "@/components/BookingPolicy";
import BookingQr from "@/components/BookingQr";
import PaymentPanel from "@/components/PaymentPanel";
import { REFUND_HOURS, RELEASE_MINUTES, refundOnCancel } from "@/lib/booking-policy";
import { nowAtFacility } from "@/lib/time";
import {
  formatPeso,
  paymentLabel,
  rateTypeLabel,
  bookingStatusLabel,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/pricing";

type Booking = {
  code: string;
  courtName: string;
  sport: string;
  date: string;
  startHour: number;
  endHour: number;
  name: string;
  status: BookingStatus;
  canCancel: boolean;
  rateType: string;
  hourlyRate: number;
  discountPct: number;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentRef: string;
  hasProof: boolean;
  cancelledBy: string | null; // "system" = released (not paid in time)
  payBy: string | null; // online booking: pay by this time (ISO) or it's released
  courtNotes: string;
  phase: "in_progress" | "completed" | null;
};

export default function MyBookingPage() {
  const [code, setCode] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<SavedCode[]>([]);

  useEffect(() => setSaved(loadCodes()), []);

  async function lookup(c: string) {
    setBusy(true);
    setError("");
    setMessage("");
    setBooking(null);
    setConfirming(false);
    try {
      const res = await fetch("/api/bookings/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || "Booking not found.");
      else {
        setBooking(json);
        setCode(json.code);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!booking) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: booking.code }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || "Could not cancel.");
      else {
        setBooking({ ...booking, status: "cancelled", canCancel: false });
        setMessage("Your booking has been cancelled and the court is open for others. Thank you!");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  function removeSaved(c: string) {
    forgetCode(c);
    setSaved(loadCodes());
  }

  const refund = booking
    ? refundOnCancel(
        { payment_method: booking.paymentMethod, payment_status: booking.paymentStatus, date: booking.date, start_hour: booking.startHour },
        nowAtFacility()
      )
    : "none";

  return (
    <div style={{ maxWidth: 560 }}>
      <h1>My booking</h1>
      <p className="lead">Enter the booking code you got when you reserved to view, pay for or cancel your booking.</p>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          lookup(code);
        }}
      >
        <label htmlFor="code">Booking code</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="code"
            type="text"
            placeholder="NV-ABC123"
            autoCapitalize="characters"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
          />
          <button className="btn" disabled={busy}>Find</button>
        </div>
      </form>

      {error && <div className="error" style={{ marginTop: 16 }}>{error}</div>}
      {message && <div className="success" style={{ marginTop: 16 }}>{message}</div>}

      {booking && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0 }}>
              {booking.courtName}
              <span className="muted" style={{ display: "block", fontSize: 14, fontWeight: 400 }}>{sportLabel(booking.sport)}</span>
            </h2>
            <span className={`badge ${booking.status === "pending" ? "pending" : booking.status === "reserved" ? "coach-reserved" : booking.status === "cancelled" ? "grey" : ""}`}>
              {booking.status === "cancelled" && booking.cancelledBy === "system" ? "Released"
                : booking.phase === "in_progress" ? "In progress"
                : booking.phase === "completed" ? "Completed"
                : bookingStatusLabel(booking.status)}
            </span>
          </div>
          <p style={{ margin: "8px 0 0" }}>
            {formatDateLong(booking.date)}
            <br />
            {formatRange(booking.startHour, booking.endHour)}
            <br />
            <span className="muted">Booked under {booking.name}</span>
            {booking.amount > 0 && (
              <>
                <br />
                <span className="muted">
                  {formatPeso(booking.amount)} · {rateTypeLabel(booking.rateType)} rate
                  {booking.discountPct > 0
                    ? ` (${booking.discountPct}% off)` /* bookings made before fixed prices */
                    : booking.hourlyRate > 0
                      ? ` (${formatPeso(booking.hourlyRate)}/hr)`
                      : ""}{" "}
                  · {paymentLabel(booking.paymentMethod)}
                </span>
              </>
            )}
          </p>

          {booking.courtNotes && booking.status !== "cancelled" && <div className="court-note">ⓘ {booking.courtNotes}</div>}
          {booking.status === "pending" && (
            <div className="notice" style={{ marginTop: 12 }}>
              {booking.paymentStatus === "for_verification" ? (
                <>
                  We&apos;ve received your {paymentLabel(booking.paymentMethod)} payment details. Your booking is{" "}
                  <strong>Pending</strong> and becomes <strong>Confirmed</strong> once staff verify your payment.
                </>
              ) : (
                <>
                  We&apos;re holding this slot for you. Please pay and send your receipt or reference number before the
                  timer below runs out — otherwise the slot will be released for other players.
                </>
              )}
            </div>
          )}
          {booking.status === "reserved" && (
            <div className="notice info" style={{ marginTop: 12 }}>
              Your slot is <strong>Reserved</strong>. Please pay {formatPeso(booking.amount)} in cash at the front desk by{" "}
              <strong>{payByLabel(booking.date, booking.startHour)}</strong> — reserved slots that aren&apos;t paid by then are
              released for other players.
            </div>
          )}
          {booking.status === "cancelled" && booking.cancelledBy === "system" && (
            <div className="notice" style={{ marginTop: 12 }}>
              This booking was released because it wasn&apos;t paid in time, so the court could be offered to other
              players. You&apos;re welcome to book another slot.
            </div>
          )}
          {booking.status !== "cancelled" && <BookingQr code={booking.code} />}

          {booking.status !== "cancelled" && booking.amount > 0 && (
            <PaymentPanel
              key={booking.code}
              code={booking.code}
              amount={booking.amount}
              method={booking.paymentMethod}
              status={booking.paymentStatus}
              reference={booking.paymentRef}
              hasProof={booking.hasProof}
              payBy={payByLabel(booking.date, booking.startHour)}
              deadline={booking.payBy}
              onUpdated={(u) => setBooking({ ...booking, ...u, payBy: null, status: u.paymentStatus === "for_verification" ? "pending" : booking.status })}
            />
          )}
          {booking.status === "cancelled" && booking.paymentStatus === "paid" && booking.paymentMethod !== "cash" && (
            <p className="muted" style={{ fontSize: 14 }}>
              You paid for this booking by {paymentLabel(booking.paymentMethod)}. Refunds apply to bookings cancelled at
              least {REFUND_HOURS} hours before the start time — please contact the front desk about your refund.
            </p>
          )}

          {booking.canCancel && !confirming && (
            <div className="actions">
              <button className="btn secondary" onClick={() => setConfirming(true)}>Cancel this booking</button>
            </div>
          )}
          {confirming && refund !== "none" && (
            <div className={refund === "refundable" ? "success" : "notice"} style={{ marginTop: 14 }}>
              {refund === "refundable"
                ? `You're cancelling at least ${REFUND_HOURS} hours before your start time, so your ${paymentLabel(booking.paymentMethod)} payment is eligible for a refund. The front desk will arrange it.`
                : `Your start time is less than ${REFUND_HOURS} hours away, so your ${paymentLabel(booking.paymentMethod)} payment is non-refundable if you cancel now.`}
            </div>
          )}
          {confirming && (
            <div className="actions" style={{ alignItems: "center" }}>
              <span className="muted" style={{ marginRight: "auto" }}>Cancel for sure?</span>
              <button className="btn secondary" onClick={() => setConfirming(false)}>Keep it</button>
              <button className="btn danger" onClick={cancel} disabled={busy}>Yes, cancel</button>
            </div>
          )}
          {booking.status !== "cancelled" && !booking.canCancel && (
            <p className="muted" style={{ fontSize: 14, marginBottom: 0 }}>
              This booking has already started. Please talk to the front desk for changes.
            </p>
          )}
          {booking.status !== "cancelled" && booking.amount > 0 && <BookingPolicy title="Good to know" />}
        </div>
      )}

      {saved.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h2>Saved on this device</h2>
          <div className="card" style={{ padding: 8 }}>
            {saved.map((s) => (
              <div
                key={s.code}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, borderBottom: "1px solid var(--border)" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontFamily: "ui-monospace, monospace" }}>{s.code}</strong>
                  <div className="muted" style={{ fontSize: 13 }}>{s.label}</div>
                </div>
                <button className="btn small secondary" onClick={() => lookup(s.code)}>View</button>
                <button className="btn small secondary" aria-label={`Forget ${s.code}`} onClick={() => removeSaved(s.code)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
