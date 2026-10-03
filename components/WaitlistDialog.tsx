"use client";

import { useEffect, useState } from "react";
import { formatDateLong, formatRange } from "@/lib/format";
import { isIos, isStandalone, pushSupported, subscribeDevice } from "@/lib/push-client";
import { sportLabel } from "@/lib/sports";

/**
 * A taken slot on the booking grid: "tell me if this opens up". The player is notified (on this
 * device and/or by email) if any court for this sport/activity frees up for the whole time.
 */
export default function WaitlistDialog({
  sport,
  date,
  start,
  end,
  pushKey,
  onClose,
}: {
  sport: string;
  date: string;
  start: number;
  end: number;
  pushKey: string | null;
  onClose: () => void;
}) {
  const canPush = !!pushKey && typeof window !== "undefined" && window.isSecureContext && pushSupported();
  const [usePush, setUsePush] = useState(canPush);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!usePush && !email.trim()) return setError("Turn on notifications or enter your email so we can tell you.");
    setBusy(true);
    try {
      let subscription: PushSubscriptionJSON | undefined;
      if (usePush && pushKey) {
        const permission = await Notification.requestPermission();
        if (permission === "granted") subscription = (await subscribeDevice(pushKey)).toJSON();
        else if (!email.trim()) throw new Error("Notifications are blocked — enter your email instead.");
      }
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport, date, start, end, email: email.trim(), subscription }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't add you to the waitlist.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add you to the waitlist.");
    } finally {
      setBusy(false);
    }
  }

  const when = `${formatDateLong(date)}, ${formatRange(start, end)}`;
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-labelledby="wl-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="wl-title">This time is taken</h2>
        {done ? (
          <>
            <div className="success">
              You&apos;re on the waitlist. If a {sportLabel(sport).toLowerCase()} court opens up for {when}, we&apos;ll tell you right
              away — everyone waiting hears at the same time, so book quickly.
            </div>
            <div className="actions"><button type="button" className="btn" onClick={onClose}>Done</button></div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p style={{ marginTop: 0 }}>
              Want it if it opens up? We&apos;ll tell you if <strong>any {sportLabel(sport).toLowerCase()} court</strong> becomes
              free for <strong>{when}</strong> — bookings that aren&apos;t paid in time are released often.
            </p>
            {canPush ? (
              <label className="check-row" style={{ marginBottom: 10 }}>
                <input type="checkbox" checked={usePush} onChange={(e) => setUsePush(e.target.checked)} />
                <span>Notify me on this device</span>
              </label>
            ) : (
              pushKey && isIos() && !isStandalone() && (
                <p className="hint">On iPhone/iPad, add NVBC to your Home Screen to get notifications — or use email.</p>
              )
            )}
            <div className="field">
              <label htmlFor="wl-email">Email {canPush && <span className="hint">(optional)</span>}</label>
              <input id="wl-email" type="email" maxLength={120} autoComplete="email" placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button type="button" className="btn secondary" onClick={onClose}>Close</button>
              <button className="btn" disabled={busy}>{busy ? "Adding…" : "🔔 Notify me if it opens"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
