"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateLong, formatHour, halfHours, SLOT_HOURS } from "@/lib/format";
import { bookingStatusLabel, formatPeso, paymentLabel } from "@/lib/pricing";
import { awaitingPayment } from "@/lib/booking-policy";
import { SPORTS, sportEmoji, type Sport } from "@/lib/sports";
import { blockedSlots, type CourtBlock } from "@/lib/blocks";
import { api, todayManila, type AdminBooking, type Court, type Settings } from "./shared";
import FullScreenLoader from "@/components/FullScreenLoader";

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

type TileFilter = "verify" | "cancelled" | "refunds";
const TILE_FILTERS: Record<TileFilter, (b: AdminBooking) => boolean> = {
  verify: (b) => b.status !== "cancelled" && b.payment_status === "for_verification",
  cancelled: (b) => b.status === "cancelled",
  refunds: (b) => b.refund_status === "due",
};

/** A stat tile that filters the bookings below — styled so it's clearly a button. */
function FilterTile({ n, label, active, warn, onClick }: { n: number; label: string; active: boolean; warn?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`stat stat-link${active ? " active" : ""}${warn ? " warn" : ""}`} aria-pressed={active} onClick={onClick}
      title={active ? "Show the calendar again" : `Show the ${label} for this period`}>
      <div className="n">{n}</div>
      <div className="l">{label}</div>
      <span className="stat-cta">{active ? "✕ Showing" : "View →"}</span>
    </button>
  );
}

/** Bookings picked by a tile, for the period on screen. Click one to open it in the Bookings tab. */
function FilteredList({
  title,
  period,
  list,
  empty,
  onOpen,
  onClose,
}: {
  title: string;
  period: string;
  list: AdminBooking[];
  empty: string;
  onOpen: (b: AdminBooking) => void;
  onClose: () => void;
}) {
  const dayLabel = (d: string) =>
    new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div className="filtered">
      <div className="filtered-head">
        <strong>{title} · {period} <span className="muted">({list.length})</span></strong>
        <button type="button" className="btn small secondary" onClick={onClose}>✕ Show calendar</button>
      </div>
      {list.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{empty} in this period.</p>
      ) : (
        <div className="bk-list">
          {list.map((b) => {
            const status = b.status === "cancelled" ? (b.cancelled_by === "system" ? "released" : "cancelled") : b.status;
            return (
              <button key={b.id} type="button" className={`bk-row status-${status} filtered-row`} onClick={() => onOpen(b)}>
                <span className="bk-time">
                  {dayLabel(b.date)}
                  <small>{formatHour(b.start_hour)} – {formatHour(b.end_hour)}</small>
                </span>
                <span className="bk-main">
                  <strong className="bk-name">{b.name}</strong>
                  <span className="bk-sub">
                    {sportEmoji(b.sport)} {b.court_name} · {formatPeso(b.amount)} · {paymentLabel(b.payment_method)}
                    {b.payment_ref ? ` · ref ${b.payment_ref}` : ""}{b.has_proof ? " · 📷 screenshot" : ""}
                    {b.status === "cancelled" && b.cancelled_by && b.cancelled_by !== "system" ? ` · by ${b.cancelled_by}` : ""}
                  </span>
                </span>
                <span className={`pill status-${status}`}>
                  {status === "released" ? "Released" : bookingStatusLabel(status)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Totals for a set of bookings. Cancelled bookings only count toward `cancelled`. */
function summarize(list: AdminBooking[]) {
  const active = list.filter((b) => b.status !== "cancelled");
  return {
    bookings: active.length,
    hours: active.reduce((s, b) => s + hoursOf(b), 0),
    billed: active.filter((b) => b.payment_status !== "waived").reduce((s, b) => s + b.amount, 0),
    collected: list.filter((b) => b.payment_status === "paid").reduce((s, b) => s + b.amount, 0),
    unpaid: active.filter((b) => awaitingPayment(b.payment_status)).reduce((s, b) => s + b.amount, 0),
    toVerify: active.filter((b) => b.payment_status === "for_verification").length,
    pending: active.filter((b) => b.status === "pending" || b.status === "reserved").length,
    cancelled: list.length - active.length,
    refundsDue: list.filter((b) => b.refund_status === "due").length,
  };
}

/** Staff home: bookings at a glance for a day, a week or a month. */
export default function Overview({
  onOpenDay,
  onAuthError,
}: {
  onOpenDay: (date: string, bookingId?: string) => void; // open the Bookings tab on that date (and that booking)
  onAuthError: (e: unknown) => void;
}) {
  const [view, setView] = useState<View>("week");
  // A clicked "payments to verify" / "cancelled" tile: list just those bookings for the period.
  const [tileFilter, setTileFilter] = useState<TileFilter | null>(null);
  const [anchor, setAnchor] = useState(todayManila());
  const [sport, setSport] = useState<Sport | "all">("all");
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [hours, setHours] = useState({ open: 6, close: 22 });
  const [blocks, setBlocks] = useState<CourtBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const today = todayManila();
  const range = rangeFor(view, anchor);

  useEffect(() => {
    Promise.all([
      api<{ courts: Court[] }>("/api/admin/courts"),
      api<Settings>("/api/admin/settings"),
      api<{ blocks: CourtBlock[] }>("/api/admin/blocks"),
    ])
      .then(([c, s, b]) => {
        setCourts(c.courts);
        setHours({ open: s.open_hour, close: s.close_hour });
        setBlocks(b.blocks);
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

  const exportUrl = (format: "xlsx" | "csv") =>
    `/api/admin/export?${new URLSearchParams({ from: range.from, to: range.to, format, ...(sport === "all" ? {} : { sport }) })}`;
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
        <div className="export-links" title={`Download this ${view}'s bookings — opens in Excel, Numbers or Google Sheets`}>
          <span className="muted">Export {view}:</span>
          <a className="btn small secondary" href={exportUrl("xlsx")} download>Excel (.xlsx)</a>
          <a className="btn small secondary" href={exportUrl("csv")} download>CSV</a>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="n">{t.bookings}</div><div className="l">bookings{t.pending ? ` · ${t.pending} pending` : ""}</div></div>
        <div className="stat"><div className="n">{formatPeso(t.billed)}</div><div className="l">billed</div></div>
        <div className="stat"><div className="n">{formatPeso(t.collected)}</div><div className="l">collected (paid)</div></div>
        <div className="stat"><div className="n">{formatPeso(t.unpaid)}</div><div className="l">still unpaid</div></div>
        <FilterTile n={t.toVerify} label="payments to verify" warn={t.toVerify > 0}
          active={tileFilter === "verify"} onClick={() => setTileFilter(tileFilter === "verify" ? null : "verify")} />
        <FilterTile n={t.cancelled} label="cancelled & released"
          active={tileFilter === "cancelled"} onClick={() => setTileFilter(tileFilter === "cancelled" ? null : "cancelled")} />
        {(t.refundsDue > 0 || tileFilter === "refunds") && (
          <FilterTile n={t.refundsDue} label="refunds due" warn={t.refundsDue > 0}
            active={tileFilter === "refunds"} onClick={() => setTileFilter(tileFilter === "refunds" ? null : "refunds")} />
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {loading && <FullScreenLoader label="Loading bookings…" />}
      {tileFilter ? (
        <FilteredList
          title={tileFilter === "verify" ? "Payments to verify" : tileFilter === "refunds" ? "Refunds due" : "Cancelled & released"}
          period={range.label}
          list={shown.filter(TILE_FILTERS[tileFilter]).sort((a, b) => a.date.localeCompare(b.date) || a.start_hour - b.start_hour)}
          empty={tileFilter === "verify" ? "No payments waiting to be verified" : tileFilter === "refunds" ? "No refunds due" : "No cancelled or released bookings"}
          onOpen={(b) => onOpenDay(b.date, b.id)}
          onClose={() => setTileFilter(null)}
        />
      ) : loading && bookings.length === 0 ? null : view === "month" ? (
        <MonthGrid from={range.from} to={range.to} today={today} byDate={byDate} onPick={showDay} />
      ) : view === "week" ? (
        <WeekColumns from={range.from} today={today} byDate={byDate} onPick={showDay} onOpenBooking={(b) => onOpenDay(b.date, b.id)} />
      ) : (
        <DaySchedule
          date={anchor}
          bookings={byDate.get(anchor) ?? []}
          courts={courts.filter((c) => (sport === "all" || c.sport === sport) && (c.is_active || byDate.get(anchor)?.some((b) => b.court_id === c.id)))}
          reserved={blockedSlots(blocks, anchor)}
          open={hours.open}
          close={hours.close}
          onOpen={(id) => onOpenDay(anchor, id)}
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
  onOpenBooking,
}: {
  from: string;
  today: string;
  byDate: Map<string, AdminBooking[]>;
  onPick: (date: string) => void; // the day's header: that day's schedule
  onOpenBooking: (b: AdminBooking) => void; // a booking: straight to it in the Bookings tab
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
                <button type="button" key={b.id} className={`week-item ${b.status}`} onClick={() => onOpenBooking(b)}
                  title={`${b.court_name} · ${b.name} · ${bookingStatusLabel(b.status)}`}>
                  <span className="week-time">{formatHour(b.start_hour).replace(":00", "")}–{formatHour(b.end_hour).replace(":00", "")}</span>
                  <span>{sportEmoji(b.sport)} {b.court_name}</span>
                  <span className="week-name">{b.name}</span>
                  {b.status === "pending" && <span className="badge pending">Pending</span>}
                  {b.status === "reserved" && <span className="badge coach-reserved">Reserved</span>}
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
  reserved,
  open,
  close,
  onOpen,
}: {
  date: string;
  bookings: AdminBooking[];
  courts: Court[];
  reserved: Map<string, string>; // "courtId:hour" → label (Open Play, …)
  open: number;
  close: number;
  onOpen: (bookingId?: string) => void;
}) {
  const active = bookings.filter((b) => b.status !== "cancelled");
  // Show opening hours, stretched to fit any staff bookings outside them.
  const first = Math.min(open, ...active.map((b) => b.start_hour));
  const last = Math.max(close, ...active.map((b) => b.end_hour));
  const hours = halfHours(first, last - SLOT_HOURS);
  const at = (courtId: number, h: number) => active.find((b) => b.court_id === courtId && b.start_hour <= h && h < b.end_hour);

  if (courts.length === 0) return <p className="muted">No courts.</p>;
  return (
    <div className="stack">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span className="muted">Click a booking to edit, cancel or verify payment.</span>
        <button type="button" className="btn small" onClick={() => onOpen()}>Open in Bookings →</button>
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
              <tr key={h} className={h % 1 ? "half" : undefined}>
                <th scope="row">{formatHour(h)}</th>
                {courts.map((c) => {
                  const b = at(c.id, h);
                  if (!b) {
                    const label = reserved.get(`${c.id}:${h}`);
                    return label ? <td key={c.id} className="day-reserved">{label}</td> : <td key={c.id} />;
                  }
                  if (b.start_hour !== h) return null; // covered by the rowSpan above
                  const span = (b.end_hour - h) / SLOT_HOURS;
                  return (
                    <td key={c.id} rowSpan={span} className="day-cell">
                      <button type="button" className={`day-booking ${b.status}`} onClick={() => onOpen(b.id)}
                        title={`${b.name} · ${formatHour(b.start_hour)}–${formatHour(b.end_hour)}`}>
                        <strong>{b.name}</strong>
                        <span>{formatHour(b.start_hour)} – {formatHour(b.end_hour)}</span>
                        <span>
                          {formatPeso(b.amount)} · {b.status === "pending" ? "Pending" : b.status === "reserved" ? "Reserved" : b.payment_status === "paid" ? "Paid" : b.payment_status === "waived" ? "No charge" : "Unpaid"}
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
