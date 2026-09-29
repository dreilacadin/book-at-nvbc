"use client";

import { useCallback, useEffect, useState } from "react";
import { BLOCK_LABELS, describeRepeat, WEEKDAYS, type CourtBlock } from "@/lib/blocks";
import { formatDateLong, formatHour, formatRange, halfHours } from "@/lib/format";
import { SPORTS } from "@/lib/sports";
import { api, todayManila, type Court } from "./shared";

/** Staff: take courts out of public booking at set times — Open Play, Queueing, Reserved, … */
export default function ReservedTimes({ courts, onAuthError }: { courts: Court[]; onAuthError: (e: unknown) => void }) {
  const [blocks, setBlocks] = useState<CourtBlock[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    try {
      setBlocks((await api<{ blocks: CourtBlock[] }>("/api/admin/blocks")).blocks);
      setError("");
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(b: CourtBlock) {
    if (!window.confirm(`Remove "${b.label}" (${summary(b, courts)})? Those times become bookable again.`)) return;
    try {
      await api("/api/admin/blocks", { action: "delete", id: b.id });
      setNotice("");
      load();
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Remove failed");
    }
  }

  const today = todayManila();
  const current = blocks.filter((b) => b.end_date === null || b.end_date >= today);
  const past = blocks.length - current.length;

  return (
    <div className="card stack">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Reserved times</h2>
        <button className="btn small" onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Close" : "+ Reserve courts"}</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Take courts out of online booking for Open Play, Queueing, training and the like — once or every week.
        Players see the slot marked with its name. Staff can still add bookings in those times.
      </p>
      {showAdd && (
        <AddReservedTime
          courts={courts}
          onAdded={(conflicts) => {
            setShowAdd(false);
            setNotice(
              conflicts
                ? `Saved. ${conflicts} existing booking${conflicts === 1 ? " falls" : "s fall"} inside this time — they were kept; move or cancel them in Bookings if needed.`
                : "Saved."
            );
            load();
          }}
          onAuthError={onAuthError}
        />
      )}
      {notice && <div className="notice">{notice}</div>}
      {error && <div className="error">{error}</div>}
      {current.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No reserved times.</p>
      ) : (
        <div className="table-wrap">
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>When</th>
                <th>Time</th>
                <th>Courts</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {current.map((b) => (
                <tr key={b.id}>
                  <td>
                    <span className="badge blocked">{b.label}</span>
                    {b.notes && <div className="muted" style={{ fontSize: 13 }}>{b.notes}</div>}
                  </td>
                  <td style={{ fontSize: 14 }}>{when(b)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatRange(b.start_hour, b.end_hour)}</td>
                  <td style={{ fontSize: 14 }}>{courtNames(b, courts)}</td>
                  <td><button className="btn small secondary danger-text" onClick={() => remove(b)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {past > 0 && <p className="hint" style={{ margin: 0 }}>{past} past reserved time{past === 1 ? "" : "s"} hidden.</p>}
    </div>
  );
}

const shortDate = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function when(b: CourtBlock) {
  if (b.weekdays.length === 0) return formatDateLong(b.start_date);
  const range = b.end_date ? `${shortDate(b.start_date)} – ${shortDate(b.end_date)}` : `from ${shortDate(b.start_date)}`;
  return `${describeRepeat(b.weekdays)}, ${range}`;
}

function courtNames(b: CourtBlock, courts: Court[]) {
  return b.court_ids.map((id) => courts.find((c) => c.id === id)?.name ?? `Court #${id}`).join(", ");
}

function summary(b: CourtBlock, courts: Court[]) {
  return `${when(b)}, ${formatRange(b.start_hour, b.end_hour)}, ${courtNames(b, courts)}`;
}

function AddReservedTime({
  courts,
  onAdded,
  onAuthError,
}: {
  courts: Court[];
  onAdded: (conflicts: number) => void;
  onAuthError: (e: unknown) => void;
}) {
  const [label, setLabel] = useState<string>(BLOCK_LABELS[0]);
  const [custom, setCustom] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [weekly, setWeekly] = useState(true);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [startDate, setStartDate] = useState(todayManila());
  const [endDate, setEndDate] = useState("");
  const [start, setStart] = useState(18);
  const [end, setEnd] = useState(21);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hourOptions = halfHours(0, 24);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length === 0) return setError("Choose at least one court.");
    if (weekly && weekdays.length === 0) return setError("Choose the days it repeats on.");
    if (end <= start) return setError("End time must be after start time.");
    setBusy(true);
    setError("");
    try {
      const r = await api<{ conflicts: number }>("/api/admin/blocks", {
        action: "create",
        label: label === "Other" ? custom : label,
        courtIds: selected,
        weekdays: weekly ? weekdays : [],
        startDate,
        endDate: weekly ? endDate : startDate,
        startHour: start,
        endHour: end,
        notes,
      });
      onAdded(r.conflicts);
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="edit-booking stack" onSubmit={submit} style={{ gap: 12 }}>
      <div className="row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <label htmlFor="rt-label">Reserved for</label>
          <select id="rt-label" value={label} onChange={(e) => setLabel(e.target.value)}>
            {BLOCK_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
            <option value="Other">Other…</option>
          </select>
        </div>
        {label === "Other" && (
          <div>
            <label htmlFor="rt-custom">Name</label>
            <input id="rt-custom" type="text" required minLength={2} maxLength={40} placeholder="e.g. School PE class"
              value={custom} onChange={(e) => setCustom(e.target.value)} />
          </div>
        )}
      </div>

      <div>
        <label>Courts</label>
        {SPORTS.map((sp) => {
          const list = courts.filter((c) => c.sport === sp.id && c.is_active);
          if (list.length === 0) return null;
          return (
            <div key={sp.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
              <span style={{ minWidth: 100, fontSize: 14 }}>{sp.emoji} {sp.label}</span>
              {list.map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={selected.includes(c.id)}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
                  {c.name}
                </label>
              ))}
              <button type="button" className="btn small secondary"
                onClick={() => setSelected((s) => [...new Set([...s, ...list.map((c) => c.id)])])}>
                All
              </button>
            </div>
          );
        })}
      </div>

      <div>
        <label>Repeat</label>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <label className="check"><input type="radio" checked={weekly} onChange={() => setWeekly(true)} /> Every week</label>
          <label className="check"><input type="radio" checked={!weekly} onChange={() => setWeekly(false)} /> One date only</label>
        </div>
        {weekly && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            {WEEKDAYS.map((d) => (
              <label key={d.id} className="check">
                <input type="checkbox" checked={weekdays.includes(d.id)}
                  onChange={(e) => setWeekdays((w) => (e.target.checked ? [...w, d.id] : w.filter((x) => x !== d.id)))} />
                {d.short}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="row" style={{ gridTemplateColumns: weekly ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr" }}>
        <div>
          <label htmlFor="rt-sd">{weekly ? "Starting" : "Date"}</label>
          <input id="rt-sd" type="date" required value={startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} />
        </div>
        {weekly && (
          <div>
            <label htmlFor="rt-ed">Until <span className="hint">(optional)</span></label>
            <input id="rt-ed" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        )}
        <div>
          <label htmlFor="rt-s">From</label>
          <select id="rt-s" value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {hourOptions.slice(0, -1).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="rt-e">Until</label>
          <select id="rt-e" value={end} onChange={(e) => setEnd(Number(e.target.value))}>
            {hourOptions.slice(1).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="rt-notes">Notes <span className="hint">(optional, staff only)</span></label>
        <input id="rt-notes" type="text" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save reserved time"}</button>
      </div>
    </form>
  );
}
