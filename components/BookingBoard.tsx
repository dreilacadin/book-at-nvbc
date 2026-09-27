"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateLong, formatDateShort, formatHour, formatRange } from "@/lib/format";
import {
  computePrice,
  formatPeso,
  PAYMENT_METHODS,
  RATE_TYPES,
  rateTypeLabel,
  type PaymentMethod,
  type PaymentStatus,
  type RateType,
} from "@/lib/pricing";
import { saveCode } from "@/lib/saved-codes";
import PaymentPanel from "./PaymentPanel";
import { isSport, sportLabel, type Sport } from "@/lib/sports";

type Availability = {
  sport: Sport;
  sports: { id: Sport; label: string; emoji: string; courtCount: number }[];
  date: string;
  today: string;
  currentHour: number;
  openHour: number;
  closeHour: number;
  maxHoursPerBooking: number;
  bookingWindowDays: number;
  lastBookableDate: string;
  announcement: string;
  pricing: {
    hourlyRate: number;
    memberDiscountPct: number;
    coachDiscountPct: number;
    memberCodeRequired: boolean;
    coachCodeRequired: boolean;
  };
  paymentMethods: PaymentMethod[];
  courts: { id: number; name: string }[];
  booked: { courtId: number; hour: number }[];
};

type Selection = { courtId: number; courtName: string; hour: number };
type Confirmed = {
  code: string;
  courtName: string;
  sport: Sport;
  date: string;
  startHour: number;
  endHour: number;
  rateType: RateType;
  discountPct: number;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
};

// The sport is already shown in the tab, so "Badminton Court 1" → "Court 1" in the grid header.
function shortName(name: string, sport: Sport) {
  const prefix = sportLabel(sport) + " ";
  return name.toLowerCase().startsWith(prefix.toLowerCase()) ? name.slice(prefix.length) : name;
}

function addDays(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function BookingBoard() {
  const [date, setDate] = useState<string | null>(null);
  // `undefined` = not decided yet (reading ?sport= from the URL); `null` = let the server pick.
  const [sport, setSport] = useState<Sport | null | undefined>(undefined);
  const [data, setData] = useState<Availability | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);

  // Allow links like /?sport=badminton
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("sport");
    setSport(isSport(q) ? q : null);
  }, []);

  const load = useCallback(async (d: string | null, sp: Sport | null) => {
    try {
      const qs = new URLSearchParams();
      if (d) qs.set("date", d);
      if (sp) qs.set("sport", sp);
      const res = await fetch(`/api/availability?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load availability");
      setData(json);
      setDate(json.date);
      setSport(json.sport);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load availability");
    }
  }, []);

  useEffect(() => {
    if (sport === undefined) return;
    load(date, sport);
    // Refresh every 30 seconds while the page is visible so the grid stays current.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load(date, sport);
    }, 30_000);
    return () => clearInterval(t);
  }, [date, sport, load]);

  function chooseSport(sp: Sport) {
    setSport(sp);
    const url = new URL(window.location.href);
    url.searchParams.set("sport", sp);
    window.history.replaceState(null, "", url);
  }

  const bookedSet = useMemo(
    () => new Set((data?.booked ?? []).map((b) => `${b.courtId}:${b.hour}`)),
    [data]
  );

  const dates = useMemo(() => {
    if (!data) return [];
    const list: string[] = [];
    for (let i = 0; i <= data.bookingWindowDays; i++) list.push(addDays(data.today, i));
    return list;
  }, [data]);

  if (!data) {
    return loadError ? <div className="error">{loadError}</div> : <p className="muted">Loading courts…</p>;
  }

  const hours: number[] = [];
  for (let h = data.openHour; h < data.closeHour; h++) hours.push(h);

  const isPast = (h: number) => data.date < data.today || (data.date === data.today && h <= data.currentHour);
  const isBooked = (courtId: number, h: number) => bookedSet.has(`${courtId}:${h}`);

  return (
    <>
      <h1>Reserve a court</h1>
      <p className="lead">
        Choose a sport and date, tap an open slot, and you&apos;re set — no account needed. Booked slots
        are shown without names.
      </p>

      {data.announcement && <div className="announcement">{data.announcement}</div>}

      <div className="sport-tabs" role="tablist" aria-label="Choose a sport">
        {data.sports
          .filter((s) => s.courtCount > 0 || s.id === data.sport)
          .map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={s.id === data.sport}
              onClick={() => chooseSport(s.id)}
            >
              <span className="sport-emoji" aria-hidden="true">{s.emoji}</span>
              <span>
                {s.label}
                <small>{s.courtCount} court{s.courtCount === 1 ? "" : "s"}</small>
              </span>
            </button>
          ))}
      </div>

      <div className="date-strip" role="group" aria-label="Choose a date">
        {dates.map((d) => {
          const f = formatDateShort(d);
          return (
            <button
              key={d}
              className="date-chip"
              aria-pressed={d === data.date}
              onClick={() => setDate(d)}
            >
              <div className="dow">{d === data.today ? "Today" : f.dow}</div>
              <div className="day">{f.day}</div>
              <div className="mon">{f.month}</div>
            </button>
          );
        })}
      </div>

      <div className="toolbar">
        <strong>{formatDateLong(data.date)}</strong>
        <div className="legend">
          <span><i className="swatch open" /> Open</span>
          <span><i className="swatch booked" /> Booked</span>
          <span><i className="swatch past" /> Past</span>
        </div>
      </div>

      {loadError && <div className="error" style={{ marginBottom: 12 }}>{loadError}</div>}

      {data.courts.length === 0 ? (
        <div className="card">No {sportLabel(data.sport).toLowerCase()} courts are open for booking right now.</div>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="time" scope="col">Time</th>
                {data.courts.map((c) => (
                  <th key={c.id} scope="col">{shortName(c.name, data.sport)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h}>
                  <th className="time" scope="row">{formatHour(h)}</th>
                  {data.courts.map((c) => {
                    if (isBooked(c.id, h))
                      return (
                        <td key={c.id}>
                          <div className="slot booked" aria-label={`${c.name} ${formatHour(h)} booked`}>Booked</div>
                        </td>
                      );
                    if (isPast(h))
                      return (
                        <td key={c.id}>
                          <div className="slot past" aria-label={`${c.name} ${formatHour(h)} past`}>—</div>
                        </td>
                      );
                    return (
                      <td key={c.id}>
                        <button
                          className="slot open"
                          aria-label={`Book ${c.name} at ${formatHour(h)}`}
                          onClick={() => setSelection({ courtId: c.id, courtName: c.name, hour: h })}
                        >
                          Open
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selection && (
        <BookingDialog
          data={data}
          selection={selection}
          isBooked={isBooked}
          onClose={() => setSelection(null)}
          onChanged={() => load(data.date, data.sport)}
        />
      )}
    </>
  );
}

function BookingDialog({
  data,
  selection,
  isBooked,
  onClose,
  onChanged,
}: {
  data: Availability;
  selection: Selection;
  isBooked: (courtId: number, h: number) => boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  // Longest run of consecutive free hours starting at the chosen slot, capped by the rules.
  const maxHours = useMemo(() => {
    let n = 0;
    while (
      n < data.maxHoursPerBooking &&
      selection.hour + n < data.closeHour &&
      !isBooked(selection.courtId, selection.hour + n)
    )
      n++;
    return Math.max(n, 1);
  }, [data, selection, isBooked]);

  const [hours, setHours] = useState(1);
  const [rateType, setRateType] = useState<RateType>("regular");
  const [rateCode, setRateCode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(data.paymentMethods[0] ?? "cash");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Confirmed | null>(null);
  const [copied, setCopied] = useState(false);

  const p = data.pricing;
  const discountPct = rateType === "member" ? p.memberDiscountPct : rateType === "coach" ? p.coachDiscountPct : 0;
  const price = computePrice(p.hourlyRate, hours, discountPct);
  const codeRequired = rateType === "member" ? p.memberCodeRequired : rateType === "coach" ? p.coachCodeRequired : false;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courtId: selection.courtId,
          date: data.date,
          startHour: selection.hour,
          hours,
          name,
          contact,
          notes,
          website,
          rateType,
          rateCode: codeRequired ? rateCode : "",
          paymentMethod,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Booking failed. Please try again.");
        if (res.status === 409) onChanged();
        return;
      }
      setDone(json);
      saveCode({
        code: json.code,
        date: json.date,
        label: `${sportLabel(json.sport)} · ${json.courtName} · ${formatDateLong(json.date)} · ${formatRange(json.startHour, json.endHour)}`,
      });
      onChanged();
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!done) return;
    try {
      await navigator.clipboard.writeText(done.code);
      setCopied(true);
    } catch {
      /* clipboard blocked — code is visible to copy by hand */
    }
  }

  const rateOptions = RATE_TYPES.map((r) => {
    const pct = r.id === "member" ? p.memberDiscountPct : r.id === "coach" ? p.coachDiscountPct : 0;
    return { ...r, pct };
  });

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="card modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div>
            <h2 id="dlg-title">You&apos;re booked! 🎉</h2>
            <div className="summary">
              <strong>{sportLabel(done.sport)} · {done.courtName}</strong>
              {formatDateLong(done.date)}
              <br />
              {formatRange(done.startHour, done.endHour)}
              {done.rateType !== "regular" && (
                <>
                  <br />
                  <span className="muted">{rateTypeLabel(done.rateType)} rate ({done.discountPct}% off)</span>
                </>
              )}
            </div>
            <p style={{ margin: 0 }}>Your booking code:</p>
            <div className="code-box">{done.code}</div>
            <p className="muted" style={{ fontSize: 14 }}>
              Take a screenshot or save this code. You&apos;ll need it to view, pay or cancel your booking on the{" "}
              <Link href="/my-booking">My booking</Link> page. It&apos;s also remembered on this device.
            </p>
            {done.amount > 0 && (
              <PaymentPanel
                code={done.code}
                amount={done.amount}
                method={done.paymentMethod}
                status={done.paymentStatus}
              />
            )}
            <div className="actions">
              <button className="btn secondary" onClick={copy}>{copied ? "Copied ✓" : "Copy code"}</button>
              <button className="btn" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 id="dlg-title">Book this {sportLabel(data.sport).toLowerCase()} court</h2>
            <div className="summary">
              <strong>{sportLabel(data.sport)} · {selection.courtName}</strong>
              {formatDateLong(data.date)}
              <br />
              {formatRange(selection.hour, selection.hour + hours)}
            </div>

            <div className="field">
              <label htmlFor="hours">How long?</label>
              <select id="hours" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {Array.from({ length: maxHours }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} hour{n > 1 ? "s" : ""} (until {formatHour(selection.hour + n)})
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label id="rate-label">Booking as</label>
              <div className="segmented" role="radiogroup" aria-labelledby="rate-label">
                {rateOptions.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={rateType === r.id}
                    onClick={() => setRateType(r.id)}
                  >
                    {r.label}
                    {r.pct > 0 && <small>−{r.pct}%</small>}
                  </button>
                ))}
              </div>
              {codeRequired && (
                <input
                  type="text"
                  aria-label={`${rateTypeLabel(rateType)} code`}
                  placeholder={`${rateTypeLabel(rateType)} code (ask the front desk)`}
                  required
                  autoComplete="off"
                  value={rateCode}
                  onChange={(e) => setRateCode(e.target.value)}
                  style={{ marginTop: 8 }}
                />
              )}
              {rateType !== "regular" && !codeRequired && (
                <p className="hint" style={{ margin: "6px 0 0" }}>
                  Staff may ask you to show proof that you&apos;re a {rateType}.
                </p>
              )}
            </div>

            <div className="field">
              <label htmlFor="name">
                Your name <span className="hint">— only staff can see this</span>
              </label>
              <input id="name" type="text" required minLength={2} maxLength={60} autoComplete="name"
                value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="contact">
                Mobile number <span className="hint">— in case staff need to reach you</span>
              </label>
              <input id="contact" type="tel" required minLength={7} maxLength={60} autoComplete="tel"
                placeholder="09XX XXX XXXX" value={contact} onChange={(e) => setContact(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="notes">Notes <span className="hint">(optional)</span></label>
              <textarea id="notes" maxLength={200} placeholder="e.g. number of players, need rackets/paddles"
                value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {p.hourlyRate > 0 && (
              <>
                <div className="field">
                  <label id="pay-label">How will you pay?</label>
                  <div className="pay-options" role="radiogroup" aria-labelledby="pay-label">
                    {PAYMENT_METHODS.filter((m) => data.paymentMethods.includes(m.id)).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="radio"
                        aria-checked={paymentMethod === m.id}
                        onClick={() => setPaymentMethod(m.id)}
                      >
                        <strong>{m.label}</strong>
                        <small>{m.hint}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="price-box" aria-live="polite">
                  <div className="pay-row">
                    <span>{formatPeso(price.hourlyRate)} × {hours} hour{hours > 1 ? "s" : ""}</span>
                    <span>{formatPeso(price.subtotal)}</span>
                  </div>
                  {price.discount > 0 && (
                    <div className="pay-row" style={{ color: "var(--brand)" }}>
                      <span>{rateTypeLabel(rateType)} discount ({discountPct}%)</span>
                      <span>−{formatPeso(price.discount)}</span>
                    </div>
                  )}
                  <div className="pay-row total">
                    <span>Total</span>
                    <span>{formatPeso(price.total)}</span>
                  </div>
                </div>
              </>
            )}

            {/* Honeypot: hidden from people, often filled in by spam bots. */}
            <div className="hp" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input id="website" type="text" tabIndex={-1} autoComplete="off"
                value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}

            <div className="actions">
              <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn" disabled={busy}>
                {busy ? "Booking…" : p.hourlyRate > 0 ? `Confirm · ${formatPeso(price.total)}` : "Confirm booking"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
