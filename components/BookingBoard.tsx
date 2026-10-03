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
  type ActiveStatus,
  type PaymentMethod,
  type PaymentStatus,
  type RateType,
} from "@/lib/pricing";
import { saveCode } from "@/lib/saved-codes";
import { loadMembership } from "@/lib/saved-membership";
import { minutesUntilStart, PAY_WINDOW_MINUTES, RELEASE_MINUTES } from "@/lib/booking-policy";
import BookingPolicy, { payByLabel } from "./BookingPolicy";
import AddToCalendar from "./AddToCalendar";
import BookingAlerts from "./BookingAlerts";
import WaitlistDialog from "./WaitlistDialog";
import BookingChat from "./BookingChat";
import { BookingHeader, Fold } from "./BookingSummary";
import BookingQr from "./BookingQr";
import PaymentPanel from "./PaymentPanel";
import { AdminBookingCard } from "@/app/admin/BookingLookup";
import { AuthError, type AdminBooking } from "@/app/admin/shared";
import { ACTIVITY_ID, setCustomActivities, sportLabel, type ActivityDef } from "@/lib/sports";
import FullScreenLoader from "./FullScreenLoader";

type Availability = {
  sport: string; // a sport or an activity (e.g. Zumba)
  sports: { id: string; label: string; emoji: string; courtCount: number }[];
  activities: ActivityDef[]; // custom activities, for their names
  pushKey: string | null; // for "notify me if this opens up"
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
  cashForCoaches: boolean; // cash (at the desk) is only for the coach rate + coach code
  courts: { id: number; name: string; notes: string; sharedFrom: string | null }[];
  // Booked times with the booker's first name and last initial ("Ana C.").
  bookings: { courtId: number; start: number; end: number; name: string; status: ActiveStatus }[];
  blocked: { courtId: number; hour: number; label: string }[]; // reserved times (Open Play, …)
};

type GridCell = {
  kind: "booking" | "blocked";
  label: string; // "Ana C." (full name in staff mode) or "Open Play"
  status?: ActiveStatus;
  admin?: AdminBooking; // staff mode: the full booking, opened on click
  start: number;
  end: number;
  span: number; // rows (half hours) the cell covers
};

const ROW_PX = 45; // height of one half-hour row: slot min-height 36 + padding 8 + border 1

type Selection = { courtId: number; courtName: string; hour: number };
type Confirmed = {
  code: string;
  courtName: string; // a group's courts, joined
  courts: string[];
  sport: string;
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
  status: ActiveStatus;
  payBy: string | null; // online: pay within the window or the slot is released
};

// The sport is already shown in the tab, so "Badminton Court 1" → "Court 1" in the grid header.
function shortName(name: string, sport: string) {
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
  const [sport, setSport] = useState<string | null | undefined>(undefined);
  const [waitFor, setWaitFor] = useState<{ start: number; end: number } | null>(null); // a taken slot: waitlist
  const [data, setData] = useState<Availability | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  // Staff mode: a logged-in admin sees full names and can open any booking right here.
  const [staff, setStaff] = useState<{ name: string } | null>(null);
  const [staffBookings, setStaffBookings] = useState<AdminBooking[]>([]);
  const [staffOpen, setStaffOpen] = useState<AdminBooking | null>(null);

  useEffect(() => {
    fetch("/api/admin/login", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setStaff(j.loggedIn ? { name: j.name } : null))
      .catch(() => {});
  }, []);

  const loadStaffBookings = useCallback(async (d: string) => {
    const res = await fetch(`/api/admin/bookings?date=${d}`, { cache: "no-store" });
    if (res.status === 401) {
      setStaff(null); // logged out (or session ended) — back to the public view
      setStaffBookings([]);
      return;
    }
    if (res.ok) setStaffBookings((await res.json()).bookings);
  }, []);

  useEffect(() => {
    if (staff && data?.date) loadStaffBookings(data.date);
    if (!staff) setStaffBookings([]);
  }, [staff, data, loadStaffBookings]);

  async function staffLogout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    setStaff(null);
    setStaffBookings([]);
    setStaffOpen(null);
  }

  // Allow links like /?sport=badminton&date=2026-10-12 (waitlist notifications link here).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const sp = q.get("sport");
    const d = q.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDate(d);
    setSport(sp && ACTIVITY_ID.test(sp) ? sp : null);
  }, []);

  const load = useCallback(async (d: string | null, sp: string | null) => {
    try {
      const qs = new URLSearchParams();
      if (d) qs.set("date", d);
      if (sp) qs.set("sport", sp);
      const res = await fetch(`/api/availability?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load availability");
      setCustomActivities(json.activities ?? []);
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

  function chooseSport(sp: string) {
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
    return loadError ? <div className="error">{loadError}</div> : <FullScreenLoader label="Loading courts…" />;
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
      const admin = staff
        ? staffBookings.find((x) => x.court_id === courtId && x.start_hour === b.start && x.status !== "cancelled")
        : undefined;
      return {
        kind: "booking", label: admin?.name ?? b.name, status: b.status, admin,
        start: b.start, end: b.end, span: (Math.min(b.end, last + SLOT_HOURS) - top) / SLOT_HOURS,
      };
    }
    const label = reservedFor(courtId, h);
    if (!label) return null;
    const same = (t: number) => reservedFor(courtId, t) === label && !data.bookings.some((x) => x.courtId === courtId && x.start <= t && t < x.end);
    if (h > first && same(h - SLOT_HOURS)) return "covered";
    let end = h + SLOT_HOURS;
    while (end <= last && same(end)) end += SLOT_HOURS;
    return { kind: "blocked", label, start: h, end, span: (end - h) / SLOT_HOURS };
  };
  // Taken = booked or reserved; either way it can't be part of a new booking.
  const isBooked = (courtId: number, h: number) => bookedSet.has(`${courtId}:${h}`) || blockedMap.has(`${courtId}:${h}`);

  const courtNotes = data.courts.filter((c) => c.notes);

  return (
    <>
      {staff && (
        <div className="staff-bar" role="status">
          <span>
            👤 <strong>Staff mode</strong> — {staff.name}. Full names are shown; click a booking to view, confirm, edit or cancel it.
          </span>
          <span className="staff-bar-actions">
            <Link href="/admin" className="btn small secondary">Admin panel</Link>
            <button type="button" className="btn small secondary" onClick={staffLogout}>Log out</button>
          </span>
        </div>
      )}
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
          <span><i className="swatch reserved" /> Reserved (coach)</span>
          {data.blocked.length > 0 && <span><i className="swatch blocked" /> Blocked</span>}
          <span><i className="swatch past" /> Past</span>
        </div>
      </div>

      {loadError && <div className="error" style={{ marginBottom: 12 }}>{loadError}</div>}
      {courtNotes.length > 0 && (
        <div className="court-notes">
          {courtNotes.map((c) => (
            <div key={c.id}><strong>ⓘ {shortName(c.name, data.sport)}:</strong> {c.notes}</div>
          ))}
        </div>
      )}

      {data.courts.length === 0 ? (
        <div className="card">No {sportLabel(data.sport).toLowerCase()} courts are open for booking right now.</div>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="time" scope="col">Time</th>
                {data.courts.map((c) => (
                  <th key={c.id} scope="col">
                    {shortName(c.name, data.sport)}
                    {c.notes && <span className="court-note-icon" title={c.notes} aria-label={`Note: ${c.notes}`}> ⓘ</span>}
                  </th>
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
                      const statusWord = cell.status === "pending" ? "Pending" : cell.status === "reserved" ? "Reserved" : "";
                      return cell.kind === "booking" ? (
                        <td key={c.id} rowSpan={cell.span}>
                          {cell.admin ? (
                            <button type="button" className={`slot booked ${cell.status} staff-click`} style={style}
                              onClick={() => setStaffOpen(cell.admin!)}
                              aria-label={`${c.name} ${formatRange(cell.start, cell.end)}: ${cell.label}${statusWord ? `, ${statusWord}` : ""} — open booking`}>
                              <span className="slot-name">{cell.label}</span>
                              {statusWord && <small>{statusWord}</small>}
                            </button>
                          ) : !staff && !isPast(cell.start) ? (
                            // Taken: tap to join the waitlist for this time.
                            <button type="button" className={`slot booked ${cell.status} wait-click`} style={style}
                              onClick={() => setWaitFor({ start: cell.start, end: cell.end })}
                              aria-label={`${c.name} ${formatRange(cell.start, cell.end)} booked by ${cell.label}${statusWord ? `, ${statusWord.toLowerCase()}` : ""} — tap to get notified if it opens up`}>
                              <span className="slot-name">{cell.label}</span>
                              {statusWord && <small>{statusWord}</small>}
                              <small className="wait-hint">🔔 Notify me</small>
                            </button>
                          ) : (
                            <div className={`slot booked ${cell.status}`} style={style}
                              aria-label={`${c.name} ${formatRange(cell.start, cell.end)} booked by ${cell.label}${statusWord ? `, ${statusWord.toLowerCase()}` : ""}`}>
                              <span className="slot-name">{cell.label}</span>
                              {statusWord && <small>{statusWord}</small>}
                            </div>
                          )}
                        </td>
                      ) : (
                        <td key={c.id} rowSpan={cell.span}>
                          <div className="slot blocked" style={style} title={cell.label}
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

      {staffOpen && (
        <div className="backdrop" onClick={() => setStaffOpen(null)}>
          <div className="card modal staff-modal" role="dialog" aria-modal="true" aria-label={`Booking ${staffOpen.code}`}
            onClick={(e) => e.stopPropagation()}>
            <AdminBookingCard
              key={staffOpen.id + staffOpen.status + staffOpen.payment_status}
              b={staffOpen}
              onAuthError={(e) => { if (e instanceof AuthError) { setStaff(null); setStaffOpen(null); } }}
              onChanged={async () => {
                await load(data.date, data.sport);
                const res = await fetch(`/api/admin/bookings?code=${staffOpen.code}`, { cache: "no-store" });
                if (res.ok) setStaffOpen(await res.json());
                else setStaffOpen(null);
              }}
            />
            <div className="actions">
              <Link href="/admin" className="btn secondary">Open admin panel</Link>
              <button type="button" className="btn" onClick={() => setStaffOpen(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {waitFor && (
        <WaitlistDialog sport={data.sport} date={data.date} start={waitFor.start} end={waitFor.end}
          pushKey={data.pushKey} onClose={() => setWaitFor(null)} />
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
  // Group booking: other courts free for the same time, booked together under one code and payment.
  const freeOthers = useMemo(
    () =>
      data.courts.filter(
        (c) => c.id !== selection.courtId && halfHours(selection.hour, selection.hour + hours - SLOT_HOURS).every((h) => !isBooked(c.id, h))
      ),
    [data, selection, hours, isBooked]
  );
  const [extra, setExtra] = useState<number[]>([]);
  const extraIds = extra.filter((id) => freeOthers.some((c) => c.id === id)); // still free for the chosen length
  const courtCount = 1 + extraIds.length;
  const [rateType, setRateType] = useState<RateType>("regular");
  // A member's code is saved on their phone when they open their member page: fill it in.
  const [rateCode, setRateCode] = useState(() => (typeof window === "undefined" ? "" : loadMembership()?.memberCode ?? ""));
  // Unpaid bookings are released RELEASE_MINUTES before the start: too late to book online.
  const startsSoon = minutesUntilStart(data.date, selection.hour, { date: data.today, time: data.currentHour }) <= RELEASE_MINUTES;
  // Online payment for everyone; cash at the desk only for coaches (coach rate + coach code).
  const onlineMethods = data.paymentMethods.filter((m) => m !== "cash");
  const cashOk = rateType === "coach" && data.cashForCoaches;
  const methodChoices = PAYMENT_METHODS.filter((m) => (m.id === "cash" ? cashOk : onlineMethods.includes(m.id)));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(onlineMethods[0] ?? "cash");
  useEffect(() => {
    if (paymentMethod === "cash" && !cashOk) setPaymentMethod(onlineMethods[0] ?? "cash");
  }, [cashOk, paymentMethod, onlineMethods]);
  const court = data.courts.find((c) => c.id === selection.courtId);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Confirmed | null>(null);
  const [copied, setCopied] = useState(false);

  const p = data.pricing;
  const price = computePrice(rateFor(p.rates, rateType), hours, p.rates.regular);
  const total = Math.round(price.total * courtCount * 100) / 100; // a group pays for every court
  const hasPrices = p.rates.regular > 0 || p.rates.member > 0 || p.rates.coach > 0;
  const standardOnly = p.rateTypes.length === 1;
  const rateName = standardOnly ? "Standard" : rateTypeLabel(rateType);
  const noWayToPay = hasPrices && price.total > 0 && methodChoices.length === 0;
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
          email,
          notes,
          website,
          sport: data.sport,
          extraCourtIds: extraIds,
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
            <h2 id="dlg-title">
              {done.status === "reserved" ? "Slot reserved 🏸"
                : done.status === "pending" && done.paymentStatus === "unpaid" ? "Complete your payment"
                : done.status === "pending" ? "Booking received"
                : "You're booked! 🎉"}
            </h2>
            <BookingHeader
              b={done}
              extra={done.rateType !== "regular" ? `${rateTypeLabel(done.rateType)} rate · ${formatPeso(done.hourlyRate)}/hour` : undefined}
            />
            {court?.notes && <div className="court-note">ⓘ {court.notes}</div>}
            <div className="folds">
              <Fold icon="🎟️" title="Booking QR code" hint={done.code}
                defaultOpen={!(done.status === "pending" && done.paymentStatus === "unpaid")}>
                <BookingQr code={done.code} />
                <p className="hint" style={{ margin: 0, textAlign: "center" }}>
                  Screenshot it or save the code — you&apos;ll need it on <Link href="/my-booking">My booking</Link> to view, pay
                  or cancel. It&apos;s also remembered on this device.
                </p>
              </Fold>
              <BookingChat code={done.code} />
              <AddToCalendar code={done.code} sport={done.sport} courts={done.courtName} date={done.date}
                startHour={done.startHour} endHour={done.endHour} />
              <BookingAlerts code={done.code} />
            </div>
            {done.amount > 0 && done.paymentStatus !== "paid" && done.paymentStatus !== "waived" && (
              <PaymentPanel
                code={done.code}
                amount={done.amount}
                method={done.paymentMethod}
                status={done.paymentStatus}
                reference={done.paymentRef}
                hasProof={done.hasProof}
                payBy={payByLabel(done.date, done.startHour)}
                deadline={done.payBy}
                onUpdated={(u) => setDone({ ...done, paymentStatus: u.paymentStatus, paymentRef: u.paymentRef, hasProof: u.hasProof, payBy: null })}
              />
            )}
            {done.amount > 0 && (
              <div className="folds">
                <Fold icon="ⓘ" title="Good to know">
                  <BookingPolicy title="Payments and refunds" />
                </Fold>
              </div>
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
            {court?.notes && (
              <div className="court-note">
                <strong>Please note:</strong> {court.notes}
              </div>
            )}
            {startsSoon && (
              <div className="error" style={{ marginTop: 12 }}>
                This slot starts in less than {RELEASE_MINUTES} minutes and can&apos;t be booked online — please book it at the
                front desk.
              </div>
            )}

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

            {freeOthers.length > 0 && (
              <details className="field more-courts" open={extraIds.length > 0}>
                <summary>👥 Booking for a group? Add more courts at the same time{extraIds.length ? ` (${courtCount} courts)` : ""}</summary>
                <div className="court-checks" style={{ marginTop: 8 }}>
                  {freeOthers.map((c) => (
                    <label key={c.id}>
                      <input type="checkbox" checked={extraIds.includes(c.id)}
                        onChange={(e) => setExtra(e.target.checked ? [...extraIds, c.id] : extraIds.filter((x) => x !== c.id))} />
                      {c.name}
                    </label>
                  ))}
                </div>
                <p className="hint" style={{ margin: "6px 0 0" }}>One booking code and one payment for all the courts.</p>
              </details>
            )}

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
                    placeholder={rateType === "member" ? "Your member code (NVBC-XXXX-XXXX)" : "Coach code (ask the front desk)"}
                    required
                    autoComplete="off"
                    spellCheck={false}
                    value={rateCode}
                    onChange={(e) => setRateCode(e.target.value)}
                    style={{ marginTop: 8, textTransform: rateType === "member" ? "uppercase" : undefined }}
                  />
                )}
                {rateType === "member" && (
                  <p className="hint" style={{ margin: "6px 0 0" }}>
                    It&apos;s under the QR code on your member card. Not a member yet?{" "}
                    <Link href="/membership">Become a member</Link>.
                  </p>
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
              <label htmlFor="email">
                Email <span className="hint">(optional) — we&apos;ll email you when your payment is confirmed and before your time</span>
              </label>
              <input id="email" type="email" maxLength={120} autoComplete="email" placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)} />
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
                    {methodChoices.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="radio"
                        aria-checked={paymentMethod === m.id}
                        onClick={() => setPaymentMethod(m.id)}
                      >
                        <strong>{m.label}</strong>
                        <small>{m.id === "cash" ? "Coaches: pay at the front desk" : m.hint}</small>
                      </button>
                    ))}
                  </div>
                  <p className="hint" style={{ margin: "6px 0 0" }}>
                    {paymentMethod === "cash"
                      ? `Your slot will be Reserved — please pay at the front desk at least ${RELEASE_MINUTES} minutes before your start time.`
                      : `After booking, you'll have ${PAY_WINDOW_MINUTES} minutes to pay and send your receipt or reference number.`}
                    {!cashOk && data.cashForCoaches && p.rateTypes.includes("coach") && " Cash is only for coaches (coach rate + coach code)."}
                  </p>
                  {noWayToPay && (
                    <p className="error" style={{ marginTop: 8 }}>
                      Online payment isn&apos;t available right now — please book at the front desk.
                    </p>
                  )}
                </div>

                <div className="price-box" aria-live="polite">
                  <div className="pay-row">
                    <span>
                      {p.weekend ? "Weekend " + rateName.toLowerCase() : rateName} rate {formatPeso(price.hourlyRate)}/hr × {formatDuration(hours)}
                      {courtCount > 1 && ` × ${courtCount} courts`}
                    </span>
                    <span>{formatPeso(total)}</span>
                  </div>
                  {price.savings > 0 && (
                    <div className="pay-row" style={{ color: "var(--brand)", fontSize: 14 }}>
                      <span>You save vs. regular ({formatPeso(price.regularRate)}/hr)</span>
                      <span>{formatPeso(price.savings)}</span>
                    </div>
                  )}
                  <div className="pay-row total">
                    <span>Total</span>
                    <span>{formatPeso(total)}</span>
                  </div>
                </div>

              </>
            )}

            {hasPrices && price.total > 0 && <BookingPolicy />}

            {/* Honeypot: hidden from people, often filled in by spam bots. */}
            <div className="hp" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input id="website" type="text" tabIndex={-1} autoComplete="off"
                value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}

            <div className="actions">
              <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn" disabled={busy || startsSoon || noWayToPay}>
                {busy ? "Booking…"
                  : !hasPrices || price.total <= 0 ? "Confirm booking"
                  : paymentMethod === "cash" ? `Reserve · ${formatPeso(total)}`
                  : `Book & pay · ${formatPeso(total)}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
