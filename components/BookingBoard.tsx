"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatDateLong,
  formatDateShort,
  formatDuration,
  formatHour,
  formatRange,
  halfHours,
  publicName,
  SLOT_HOURS,
} from "@/lib/format";
import {
  computePrice,
  formatPeso,
  paymentLabel,
  rateFor,
  type SportRates,
  PAYMENT_METHODS,
  RATE_TYPES,
  rateTypeLabel,
  type PaymentMethod,
  type PaymentStatus,
  type RateType,
} from "@/lib/pricing";
import { saveCode } from "@/lib/saved-codes";
import PaymentPanel, { PaymentDetails, ProofFields, usePaymentInfo } from "./PaymentPanel";
import { isSport, sportLabel, type Sport } from "@/lib/sports";

type Availability = {
  sport: Sport;
  sports: { id: Sport; label: string; emoji: string; courtCount: number }[];
  date: string;
  today: string;
  currentHour: number; // time of day in hours, e.g. 10.75 at 10:45
  openHour: number;
  closeHour: number;
  maxHoursPerBooking: number;
  bookingWindowDays: number;
  lastBookableDate: string;
  announcement: string;
  pricing: {
    rates: SportRates; // ₱ per court per hour on this date: regular / member / coach
    rateTypes: RateType[]; // just ["regular"] when the sport has one standard rate
    weekend: boolean; // this date uses the sport's weekend prices
    memberCodeRequired: boolean;
    coachCodeRequired: boolean;
  };
  paymentMethods: PaymentMethod[];
  courts: { id: number; name: string }[];
  // Booked times with the booker's first name and last initial ("Ana C.").
  bookings: { courtId: number; start: number; end: number; name: string; status: "pending" | "confirmed" }[];
  blocked: { courtId: number; hour: number; label: string }[]; // reserved times (Open Play, …)
};

type GridCell = {
  kind: "booking" | "reserved";
  label: string; // "Ana C." or "Open Play"
  status?: "pending" | "confirmed";
  start: number;
  end: number;
  span: number; // rows (half hours) the cell covers
};

const ROW_PX = 45; // height of one half-hour row: slot min-height 36 + padding 8 + border 1

type Selection = { courtId: number; courtName: string; hour: number };
type Confirmed = {
  code: string;
  courtName: string;
  sport: Sport;
  date: string;
  startHour: number;
  endHour: number;
  rateType: RateType;
  hourlyRate: number;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentRef: string;
  hasProof: boolean;
  status: "pending" | "confirmed";
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

  const bookedSet = useMemo(() => {
    const set = new Set<string>();
    for (const b of data?.bookings ?? []) for (const h of halfHours(b.start, b.end - SLOT_HOURS)) set.add(`${b.courtId}:${h}`);
    return set;
  }, [data]);
  const blockedMap = useMemo(
    () => new Map((data?.blocked ?? []).map((b) => [`${b.courtId}:${b.hour}`, b.label])),
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

  const slots = halfHours(data.openHour, data.closeHour - SLOT_HOURS);

  const isPast = (h: number) => data.date < data.today || (data.date === data.today && h <= data.currentHour);
  const reservedFor = (courtId: number, h: number) => blockedMap.get(`${courtId}:${h}`);
  const first = slots[0];
  const last = slots[slots.length - 1];
  /**
   * What fills a grid cell: a booking or a reserved run (merged over its rows, starting at its
   * first visible row), "covered" for the rows under it, or null for a free slot.
   */
  const cellAt = (courtId: number, h: number): GridCell | "covered" | null => {
    const b = data.bookings.find((x) => x.courtId === courtId && x.start <= h && h < x.end);
    if (b) {
      const top = Math.max(b.start, first);
      if (h !== top) return "covered";
      return { kind: "booking", label: b.name, status: b.status, start: b.start, end: b.end, span: (Math.min(b.end, last + SLOT_HOURS) - top) / SLOT_HOURS };
    }
    const label = reservedFor(courtId, h);
    if (!label) return null;
    const same = (t: number) => reservedFor(courtId, t) === label && !data.bookings.some((x) => x.courtId === courtId && x.start <= t && t < x.end);
    if (h > first && same(h - SLOT_HOURS)) return "covered";
    let end = h + SLOT_HOURS;
    while (end <= last && same(end)) end += SLOT_HOURS;
    return { kind: "reserved", label, start: h, end, span: (end - h) / SLOT_HOURS };
  };
  // Taken = booked or reserved; either way it can't be part of a new booking.
  const isBooked = (courtId: number, h: number) => bookedSet.has(`${courtId}:${h}`) || blockedMap.has(`${courtId}:${h}`);

  return (
    <>
      <h1>Reserve a court</h1>
      <p className="lead">
        Choose a sport and date, tap an open slot, and you&apos;re set — no account needed. Booked slots
        show the booker&apos;s first name and last initial.
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
          <span><i className="swatch confirmed" /> Booked</span>
          <span><i className="swatch pending" /> Pending payment</span>
          {data.blocked.length > 0 && <span><i className="swatch reserved" /> Reserved</span>}
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
              {slots.map((h) => (
                <tr key={h} className={h % 1 ? "half" : undefined}>
                  <th className="time" scope="row">{formatHour(h)}</th>
                  {data.courts.map((c) => {
                    const cell = cellAt(c.id, h);
                    if (cell === "covered") return null; // part of a merged cell above
                    if (cell) {
                      const style = { minHeight: cell.span * ROW_PX - 9 };
                      return cell.kind === "booking" ? (
                        <td key={c.id} rowSpan={cell.span}>
                          <div className={`slot booked ${cell.status}`} style={style}
                            aria-label={`${c.name} ${formatRange(cell.start, cell.end)} booked by ${cell.label}${cell.status === "pending" ? ", pending payment" : ""}`}>
                            <span className="slot-name">{cell.label}</span>
                            {cell.status === "pending" && <small>Pending</small>}
                          </div>
                        </td>
                      ) : (
                        <td key={c.id} rowSpan={cell.span}>
                          <div className="slot reserved" style={style} title={cell.label}
                            aria-label={`${c.name} ${formatRange(cell.start, cell.end)} reserved for ${cell.label}`}>
                            {cell.label}
                          </div>
                        </td>
                      );
                    }
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
  // Longest run of free half hours starting at the chosen slot, capped by the rules.
  const maxHours = useMemo(() => {
    let n = 0;
    while (
      n < data.maxHoursPerBooking &&
      selection.hour + n < data.closeHour &&
      !isBooked(selection.courtId, selection.hour + n)
    )
      n += SLOT_HOURS;
    return Math.max(n, SLOT_HOURS);
  }, [data, selection, isBooked]);

  const [hours, setHours] = useState(() => Math.min(1, maxHours));
  const [rateType, setRateType] = useState<RateType>("regular");
  const [rateCode, setRateCode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(data.paymentMethods[0] ?? "cash");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentProof, setPaymentProof] = useState("");
  const { info: payInfo } = usePaymentInfo();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Confirmed | null>(null);
  const [copied, setCopied] = useState(false);

  const p = data.pricing;
  const price = computePrice(rateFor(p.rates, rateType), hours, p.rates.regular);
  const hasPrices = p.rates.regular > 0 || p.rates.member > 0 || p.rates.coach > 0;
  const standardOnly = p.rateTypes.length === 1;
  const rateName = standardOnly ? "Standard" : rateTypeLabel(rateType);
  // Online payments are paid before booking; the booking goes through only with proof.
  const payFirst = hasPrices && paymentMethod !== "cash" && price.total > 0;
  const codeRequired = rateType === "member" ? p.memberCodeRequired : rateType === "coach" ? p.coachCodeRequired : false;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (payFirst && !paymentRef.trim() && !paymentProof)
      return setError(`Please pay by ${paymentLabel(paymentMethod)}, then enter the reference number or upload a screenshot of the receipt.`);
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
          paymentRef: payFirst ? paymentRef : "",
          paymentProof: payFirst ? paymentProof : "",
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

  const rateOptions = RATE_TYPES.filter((r) => p.rateTypes.includes(r.id)).map((r) => ({ ...r, rate: rateFor(p.rates, r.id) }));

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
            {done.status === "pending" ? (
              <>
                <h2 id="dlg-title">Slot held — verifying payment</h2>
                <p className="notice" style={{ marginTop: 0 }}>
                  Your booking is <strong>Pending</strong> until staff verify your {paymentLabel(done.paymentMethod)} payment.
                  It becomes <strong>Confirmed</strong> once verified.
                </p>
              </>
            ) : (
              <h2 id="dlg-title">You&apos;re booked! 🎉</h2>
            )}
            <div className="summary">
              <strong>{sportLabel(done.sport)} · {done.courtName}</strong>
              {formatDateLong(done.date)}
              <br />
              {formatRange(done.startHour, done.endHour)}
              {done.rateType !== "regular" && (
                <>
                  <br />
                  <span className="muted">{rateTypeLabel(done.rateType)} rate · {formatPeso(done.hourlyRate)}/hour</span>
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
                reference={done.paymentRef}
                hasProof={done.hasProof}
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
                {halfHours(SLOT_HOURS, maxHours).map((n) => (
                  <option key={n} value={n}>
                    {formatDuration(n)} (until {formatHour(selection.hour + n)})
                  </option>
                ))}
              </select>
            </div>

            {!standardOnly && (
              <div className="field">
                <label id="rate-label">
                  Booking as{p.weekend && hasPrices && <span className="hint"> — weekend prices</span>}
                </label>
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
                      {hasPrices && <small>{formatPeso(r.rate)}/hr</small>}
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
            )}

            <div className="field">
              <label htmlFor="name">
                Your name{" "}
                <span className="hint">— the schedule shows {name.trim() ? `“${publicName(name)}”` : "your first name and last initial"}</span>
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

            {hasPrices && (
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
                    <span>
                      {p.weekend ? "Weekend " + rateName.toLowerCase() : rateName} rate {formatPeso(price.hourlyRate)}/hr × {formatDuration(hours)}
                    </span>
                    <span>{formatPeso(price.total)}</span>
                  </div>
                  {price.savings > 0 && (
                    <div className="pay-row" style={{ color: "var(--brand)", fontSize: 14 }}>
                      <span>You save vs. regular ({formatPeso(price.regularRate)}/hr)</span>
                      <span>{formatPeso(price.savings)}</span>
                    </div>
                  )}
                  <div className="pay-row total">
                    <span>Total</span>
                    <span>{formatPeso(price.total)}</span>
                  </div>
                </div>

                {payFirst && (
                  <div className="pay-box">
                    <strong>Pay now to book</strong>
                    {payInfo && <PaymentDetails info={payInfo} method={paymentMethod} amount={price.total} />}
                    <p className="muted" style={{ fontSize: 14, margin: "10px 0 8px" }}>
                      After paying, enter the reference number or upload a screenshot of the receipt. Staff confirm
                      your booking once they verify the payment.
                    </p>
                    <ProofFields reference={paymentRef} onReference={setPaymentRef} proof={paymentProof} onProof={setPaymentProof} />
                  </div>
                )}
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
                {busy ? "Booking…" : hasPrices ? `Confirm · ${formatPeso(price.total)}` : "Confirm booking"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
