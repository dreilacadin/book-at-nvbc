"use client";

import { useCallback, useEffect, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import { whenLabel, type HistoryEntry } from "./BookingHistory";
import { api } from "./shared";

/** Recent staff actions on bookings (who approved, cancelled or changed what), with a filter by staff member. */
export default function ActivityLog({ onOpenBooking, onAuthError }: { onOpenBooking: (code: string) => void; onAuthError: (e: unknown) => void }) {
  const [actor, setActor] = useState("");
  const [data, setData] = useState<{ entries: HistoryEntry[]; actors: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api(`/api/admin/history?limit=150${actor ? `&actor=${encodeURIComponent(actor)}` : ""}`));
      setError("");
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't load the activity log.");
    } finally {
      setLoading(false);
    }
  }, [actor, onAuthError]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="card activity-log">
      <div className="activity-head">
        <h2 style={{ margin: 0 }}>Activity log</h2>
        <select aria-label="Staff member" value={actor} onChange={(e) => setActor(e.target.value)} style={{ width: "auto" }}>
          <option value="">All staff</option>
          {data?.actors.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button type="button" className="btn small secondary" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>
      <p className="hint" style={{ margin: "4px 0 10px" }}>
        What staff did to bookings: payments confirmed or rejected, cancellations, edits, restores and deletions — newest first.
        Each booking&apos;s full history (including the customer&apos;s own actions) is under History on its card.
      </p>
      {loading && !data && <FullScreenLoader label="Loading activity…" />}
      {error && <div className="error">{error}</div>}
      {data && data.entries.length === 0 && <p className="muted">Nothing recorded yet.</p>}
      {data && data.entries.length > 0 && (
        <ol className="history-list">
          {data.entries.map((h) => (
            <li key={h.id}>
              <span className="history-when">{whenLabel(h.at)}</span>
              <span>
                <strong>{h.actor}</strong> · {h.action} ·{" "}
                {h.deleted ? (
                  <span className="mono muted">{h.booking_code}</span>
                ) : (
                  <button type="button" className="link-btn mono" onClick={() => onOpenBooking(h.booking_code)}>{h.booking_code}</button>
                )}
                {h.player_name ? <span className="muted"> · {h.player_name}</span> : null}
                {h.details && <span className="history-details">{h.details}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
