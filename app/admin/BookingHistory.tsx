"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./shared";

export type HistoryEntry = {
  id: number;
  booking_code: string;
  at: string;
  actor: string;
  actor_kind: "staff" | "customer" | "system";
  action: string;
  details: string;
  player_name?: string | null;
  deleted?: boolean;
};

/** "Oct 1, 2:05 PM" in Manila time. */
export const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const ACTOR_ICON = { staff: "👤", customer: "🙋", system: "⚙" } as const;

/** One booking's history (who did what, when), loaded when opened. On the booking card. */
export default function BookingHistory({ bookingId, version, onAuthError }: { bookingId: string; version: string; onAuthError: (e: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setEntries((await api<{ entries: HistoryEntry[] }>(`/api/admin/history?booking=${bookingId}`)).entries);
      setError("");
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't load the history.");
    }
  }, [bookingId, onAuthError]);
  // Reload when opened, and after a change to the booking while open.
  useEffect(() => {
    if (open) load();
  }, [open, load, version]);

  return (
    <details className="bk-history" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>History</summary>
      {error && <div className="error">{error}</div>}
      {!entries && !error && <p className="hint">Loading…</p>}
      {entries && entries.length === 0 && <p className="hint">No history recorded for this booking.</p>}
      {entries && entries.length > 0 && (
        <ol className="history-list">
          {[...entries].reverse().map((h) => (
            <li key={h.id}>
              <span className="history-when">{whenLabel(h.at)}</span>
              <span>
                <strong>{h.action}</strong> · <span className={`history-actor ${h.actor_kind}`}>{ACTOR_ICON[h.actor_kind]} {h.actor}</span>
                {h.details && <span className="history-details">{h.details}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
