"use client";

import { useEffect, useState } from "react";
import { formatDuration, formatHour, halfHours } from "@/lib/format";
import {
  formatPeso,
  PAYMENT_METHODS,
  RATE_TYPES,
  rateFor,
  ratesForDate,
  type PaymentMethod,
  type RateType,
} from "@/lib/pricing";
import { SPORTS } from "@/lib/sports";
import { api, type AdminBooking, type Court, type Settings } from "./shared";

/** Staff form to change a booking's court, date, time, player details, rate or payment method. */
export default function EditBooking({
  booking,
  courts,
  onSaved,
  onClose,
  onAuthError,
}: {
  booking: AdminBooking;
  courts: Court[];
  onSaved: () => void;
  onClose: () => void;
  onAuthError: (e: unknown) => void;
}) {
  const [courtId, setCourtId] = useState(booking.court_id);
  const [date, setDate] = useState(booking.date);
  const [start, setStart] = useState(booking.start_hour);
  const [end, setEnd] = useState(booking.end_hour);
  const [name, setName] = useState(booking.name);
  const [contact, setContact] = useState(booking.contact === "(admin)" ? "" : booking.contact);
  const [notes, setNotes] = useState(booking.notes);
  const [rateType, setRateType] = useState<RateType>(booking.rate_type);
  const [hourlyRate, setHourlyRate] = useState<number | "">(booking.hourly_rate);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(booking.payment_method);
  const [paymentRef, setPaymentRef] = useState(booking.payment_ref);
  const [plans, setPlans] = useState<Settings["rate_plans"] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Settings>("/api/admin/settings")
      .then((s) => setPlans(s.rate_plans))
      .catch(onAuthError); // prices are only a suggestion; the form works without them
  }, [onAuthError]);

  const hours = end - start;
  const sport = courts.find((c) => c.id === courtId)?.sport;
  const plan = sport && plans?.[sport];
  const currentRate = plan ? rateFor(ratesForDate(plan, date), plan.memberRates ? rateType : "regular") : null;
  const amount = hours > 0 && hourlyRate !== "" ? Math.round(hourlyRate * hours * 100) / 100 : 0;
  const hourOptions = halfHours(0, 24);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (hours <= 0) return setError("End time must be after start time.");
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/bookings", {
        action: "update",
        id: booking.id,
        courtId,
        date,
        startHour: start,
        endHour: end,
        name,
        contact,
        notes,
        rateType,
        hourlyRate: hourlyRate === "" ? 0 : hourlyRate,
        paymentMethod,
        paymentRef,
      });
      onSaved();
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="edit-booking" onSubmit={save}>
      <h3 style={{ margin: "0 0 10px" }}>Edit booking {booking.code}</h3>
      <div className="row field" style={{ gridTemplateColumns: "2fr 1.4fr 1fr 1fr" }}>
        <div>
          <label htmlFor="eb-court">Court</label>
          <select id="eb-court" value={courtId} onChange={(e) => setCourtId(Number(e.target.value))}>
            {SPORTS.map((sp) => (
              <optgroup key={sp.id} label={sp.label}>
                {courts.filter((c) => c.sport === sp.id).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.is_active ? "" : " (hidden)"}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="eb-date">Date</label>
          <input id="eb-date" type="date" required value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="eb-s">From</label>
          <select id="eb-s" value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {hourOptions.slice(0, -1).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="eb-e">Until</label>
          <select id="eb-e" value={end} onChange={(e) => setEnd(Number(e.target.value))}>
            {hourOptions.slice(1).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
          </select>
        </div>
      </div>
      <div className="row field" style={{ gridTemplateColumns: "1fr 1fr 2fr" }}>
        <div>
          <label htmlFor="eb-n">Name</label>
          <input id="eb-n" type="text" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="eb-c">Contact</label>
          <input id="eb-c" type="text" maxLength={60} value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <div>
          <label htmlFor="eb-no">Notes</label>
          <input id="eb-no" type="text" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="row field" style={{ gridTemplateColumns: "1fr 1.4fr 1fr 1.4fr" }}>
        <div>
          <label htmlFor="eb-rt">Rate</label>
          <select id="eb-rt" value={rateType} onChange={(e) => setRateType(e.target.value as RateType)}>
            {RATE_TYPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="eb-hr">₱ per hour</label>
          <input id="eb-hr" type="number" min={0} step="0.01" required value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value === "" ? "" : Number(e.target.value))} />
          {currentRate !== null && currentRate !== hourlyRate && (
            <button type="button" className="link-btn" onClick={() => setHourlyRate(currentRate)}>
              Use current price ({formatPeso(currentRate)})
            </button>
          )}
        </div>
        <div>
          <label htmlFor="eb-pm">Payment method</label>
          <select id="eb-pm" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="eb-ref">Reference no.</label>
          <input id="eb-ref" type="text" maxLength={60} value={paymentMethod === "cash" ? "" : paymentRef}
            disabled={paymentMethod === "cash"} onChange={(e) => setPaymentRef(e.target.value)} />
        </div>
      </div>
      <p className="muted" style={{ margin: "4px 0 0", fontSize: 14 }}>
        {hours > 0 ? `${formatDuration(hours)} · amount ${formatPeso(amount)}` : "Choose a valid time."}
        {amount !== booking.amount && hours > 0 && ` (was ${formatPeso(booking.amount)})`}
        {booking.payment_status === "paid" && amount > booking.amount && " — already paid, collect the difference."}
        {booking.payment_status === "paid" && amount < booking.amount && " — already paid, refund the difference."}
      </p>
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      <div className="actions">
        <button type="button" className="btn secondary" onClick={onClose}>Close</button>
        <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}
