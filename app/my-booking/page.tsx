"use client";

import { useEffect, useState } from "react";
import { formatDateLong, formatRange } from "@/lib/format";
import { forgetCode, loadCodes, type SavedCode } from "@/lib/saved-codes";
import { sportLabel } from "@/lib/sports";
import PaymentPanel from "@/components/PaymentPanel";
import {
  formatPeso,
  paymentLabel,
  rateTypeLabel,
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
  status: "confirmed" | "cancelled";
  canCancel: boolean;
  rateType: string;
  hourlyRate: number;
  discountPct: number;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentRef: string;
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
            <span className={booking.status === "confirmed" ? "badge" : "badge grey"}>
              {booking.status === "confirmed" ? "Confirmed" : "Cancelled"}
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
                  {booking.discountPct > 0 ? ` (${booking.discountPct}% off)` : ""} · {paymentLabel(booking.paymentMethod)}
                </span>
              </>
            )}
          </p>

          {booking.status === "confirmed" && booking.amount > 0 && (
            <PaymentPanel
              key={booking.code}
              code={booking.code}
              amount={booking.amount}
              method={booking.paymentMethod}
              status={booking.paymentStatus}
              reference={booking.paymentRef}
              onUpdated={(u) => setBooking({ ...booking, ...u })}
            />
          )}
          {booking.status === "cancelled" && booking.paymentStatus === "paid" && (
            <p className="muted" style={{ fontSize: 14 }}>
              You already paid for this booking. Please contact the front desk about your refund.
            </p>
          )}

          {booking.canCancel && !confirming && (
            <div className="actions">
              <button className="btn secondary" onClick={() => setConfirming(true)}>Cancel this booking</button>
            </div>
          )}
          {confirming && (
            <div className="actions" style={{ alignItems: "center" }}>
              <span className="muted" style={{ marginRight: "auto" }}>Cancel for sure?</span>
              <button className="btn secondary" onClick={() => setConfirming(false)}>Keep it</button>
              <button className="btn danger" onClick={cancel} disabled={busy}>Yes, cancel</button>
            </div>
          )}
          {booking.status === "confirmed" && !booking.canCancel && (
            <p className="muted" style={{ fontSize: 14, marginBottom: 0 }}>
              This booking has already started. Please talk to the front desk for changes.
            </p>
          )}
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
