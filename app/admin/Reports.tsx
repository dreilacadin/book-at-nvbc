"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import { formatHour } from "@/lib/format";
import { formatPeso, paymentLabel } from "@/lib/pricing";
import { sportEmoji, sportLabel } from "@/lib/sports";
import { api, todayManila } from "./shared";

type Report = {
  from: string;
  to: string;
  openHour: number;
  closeHour: number;
  courts: number;
  dayCounts: number[]; // index 1 (Mon) … 7 (Sun): how many of that weekday the range has
  totals: {
    bookings: number; kept: number; court_hours: number; revenue: number; refunded: number; refunds_due: number; unpaid: number;
    cancelled_customer: number; cancelled_staff: number; released: number; no_shows: number; started: number;
  };
  heat: { dow: number; hour: number; n: number }[]; // booked half-hours
  bySport: { sport: string; revenue: number; court_hours: number; bookings: number }[];
  byMethod: { method: string; revenue: number; count: number }[];
};

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const addDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
// Small shares keep a decimal (0.2%, not 0%); larger ones are whole numbers.
const pct = (v: number) => (v > 0 && v < 0.1 ? `${(Math.round(v * 1000) / 10).toFixed(1)}%` : `${Math.round(v * 100)}%`);
const rate = (n: number, of: number) => (of > 0 ? n / of : 0);
const niceDate = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const PRESETS: { id: string; label: string; range: (today: string) => [string, string] }[] = [
  { id: "7", label: "Last 7 days", range: (t) => [addDays(t, -6), t] },
  { id: "30", label: "Last 30 days", range: (t) => [addDays(t, -29), t] },
  { id: "month", label: "This month", range: (t) => [t.slice(0, 8) + "01", t] },
  { id: "90", label: "Last 90 days", range: (t) => [addDays(t, -89), t] },
];

/** Owner/managers: usage, busiest times, revenue and cancellation / no-show rates — for pricing and staffing. */
export default function Reports({ onAuthError }: { onAuthError: (e: unknown) => void }) {
  const today = todayManila();
  const [preset, setPreset] = useState("30");
  const [range, setRange] = useState<[string, string]>(() => PRESETS[1].range(today));
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Report>(`/api/admin/reports?from=${range[0]}&to=${range[1]}`));
      setError("");
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't load the report.");
    } finally {
      setLoading(false);
    }
  }, [range, onAuthError]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="reports stack">
      <div className="report-filters">
        <div className="segmented report-presets" role="radiogroup" aria-label="Period">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={preset === p.id}
              onClick={() => { setPreset(p.id); setRange(p.range(today)); }}>{p.label}</button>
          ))}
        </div>
        <label className="report-range">
          <input type="date" aria-label="From" value={range[0]} max={range[1]}
            onChange={(e) => { setPreset(""); setRange([e.target.value, range[1]]); }} />
          <span>to</span>
          <input type="date" aria-label="To" value={range[1]} min={range[0]}
            onChange={(e) => { setPreset(""); setRange([range[0], e.target.value]); }} />
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      {loading && !data && <FullScreenLoader label="Loading report…" />}
      {data && <ReportBody r={data} />}
    </div>
  );
}

function ReportBody({ r }: { r: Report }) {
  const t = r.totals;
  // Usage: booked court-hours out of the hours the courts were open, per weekday and hour.
  const hours = useMemo(() => {
    const list: number[] = [];
    for (let h = Math.floor(r.openHour); h < r.closeHour; h++) list.push(h);
    return list;
  }, [r.openHour, r.closeHour]);
  const cell = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of r.heat) {
      const key = `${x.dow}:${Math.floor(x.hour)}`;
      m.set(key, (m.get(key) ?? 0) + x.n);
    }
    return (dow: number, h: number) => {
      const cap = r.courts * r.dayCounts[dow] * 2; // half-hours available
      return cap > 0 ? (m.get(`${dow}:${h}`) ?? 0) / cap : 0;
    };
  }, [r]);
  const openHours = r.closeHour - r.openHour;
  const totalCap = r.courts * openHours * r.dayCounts.reduce((a, b) => a + b, 0);
  const usage = rate(t.court_hours, totalCap);
  const byDay = [1, 2, 3, 4, 5, 6, 7].map((dow) => {
    const cap = r.courts * openHours * r.dayCounts[dow] * 2;
    const booked = r.heat.filter((x) => x.dow === dow).reduce((a, x) => a + x.n, 0);
    return { dow, value: cap > 0 ? booked / cap : 0, has: r.dayCounts[dow] > 0 };
  });
  const busiest = [1, 2, 3, 4, 5, 6, 7]
    .flatMap((dow) => hours.map((h) => ({ dow, h, v: cell(dow, h) })))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 5);
  const quietest = [1, 2, 3, 4, 5, 6, 7]
    .filter((dow) => r.dayCounts[dow] > 0)
    .flatMap((dow) => hours.map((h) => ({ dow, h, v: cell(dow, h) })))
    .sort((a, b) => a.v - b.v)
    .slice(0, 3);

  return (
    <>
      <p className="hint" style={{ margin: 0 }}>
        {niceDate(r.from)} – {niceDate(r.to)} · {r.courts} active courts, open {formatHour(r.openHour)} – {formatHour(r.closeHour)}.
        Revenue counts payments marked Paid (refunds excluded).
      </p>
      <div className="stats">
        <Stat n={formatPeso(t.revenue)} l="revenue collected" />
        <Stat n={pct(usage)} l={`courts in use · ${Math.round(t.court_hours)} court-hours`} />
        <Stat n={String(t.kept)} l={`bookings kept · of ${t.bookings} made`} />
        <Stat n={formatPeso(t.refunded)} l={`refunded${t.refunds_due ? ` · ${formatPeso(t.refunds_due)} still due` : ""}`} />
        <Stat n={formatPeso(t.unpaid)} l="still unpaid or to verify" />
      </div>
      <div className="stats">
        <Stat n={pct(rate(t.cancelled_customer, t.bookings))} l={`cancelled by customers · ${t.cancelled_customer}`} />
        <Stat n={pct(rate(t.cancelled_staff, t.bookings))} l={`cancelled by staff · ${t.cancelled_staff}`} />
        <Stat n={pct(rate(t.released, t.bookings))} l={`released, not paid in time · ${t.released}`} />
        <Stat n={pct(rate(t.no_shows, t.started))} l={`no-shows · ${t.no_shows} of ${t.started} started`} />
      </div>

      <section className="card report-card">
        <h2>When courts are busy</h2>
        <p className="hint">Share of courts booked, by weekday and hour — the strongest green is the busiest time in this period. Hover a cell for details.</p>
        <Heatmap hours={hours} cell={cell} dayCounts={r.dayCounts} />
        <div className="report-two">
          <div>
            <h3>Busiest times</h3>
            {busiest.length === 0 ? <p className="hint">No bookings in this period.</p> : (
              <ol className="report-list">
                {busiest.map((x) => (
                  <li key={`${x.dow}-${x.h}`}><strong>{DAYS[x.dow]} {formatHour(x.h)}</strong> <span className="muted">· {pct(x.v)} of courts booked</span></li>
                ))}
              </ol>
            )}
          </div>
          <div>
            <h3>Quietest times</h3>
            <ol className="report-list">
              {quietest.map((x) => (
                <li key={`${x.dow}-${x.h}`}><strong>{DAYS[x.dow]} {formatHour(x.h)}</strong> <span className="muted">· {pct(x.v)} booked</span></li>
              ))}
            </ol>
            <p className="hint" style={{ margin: 0 }}>Good candidates for promos or lower off-peak prices.</p>
          </div>
        </div>
        <h3>By day of the week</h3>
        <Bars rows={byDay.filter((d) => d.has).map((d) => ({ key: String(d.dow), label: DAYS[d.dow], value: d.value, text: `${pct(d.value)} booked` }))} />
      </section>

      <div className="report-two">
        <section className="card report-card">
          <h2>Revenue by sport</h2>
          {r.bySport.length === 0 ? <p className="hint">No bookings in this period.</p> : (
            <Bars rows={r.bySport.map((s) => ({
              key: s.sport,
              label: `${sportEmoji(s.sport)} ${sportLabel(s.sport)}`,
              value: s.revenue,
              text: formatPeso(s.revenue),
              sub: `${Math.round(s.court_hours * 10) / 10} court-hours · ${s.bookings} bookings`,
            }))} />
          )}
        </section>
        <section className="card report-card">
          <h2>Revenue by payment method</h2>
          {r.byMethod.length === 0 ? <p className="hint">No paid bookings in this period.</p> : (
            <Bars rows={r.byMethod.map((m) => ({
              key: m.method,
              label: paymentLabel(m.method),
              value: m.revenue,
              text: formatPeso(m.revenue),
              sub: `${m.count} payment${m.count === 1 ? "" : "s"}`,
            }))} />
          )}
        </section>
      </div>
    </>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return <div className="stat"><div className="n">{n}</div><div className="l">{l}</div></div>;
}

/** Horizontal bars (one series): thin marks from a shared baseline, value labels in text colour. */
function Bars({ rows, max }: { rows: { key: string; label: string; value: number; text: string; sub?: string }[]; max?: number }) {
  const top = max ?? Math.max(...rows.map((r) => r.value), 0);
  return (
    <div className="bars" role="table">
      {rows.map((r) => (
        <div key={r.key} className="bar-row" role="row" title={`${r.label}: ${r.text}${r.sub ? ` (${r.sub})` : ""}`}>
          <span className="bar-label" role="rowheader">{r.label}</span>
          <span className="bar-track" role="cell" aria-label={r.text}>
            <span className="bar-fill" style={{ width: `${top > 0 ? Math.max((r.value / top) * 100, r.value > 0 ? 1.5 : 0) : 0}%` }} />
          </span>
          <span className="bar-value" role="cell">
            {r.text}
            {r.sub && <small>{r.sub}</small>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Weekday × hour heatmap: one green, from the surface (no bookings) to full (all courts booked). */
function Heatmap({ hours, cell, dayCounts }: { hours: number[]; cell: (dow: number, h: number) => number; dayCounts: number[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const days = [1, 2, 3, 4, 5, 6, 7];
  // Shades run from empty to the busiest cell, so quiet periods still show their pattern.
  const peak = Math.max(...days.flatMap((d) => hours.map((h) => cell(d, h))), 0);
  return (
    <div className="heat-wrap">
      <div className="heat" style={{ gridTemplateColumns: `44px repeat(${hours.length}, minmax(22px, 1fr))` }} onMouseLeave={() => setTip(null)}>
        <span />
        {hours.map((h) => (
          <span key={h} className="heat-hour">{h % 12 === 0 ? 12 : h % 12}{h < 12 ? "a" : "p"}</span>
        ))}
        {days.map((dow) => (
          <div key={dow} style={{ display: "contents" }}>
            <span className="heat-day">{DAYS[dow]}</span>
            {hours.map((h) => {
              const v = cell(dow, h);
              const text = dayCounts[dow] === 0 ? `${DAYS[dow]} ${formatHour(h)}: not in this period` : `${DAYS[dow]} ${formatHour(h)}: ${pct(v)} of courts booked`;
              return (
                <span key={h} className="heat-cell" aria-label={text}
                  style={{ background: v > 0 && peak > 0 ? `color-mix(in oklab, var(--chart) ${Math.round(12 + (v / peak) * 88)}%, var(--surface))` : undefined }}
                  onMouseEnter={(e) => {
                    const box = (e.currentTarget.closest(".heat-wrap") as HTMLElement).getBoundingClientRect();
                    const c = e.currentTarget.getBoundingClientRect();
                    setTip({ x: c.left - box.left + c.width / 2, y: c.top - box.top, text });
                  }} />
              );
            })}
          </div>
        ))}
      </div>
      {tip && <div className="heat-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
      <div className="heat-legend" aria-hidden="true">
        <span>None</span><span className="heat-scale" /><span>Busiest · {pct(peak)} of courts booked</span>
      </div>
      <details className="heat-table">
        <summary>Show as table</summary>
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Day</th>{hours.map((h) => <th key={h}>{formatHour(h)}</th>)}</tr></thead>
            <tbody>
              {days.map((dow) => (
                <tr key={dow}><th>{DAYS[dow]}</th>{hours.map((h) => <td key={h}>{pct(cell(dow, h))}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
