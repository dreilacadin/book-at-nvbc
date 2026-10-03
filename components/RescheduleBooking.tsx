"use client";

import { useCallback, useState } from "react";
import { formatDateLong, formatDateShort, formatHour, formatRange } from "@/lib/format";
import { Fold } from "./BookingSummary";

type Option = { courtId: number; courtName: string; start: number };
type Options = {
  rules: { hours: number; max: number; used: number; firstDate: string; lastDate: string };
  blocked: string | null;
  options: Option[];
  note?: string;
};

async function call(body: Record<string, unknown>) {
  const res = await fetch("/api/bookings/reschedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong. Please try again.");
  return json;
}

function datesBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = new Date(a + "T00:00:00Z"); d.toISOString().slice(0, 10) <= b && out.length < 120; d.setUTCDate(d.getUTCDate() + 1))
    out.push(d.toISOString().slice(0, 10));
  return out;
}

/** My booking → Change time: move to another free court or time of the same sport, length and price. */
export default function RescheduleBooking({
  code,
  date: bookedDate,
  startHour,
  endHour,
  onMoved,
}: {
  code: string;
  date: string;
  startHour: number;
  endHour: number;
  onMoved: (message: string) => void;
}) {
  const [info, setInfo] = useState<Options | null>(null);
  const [date, setDate] = useState(bookedDate);
  const [picked, setPicked] = useState<Option | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hours = endHour - startHour;

  const load = useCallback(
    async (d: string) => {
      setError("");
      setPicked(null);
      try {
        setInfo(await call({ code, action: "options", date: d }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load times.");
      }
    },
    [code]
  );

  async function move() {
    if (!picked) return;
    setBusy(true);
    setError("");
    try {
      const r = await call({ code, action: "move", courtId: picked.courtId, date, start: picked.start });
      onMoved(`Your booking is now on ${r.courtName}, ${formatDateLong(r.date)}, ${formatRange(r.startHour, r.endHour)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't move your booking.");
      load(date);
    } finally {
      setBusy(false);
    }
  }

  const left = info ? Math.max(0, info.rules.max - info.rules.used) : null;
  // Group the free times by start time: "7:00 PM — Court 1, Court 2".
  const byStart = new Map<number, Option[]>();
  for (const o of info?.options ?? []) byStart.set(o.start, [...(byStart.get(o.start) ?? []), o]);

  return (
    <Fold icon="🔁" title="Change time" onToggle={(open) => open && !info && load(date)}>
      {!info && !error && <p className="hint" style={{ margin: 0 }}>Loading…</p>}
      {error && <div className="error">{error}</div>}
      {info?.blocked && <p style={{ margin: 0 }}>{info.blocked}</p>}
      {info && !info.blocked && (
        <div className="resched">
          <p className="hint" style={{ margin: 0 }}>
            Move to another free time of the same length and price, up to {info.rules.hours} hour{info.rules.hours === 1 ? "" : "s"} before
            the start. {left === 1 ? "You can do this once more." : `You can do this ${left} more times.`}
          </p>
          <div className="date-strip resched-dates" role="group" aria-label="Choose a date">
            {datesBetween(info.rules.firstDate, info.rules.lastDate).map((d) => {
              const f = formatDateShort(d);
              return (
                <button key={d} type="button" className="date-chip" aria-pressed={d === date} onClick={() => { setDate(d); load(d); }}>
                  <div className="dow">{f.dow}</div>
                  <div className="day">{f.day}</div>
                  <div className="mon">{f.month}</div>
                </button>
              );
            })}
          </div>
          {info.note && <p className="hint" style={{ margin: 0 }}>{info.note}</p>}
          {!info.note && byStart.size === 0 && <p className="hint" style={{ margin: 0 }}>No free times on this day — try another.</p>}
          <div className="resched-times">
            {[...byStart].map(([start, list]) =>
              list.map((o) => (
                <button key={`${o.courtId}-${start}`} type="button" className="chip" aria-pressed={picked === o}
                  onClick={() => setPicked(o)}>
                  {formatHour(start)} · {o.courtName}
                </button>
              ))
            )}
          </div>
          {picked && (
            <div className="resched-confirm">
              <span>
                Move to <strong>{picked.courtName}</strong>, {formatDateLong(date)}, <strong>{formatRange(picked.start, picked.start + hours)}</strong>?
              </span>
              <button type="button" className="btn" disabled={busy} onClick={move}>{busy ? "Moving…" : "Move my booking"}</button>
            </div>
          )}
        </div>
      )}
    </Fold>
  );
}
