"use client";

import { useState } from "react";
import { initials } from "@/lib/coach";
import { Fold } from "./BookingSummary";

type Coaching = { coachId: string; coach: string; status: "requested" | "accepted" | "declined" | "cancelled"; note: string } | null;
export type CoachOption = { id: string; name: string; photo: string | null; rates: string; credentials: string; bio: string };

/** One coach to choose: photo (or initials), name and rates — and their credentials and bio once chosen. */
export function CoachChoice({ coach: c, checked, onPick }: { coach: CoachOption; checked: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="coach-option" onClick={onPick}>
      {c.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.photo} alt="" />
      ) : (
        <i className="coach-initials" aria-hidden>{initials(c.name)}</i>
      )}
      <span>
        <strong>{c.name}</strong>
        <small className={checked ? "coach-more" : "coach-rates"}>{c.rates}</small>
        {checked && c.credentials && <small className="coach-more"><b>Credentials &amp; achievements</b>{"\n"}{c.credentials}</small>}
        {checked && c.bio && <small className="coach-more"><b>About</b>{"\n"}{c.bio}</small>}
      </span>
    </button>
  );
}

const STATUS: Record<string, { hint: string; text: (c: string) => string }> = {
  requested: { hint: "Waiting", text: (c) => `You asked ${c} for a coaching session — they'll accept or decline, and we'll let you know.` },
  accepted: { hint: "Confirmed", text: (c) => `${c} will coach you. Please pay your coaching fee to ${c} directly.` },
  declined: { hint: "Declined", text: (c) => `${c} can't make it. You can ask another coach below.` },
  cancelled: { hint: "Cancelled", text: () => "The coaching session was cancelled." },
};

/** My booking: the coaching session asked for (and its answer), or asking a coach now. */
export default function BookingCoaching({ code, coaching, onChanged }: { code: string; coaching: Coaching; onChanged: () => void }) {
  const [coaches, setCoaches] = useState<CoachOption[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canAsk = !coaching || coaching.status === "declined" || coaching.status === "cancelled";

  async function call(body: Record<string, unknown>) {
    const res = await fetch("/api/bookings/coaching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, ...body }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Something went wrong.");
    return j;
  }
  const s = coaching ? STATUS[coaching.status] : null;
  return (
    <Fold icon="🎓" title={coaching ? `Coaching with ${coaching.coach}` : "Add a coaching session"} hint={s?.hint}
      hintTone={coaching?.status === "accepted" ? "on" : undefined} defaultOpen={coaching?.status === "declined"}
      onToggle={async (open) => {
        if (!open || !canAsk || coaches) return;
        try { setCoaches((await call({ action: "options" })).coaches); } catch (e) { setError(e instanceof Error ? e.message : ""); setCoaches([]); }
      }}>
      {coaching && s && (
        <p style={{ margin: "0 0 8px" }}>
          {s.text(coaching.coach)}
          {coaching.note && <><br /><span className="muted">{coaching.coach} says: “{coaching.note}”</span></>}
        </p>
      )}
      {canAsk && (
        coaches === null ? <p className="hint" style={{ margin: 0 }}>Finding coaches who are free at your time…</p>
        : coaches.length === 0 ? <p className="hint" style={{ margin: 0 }}>No coaches are available at your booking&apos;s time.</p>
        : (
          <div className="coach-options" role="radiogroup" aria-label="Choose a coach">
            {coaches.map((c) => (
              <CoachChoice key={c.id} coach={c} checked={pick === c.id} onPick={() => setPick(c.id)} />
            ))}
            <button type="button" className="btn small" disabled={!pick || busy} onClick={async () => {
              setBusy(true);
              setError("");
              try { await call({ action: "request", coachId: pick }); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : ""); } finally { setBusy(false); }
            }}>Ask this coach</button>
          </div>
        )
      )}
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
    </Fold>
  );
}
