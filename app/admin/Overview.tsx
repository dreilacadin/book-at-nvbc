"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateLong, formatHour } from "@/lib/format";
import { bookingStatusLabel, formatPeso } from "@/lib/pricing";
import { SPORTS, sportEmoji, type Sport } from "@/lib/sports";
import { api, todayManila, type AdminBooking, type Court, type Settings } from "./shared";

type View = "day" | "week" | "month";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 0 = Monday … 6 = Sunday */
const weekday = (date: string) => (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
const monthStart = (date: string) => date.slice(0, 8) + "01";
function monthEnd(date: string) {
  const d = new Date(monthStart(date) + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}
function shiftMonth(date: string, n: number) {
  const d = new Date(monthStart(date) + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
const fmt = (date: string, o: Intl.DateTimeFormatOptions) =>
  new Date(date + "T00:00:00Z").toLocaleDateString("en-PH", { ...o, timeZone: "UTC" });

function rangeFor(view: View, anchor: string): { from: string; to: string; label: string } {
  if (view === "day") return { from: anchor, to: anchor, label: formatDateLong(anchor) };
  if (view === "week") {
    const from = addDays(anchor, -weekday(anchor));
    const to = addDays(from, 6);
    return { from, to, label: `${fmt(from, { month: "short", day: "numeric" })} – ${fmt(to, { month: "short", day: "numeric", year: "numeric" })}` };
  }
  return { from: monthStart(anchor), to: monthEnd(anchor), label: fmt(anchor, { month: "long", year: "numeric" }) };
}

const hoursOf = (b: AdminBooking) => b.end_hour - b.start_hour;

/** Totals for a set of bookings. Cancelled bookings only count toward `cancelled`. */
function summarize(list: AdminBooking[]) {
  const active = list.filter((b) => b.status !== "cancelled");
  return {
    bookings: active.length,
    hours: active.reduce((s, b) => s + hoursOf(b), 0),
    billed: active.filter((b) => b.payment_status !== "waived").reduce((s, b) => s + b.amount, 0),
    collected: list.filter((b) => b.payment_status === "paid").reduce((s, b) => s + b.amount, 0),
    unpaid: active.filter((b) => b.payment_status === "unpaid").reduce((s, b) => s + b.amount, 0),
    toVerify: active.filter((b) => b.payment_status === "for_verification").length,
    pending: active.filter((b) => b.status === "pending").length,
    cancelled: list.length - active.length,
  };
}

/** Staff home: bookings at a glance for a day, a week or a month. */
export default function Overview({
  onOpenDay,
  onAuthError,
}: {
  onOpenDay: (date: string) => void; // open the Bookings tab on that date
  onAuthError: (e: unknown) => void;
}) {
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(todayManila());
  const [sport, setSport] = useState<Sport | "all">("all");
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [hours, setHours] = useState({ open: 6, close: 22 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const today = todayManila();
  const range = rangeFor(view, anchor);

  useEffect(() => {
    Promise.all([api<{ courts: Court[] }>("/api/admin/courts"), api<Settings>("/api/admin/settings")])
      .then(([c, s]) => {
        setCourts(c.courts);
        setHours({ open: s.open_hour, close: s.close_hour });
      })
      .catch(onAuthError);
  }, [onAuthError]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ bookings: AdminBooking[] }>(`/api/admin/bookings?from=${range.from}&to=${range.to}`);
      setBookings(r.bookings);
      setError("");
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => (sport === "all" ? bookings : bookings.filter((b) => b.sport === sport)), [bookings, sport]);
  const byDate = useMemo(() => {
    const m = new Map<string, AdminBooking[]>();
    for (const b of shown) m.set(b.date, [...(m.get(b.date) ?? []), b]);
    return m;
  }, [shown]);
  const t = summarize(shown);

  const step = (n: number) =>
    setAnchor(view === "day" ? addDays(anchor, n) : view === "week" ? addDays(anchor, 7 * n) : shiftMonth(anchor, n));
  const showDay = (date: string) => {
    setAnchor(date);
    setView("day");
  };

  return (
    <div className="stack">
      <div className="overview-bar">
        <div className="segmented view-switch" role="radiogroup" aria-label="Period">
          {(["day", "week", "month"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div className="period-nav">
          <button type="button" className="btn small secondary" aria-label={`Previous ${view}`} onClick={() => step(-1)}>‹</button>
          <strong>{range.label}</strong>
          <button type="button" className="btn small secondary" aria-label={`Next ${view}`} onClick={() => step(1)}>›</button>
          <button type="button" className="btn small secondary" onClick={() => setAnchor(today)}>Today</button>
        </div>
        <select aria-label="Sport" value={sport} onChange={(e) => setSport(e.target.value as Sport | "all")} style={{ width: "auto" }}>
          <option value="all">All sports</option>
          {SPORTS.map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>)}
        </select>
      </div>

      <div className="stats">
        <div className="stat"><div className="n">{t.bookings}</div><div className="l">bookings{t.pending ? ` · ${t.pending} pending` : ""}</div></div>
        <div className="stat"><div className="n">{t.hours}</div><div className="l">court-hours booked</div></div>
        <div className="stat"><div className="n">{formatPeso(t.billed)}</div><div className="l">billed</div></div>
        <div className="stat"><div className="n">{formatPeso(t.collected)}</div><div className="l">collected (paid)</div></div>
        <div className="stat"><div className="n">{formatPeso(t.unpaid)}</div><div className="l">still unpaid</div></div>
        <div className="stat"><div className="n">{t.toVerify}</div><div className="l">payments to verify</div></div>
        <div className="stat"><div className="n">{t.cancelled}</div><div className="l">cancelled</div></div>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && bookings.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : view === "month" ? (
        <MonthGrid from={range.from} to={range.to} today={today} byDate={byDate} onPick={showDay} />
      ) : view === "week" ? (
        <WeekColumns from={range.from} today={today} byDate={byDate} onPick={showDay} />
      ) : (
        <DaySchedule
          date={anchor}
          bookings={byDate.get(anchor) ?? []}
          courts={courts.filter((c) => (sport === "all" || c.sport === sport) && (c.is_active || byDate.get(anchor)?.some((b) => b.court_id === c.id)))}
          open={hours.open}
          close={hours.close}
          onOpen={() => onOpenDay(anchor)}
        />
      )}
    </div>
  );
}

function MonthGrid({
  from,
  to,
  today,
  byDate,
  onPick,
}: {
  from: string;
  to: string;
  today: string;
  byDate: Map<string, AdminBooking[]>;
  onPick: (date: string) => void;
}) {
  const days: (string | null)[] = Array(weekday(from)).fill(null);
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const totals = new Map([...byDate].map(([d, list]) => [d, summarize(list)]));
  const busiest = Math.max(1, ...[...totals.values()].map((s) => s.hours));

  return (
    <div className="month-grid" role="grid" aria-label="Bookings per day">
      {DOW.map((d) => <div key={d} className="month-dow" role="columnheader">{d}</div>)}
      {days.map((d, i) => {
        if (!d) return <div key={`pad-${i}`} aria-hidden="true" />;
        const s = totals.get(d);
        // Shade by court-hours (one hue, light → dark). The numbers are always shown too.
        const level = s ? s.hours / busiest : 0;
        return (
          <button
            key={d}
            type="button"
            role="gridcell"
            className={`month-day${d === today ? " today" : ""}`}
            style={level ? { background: `color-mix(in srgb, var(--brand) ${Math.round(8 + level * 32)}%, var(--surface))` } : undefined}
            onClick={() => onPick(d)}
            title={s ? `${s.bookings} booking(s), ${s.hours} court-hour(s), ${formatPeso(s.billed)} billed` : "No bookings"}
          >
            <span className="month-num">{Number(d.slice(8))}</span>
            {s && s.bookings > 0 ? (
              <>
                <span className="month-stat">{s.bookings} booking{s.bookings === 1 ? "" : "s"}</span>
                <span className="month-sub">{s.hours}h · {formatPeso(s.billed)}</span>
                {s.toVerify > 0 && <span className="month-flag">{s.toVerify} to verify</span>}
              </>
            ) : (
              <span className="month-sub">—</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function WeekColumns({
  from,
  today,
  byDate,
  onPick,
}: {
  from: string;
  today: string;
  byDate: Map<string, AdminBooking[]>;
  onPick: (date: string) => void;
}) {
  return (
    <div className="week-cols">
      {DOW.map((_, i) => {
        const d = addDays(from, i);
        const list = (byDate.get(d) ?? []).filter((b) => b.status !== "cancelled");
        const s = summarize(list);
        return (
          <div key={d} className={`week-day${d === today ? " today" : ""}`}>
            <button type="button" className="week-head" onClick={() => onPick(d)}>
              <strong>{fmt(d, { weekday: "short", month: "short", day: "numeric" })}</strong>
              <span className="muted">{s.bookings ? `${s.bookings} · ${s.hours}h · ${formatPeso(s.billed)}` : "No bookings"}</span>
            </button>
            {list
              .slice()
              .sort((a, b) => a.start_hour - b.start_hour || a.court_name.localeCompare(b.court_name))
              .map((b) => (
                <button type="button" key={b.id} className={`week-item ${b.status}`} onClick={() => onPick(d)}
                  title={`${b.court_name} · ${b.name} · ${bookingStatusLabel(b.status)}`}>
                  <span className="week-time">{formatHour(b.start_hour).replace(":00", "")}–{formatHour(b.end_hour).replace(":00", "")}</span>
                  <span>{sportEmoji(b.sport)} {b.court_name}</span>
                  <span className="week-name">{b.name}</span>
                  {b.status === "pending" && <span className="badge pending">Pending</span>}
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

function DaySchedule({
  date,
  bookings,
  courts,
  open,
  close,
  onOpen,
}: {
  date: string;
  bookings: AdminBooking[];
  courts: Court[];
  open: number;
  close: number;
  onOpen: () => void;
}) {
  const active = bookings.filter((b) => b.status !== "cancelled");
  // Show opening hours, stretched to fit any staff bookings outside them.
  const first = Math.min(open, ...active.map((b) => b.start_hour));
  const last = Math.max(close, ...active.map((b) => b.end_hour));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const at = (courtId: number, h: number) => active.find((b) => b.court_id === courtId && b.start_hour <= h && h < b.end_hour);

  if (courts.length === 0) return <p className="muted">No courts.</p>;
  return (
    <div className="stack">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span className="muted">Click a booking to edit, cancel or verify payment.</span>
        <button type="button" className="btn small" onClick={onOpen}>Open in Bookings →</button>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="day-schedule">
          <thead>
            <tr>
              <th></th>
              {courts.map((c) => <th key={c.id}>{sportEmoji(c.sport)} {c.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h}>
                <th scope="row">{formatHour(h)}</th>
                {courts.map((c) => {
                  const b = at(c.id, h);
                  if (!b) return <td key={c.id} />;
                  if (b.start_hour !== h) return null; // covered by the rowSpan above
                  const span = b.end_hour - h;
                  return (
                    <td key={c.id} rowSpan={span} className="day-cell">
                      <button type="button" className={`day-booking ${b.status}`} onClick={onOpen}
                        title={`${b.name} · ${formatHour(b.start_hour)}–${formatHour(b.end_hour)}`}>
                        <strong>{b.name}</strong>
                        <span>{formatHour(b.start_hour)} – {formatHour(b.end_hour)}</span>
                        <span>
                          {formatPeso(b.amount)} · {b.status === "pending" ? "Pending" : b.payment_status === "paid" ? "Paid" : b.payment_status === "waived" ? "No charge" : "Unpaid"}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: 0 }}>{formatDateLong(date)}</p>
    </div>
  );
}
