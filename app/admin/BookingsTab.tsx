"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import { awaitingPayment, minutesUntilStart, startedUnverified } from "@/lib/booking-policy";
import { formatDateLong, formatHour, formatRange, halfHours } from "@/lib/format";
import {
  formatPeso,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  paymentLabel,
  paymentStatusLabel,
  RATE_TYPES,
  type PaymentMethod,
  type PaymentStatus,
  type RateType,
} from "@/lib/pricing";
import { SPORTS, sportEmoji, sportLabel, type Sport } from "@/lib/sports";
import { nowAtFacility } from "@/lib/time";
import BookingLookup, { AdminBookingCard, displayLabel, displayStatus, releaseNote, type DisplayStatus } from "./BookingLookup";
import { api, todayManila, type AdminBooking, type Court } from "./shared";

type Filter = "all" | "action" | "verify" | "upcoming" | "in_progress" | "completed";
const FILTERS: [Filter, string][] = [
  ["all", "All bookings"],
  ["action", "Needs payment"],
  ["verify", "Payment to verify"],
  ["upcoming", "Upcoming"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
];
const GROUP_KEY = "nvbc_bookings_group";

function shiftDate(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Chronological: start time, then court order. */
const byTime = (a: AdminBooking, b: AdminBooking) =>
  a.start_hour - b.start_hour || a.court_order - b.court_order || a.court_name.localeCompare(b.court_name);

/**
 * Staff: one day's bookings as a compact, mobile-friendly list. Tap a booking to manage it
 * (payment, progress, edit, cancel, restore).
 */
export default function BookingsTab({
  initialDate,
  initialOpen = null,
  onDateChange,
  onAuthError,
}: {
  initialDate: string;
  initialOpen?: string | null; // a booking to open straight away (e.g. clicked in the Overview)
  onDateChange: (date: string) => void; // remembered while switching tabs
  onAuthError: (e: unknown) => void;
}) {
  const [date, setDateState] = useState(initialDate);
  const setDate = (d: string) => {
    setDateState(d);
    onDateChange(d);
    setOpen(null);
  };
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [scrollTo, setScrollTo] = useState<string | null>(initialOpen);
  const [filter, setFilter] = useState<Filter>("all");
  const [bySport, setBySport] = useState(false);
  const [, setTick] = useState(0); // re-render every 30 s: In progress / Completed follow the clock

  useEffect(() => {
    try {
      setBySport(localStorage.getItem(GROUP_KEY) === "sport");
    } catch {
      /* storage unavailable */
    }
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const chooseGrouping = (sport: boolean) => {
    setBySport(sport);
    try {
      localStorage.setItem(GROUP_KEY, sport ? "sport" : "all");
    } catch {
      /* storage unavailable */
    }
  };

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const [b, c] = await Promise.all([
          api<{ bookings: AdminBooking[] }>(`/api/admin/bookings?date=${date}`),
          api<{ courts: Court[] }>("/api/admin/courts"),
        ]);
        setBookings(b.bookings);
        setCourts(c.courts);
        setError("");
      } catch (e) {
        onAuthError(e);
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [date, onAuthError]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Keep the day fresh (new bookings, payments sent, releases) while the tab is open.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && load(true), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const now = nowAtFacility();
  const active = bookings.filter((b) => b.status !== "cancelled");
  const gone = bookings.filter((b) => b.status === "cancelled").sort(byTime);
  const billed = active.filter((b) => b.payment_status !== "waived").reduce((s, b) => s + b.amount, 0);
  const collected = bookings.filter((b) => b.payment_status === "paid").reduce((s, b) => s + b.amount, 0);
  const unpaid = active.filter((b) => awaitingPayment(b.payment_status)).reduce((s, b) => s + b.amount, 0);
  const toVerify = active.filter((b) => b.payment_status === "for_verification").length;

  const matches = (b: AdminBooking) => {
    const d = displayStatus(b);
    if (filter === "action") return d === "pending" || d === "reserved";
    if (filter === "verify") return b.payment_status === "for_verification";
    if (filter === "upcoming") return (d === "pending" || d === "reserved" || d === "confirmed") && minutesUntilStart(b.date, b.start_hour, now) > 0;
    if (filter === "in_progress" || filter === "completed") return d === filter;
    return true;
  };
  // Opened from the Overview: show all bookings (not a filter that hides it), expand the cancelled
  // section if it's in there, and scroll it into view once the list has loaded.
  useEffect(() => {
    if (!scrollTo || loading) return;
    const b = bookings.find((x) => x.id === scrollTo);
    if (!b) return setScrollTo(null);
    setFilter("all");
    requestAnimationFrame(() => {
      const el = document.getElementById(`bk-${scrollTo}`);
      const gone = el?.closest("details");
      if (gone) gone.open = true;
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      setScrollTo(null);
    });
  }, [scrollTo, loading, bookings]);

  const shown = useMemo(() => active.filter(matches).sort(byTime), [bookings, filter, now.time]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups: { key: string; title?: string; list: AdminBooking[] }[] = bySport
    ? SPORTS.map((sp) => ({ key: sp.id, title: `${sp.emoji} ${sp.label}`, list: shown.filter((b) => b.sport === sp.id) })).filter((g) => g.list.length)
    : [{ key: "all", list: shown }];

  const row = (b: AdminBooking) => (
    <BookingRow key={b.id} b={b} open={open === b.id} onToggle={() => setOpen(open === b.id ? null : b.id)} showSport={!bySport}>
      <AdminBookingCard key={b.id + b.status + b.payment_status + (b.phase ?? "")} b={b} onAuthError={onAuthError}
        onChanged={() => load(true)} />
    </BookingRow>
  );

  return (
    <div className="stack bookings-tab">
      <div className="day-nav">
        <button type="button" className="btn small secondary" aria-label="Previous day" onClick={() => setDate(shiftDate(date, -1))}>‹</button>
        <input type="date" aria-label="Date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button type="button" className="btn small secondary" aria-label="Next day" onClick={() => setDate(shiftDate(date, 1))}>›</button>
        {date !== todayManila() && <button type="button" className="btn small secondary" onClick={() => setDate(todayManila())}>Today</button>}
        <span className="day-nav-actions">
          <button type="button" className="btn small secondary" aria-pressed={showScan} onClick={() => setShowScan((v) => !v)}>📷 Scan</button>
          <button type="button" className="btn small" onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Close" : "+ Add"}</button>
        </span>
      </div>
      <p className="muted" style={{ margin: 0 }}>{formatDateLong(date)}</p>

      {showScan && <BookingLookup onChanged={() => load(true)} onOpenDate={setDate} onAuthError={onAuthError} />}
      {showAdd && (
        <AddBooking date={date} courts={courts} onAuthError={onAuthError}
          onAdded={() => { setShowAdd(false); load(true); }} />
      )}

      <div className="day-summary">
        <span><strong>{active.length}</strong> booking{active.length === 1 ? "" : "s"}</span>
        <span><strong>{formatPeso(billed)}</strong> billed</span>
        <span><strong>{formatPeso(collected)}</strong> paid</span>
        {unpaid > 0 && <span><strong>{formatPeso(unpaid)}</strong> unpaid</span>}
        {toVerify > 0 && (
          <button type="button" className="chip warn" onClick={() => setFilter(filter === "verify" ? "all" : "verify")}>
            {toVerify} to verify {filter === "verify" ? "✕" : "→"}
          </button>
        )}
      </div>

      <div className="list-controls">
        <div className="segmented grouping" role="radiogroup" aria-label="Group">
          <button type="button" role="radio" aria-checked={!bySport} onClick={() => chooseGrouping(false)}>Together</button>
          <button type="button" role="radio" aria-checked={bySport} onClick={() => chooseGrouping(true)}>By sport</button>
        </div>
        <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          {FILTERS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && <FullScreenLoader label="Loading bookings…" />}

      {!loading && shown.length === 0 && (
        <p className="muted">{filter === "all" ? "No bookings on this date." : "No bookings match this filter."}</p>
      )}
      {groups.map((g) => (
        <section key={g.key} className="bk-group">
          {g.title && <h3 className="bk-group-title">{g.title} <span className="muted">· {g.list.length}</span></h3>}
          <div className="bk-list">{g.list.map(row)}</div>
        </section>
      ))}

      {gone.length > 0 && (
        <details className="bk-gone">
          <summary>Cancelled &amp; released ({gone.length})</summary>
          <div className="bk-list">{gone.map(row)}</div>
        </details>
      )}
    </div>
  );
}

/** One booking as a compact row; tap to open its management card underneath. */
function BookingRow({
  b,
  open,
  onToggle,
  showSport,
  children,
}: {
  b: AdminBooking;
  open: boolean;
  onToggle: () => void;
  showSport: boolean;
  children: React.ReactNode;
}) {
  const d: DisplayStatus = displayStatus(b);
  const release = releaseNote(b);
  const flags: string[] = [];
  const now = nowAtFacility();
  if (startedUnverified(b, now)) flags.push("⚠ Started — payment not verified");
  // Played (time is over) but never paid — e.g. older bookings confirmed before payment was required.
  else if (b.status !== "cancelled" && awaitingPayment(b.payment_status) && b.amount > 0 && !b.phase && minutesUntilStart(b.date, b.end_hour, now) <= 0)
    flags.push("⚠ Ended — not paid");
  else if (b.payment_status === "for_verification") flags.push(b.rejected_at ? "⚠ Verify payment (sent again)" : "⚠ Verify payment");
  else if (b.status !== "cancelled" && b.payment_status === "rejected") flags.push("✕ Payment rejected — waiting for customer");
  if (release) flags.push(release.replace(/^Released at /, "Releases "));
  if (b.expired_member_id && !b.expired_member_reminded) flags.push("⚠ Membership expired");
  if (b.group_size > 1) flags.push(`👥 Group of ${b.group_size} · ${b.group_code}`);
  if (b.sport !== b.court_sport) flags.push(`${sportEmoji(b.sport)} ${sportLabel(b.sport)}`);
  if (b.unread_messages > 0) flags.push(`💬 ${b.unread_messages} new message${b.unread_messages > 1 ? "s" : ""}`);
  if (b.payment_reuse.some((o) => o.same_proof)) flags.push("⚠ Screenshot used before");
  else if (b.payment_reuse.length > 0) flags.push("⚠ Reference used before");
  return (
    <div className={`bk-item${open ? " open" : ""}`} id={`bk-${b.id}`}>
      <button type="button" className={`bk-row status-${d}`} aria-expanded={open} onClick={onToggle}>
        <span className="bk-time">
          {formatHour(b.start_hour)}
          <small>{formatHour(b.end_hour)}</small>
        </span>
        <span className="bk-main">
          <strong className="bk-name">{b.name}</strong>
          <span className="bk-sub">
            {showSport ? `${sportEmoji(b.sport)} ` : ""}{b.court_name} · {formatPeso(b.amount)} · {paymentLabel(b.payment_method)}
            {b.payment_status !== "unpaid" ? ` · ${paymentStatusLabel(b.payment_status)}` : ""}
          </span>
          {flags.length > 0 && <span className="bk-flags">{flags.join(" · ")}</span>}
        </span>
        <span className={`pill status-${d}`}>{displayLabel(d)}</span>
      </button>
      {open && <div className="bk-detail">{children}</div>}
    </div>
  );
}

function AddBooking({
  date,
  courts,
  onAdded,
  onAuthError,
}: {
  date: string;
  courts: Court[];
  onAdded: () => void;
  onAuthError: (e: unknown) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [start, setStart] = useState(8);
  const [end, setEnd] = useState(10);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [rateType, setRateType] = useState<RateType>("regular");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("unpaid");
  const [noCharge, setNoCharge] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const hourOptions = halfHours(0, 24);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length === 0) return setError("Choose at least one court.");
    if (end <= start) return setError("End time must be after start time.");
    setBusy(true);
    setError("");
    const failures: string[] = [];
    for (const courtId of selected) {
      try {
        await api("/api/admin/bookings", {
          action: "create",
          courtId,
          date,
          startHour: start,
          hours: end - start,
          name,
          contact,
          notes,
          rateType,
          paymentMethod,
          paymentStatus,
          noCharge,
        });
      } catch (err) {
        onAuthError(err);
        const cname = courts.find((c) => c.id === courtId)?.name ?? courtId;
        failures.push(`${cname}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    setBusy(false);
    if (failures.length) setError(failures.join(" · "));
    else onAdded();
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Add booking or block courts — {formatDateLong(date)}</h2>
      <p className="muted" style={{ marginTop: -6, fontSize: 14 }}>
        Use this for walk-ins, phone bookings, tournaments or maintenance. Staff bookings ignore the
        player limits and member/coach codes (check the member&apos;s QR in Members). Blocked slots show as &ldquo;Booked&rdquo; to the public.
      </p>
      <div className="field">
        <label>Courts</label>
        {SPORTS.map((sp) => {
          const list = courts.filter((c) => c.sport === sp.id);
          if (list.length === 0) return null;
          return (
            <div key={sp.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <span style={{ minWidth: 100, fontSize: 14 }}>{sp.emoji} {sp.label}</span>
              {list.map((c) => (
                <label key={c.id} style={{ fontWeight: 400, display: "inline-flex", gap: 6, alignItems: "center", margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={(e) =>
                      setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))
                    }
                  />
                  {c.name}
                  {!c.is_active && <span className="hint">(hidden)</span>}
                </label>
              ))}
              <button type="button" className="btn small secondary"
                onClick={() => setSelected((s) => [...new Set([...s, ...list.map((c) => c.id)])])}>
                All {sp.label.toLowerCase()}
              </button>
            </div>
          );
        })}
      </div>
      <div className="row field">
        <div>
          <label htmlFor="s">From</label>
          <select id="s" value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {hourOptions.slice(0, -1).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="e">Until</label>
          <select id="e" value={end} onChange={(e) => setEnd(Number(e.target.value))}>
            {hourOptions.slice(1).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
          </select>
        </div>
      </div>
      <div className="row field">
        <div>
          <label htmlFor="n">Name / label</label>
          <input id="n" type="text" required minLength={2} maxLength={60} placeholder="e.g. Open Tournament"
            value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="c">Contact <span className="hint">(optional)</span></label>
          <input id="c" type="text" maxLength={60} value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label style={{ fontWeight: 400, display: "inline-flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={noCharge} onChange={(e) => setNoCharge(e.target.checked)} />
          No charge (tournament, maintenance, staff use)
        </label>
      </div>
      {!noCharge && (
        <div className="row field" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label htmlFor="rt">Rate</label>
            <select id="rt" value={rateType} onChange={(e) => setRateType(e.target.value as RateType)}>
              {RATE_TYPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pm">Payment method</label>
            <select id="pm" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ps">Payment status</label>
            <select id="ps" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}>
              {PAYMENT_STATUSES.filter((s) => s.id === "unpaid" || s.id === "paid").map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="no">Notes <span className="hint">(optional)</span></label>
        <input id="no" type="text" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      <div className="actions">
        <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
