"use client";

import { useCallback, useEffect, useState } from "react";
import { REMINDER_MINUTES } from "@/lib/customer-messages";
import { currentSubscription, isIos, isStandalone, pushSupported, subscribeDevice } from "@/lib/push-client";

type Status = { email: string; pushOn: boolean; push: { publicKey: string } | null; emailReady: boolean };
type Push = "checking" | "on" | "off" | "denied" | "needs-install" | "insecure" | "unsupported";

async function post(body: Record<string, unknown>): Promise<Status> {
  const res = await fetch("/api/bookings/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong. Please try again.");
  return json as Status;
}

/**
 * "Get updates about this booking": push notifications on this device and/or email, for payment
 * confirmed / not accepted, and a reminder before the start. On the booking confirmation and on
 * My booking.
 */
export default function BookingAlerts({ code }: { code: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [push, setPush] = useState<Push>("checking");
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const sub = await currentSubscription().catch(() => null);
      const s = await post({ code, action: "status", endpoint: sub?.endpoint });
      setStatus(s);
      setEmail(s.email);
      // Browsers only allow push on https:// (or localhost) — e.g. not http://192.168.x.x on a phone.
      if (!window.isSecureContext) setPush("insecure");
      else if (!pushSupported()) setPush(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      else if (Notification.permission === "denied") setPush("denied");
      else setPush(s.pushOn ? "on" : "off");
    } catch {
      /* the booking page still works without this */
    }
  }, [code]);
  useEffect(() => {
    load();
  }, [load]);

  if (!status || (!status.push && !status.emailReady)) return null;

  async function run(job: () => Promise<Status>, done: string) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const s = await job();
      setStatus(s);
      setNote(done);
      return s;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOn() {
    if (!status?.push) return;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setPush(permission === "denied" ? "denied" : "off");
    const s = await run(async () => {
      const sub = await subscribeDevice(status.push!.publicKey);
      return post({ code, action: "push-on", subscription: sub.toJSON() });
    }, "Notifications are on for this device.");
    if (s?.pushOn) setPush("on");
  }

  async function turnOff() {
    // Only this booking stops notifying: the device may also get other bookings' (or staff) updates.
    const sub = await currentSubscription().catch(() => null);
    const s = await run(() => post({ code, action: "push-off", endpoint: sub?.endpoint }), "Notifications are off for this booking.");
    if (s) setPush("off");
  }

  async function saveEmail(value: string) {
    const s = await run(() => post({ code, action: "email", email: value }), value ? "We'll email you updates." : "Email updates are off.");
    if (s) {
      setEmail(s.email);
      setEditing(false);
    }
  }

  const hours = REMINDER_MINUTES % 60 === 0 ? `${REMINDER_MINUTES / 60} hour${REMINDER_MINUTES === 60 ? "" : "s"}` : `${REMINDER_MINUTES} minutes`;

  return (
    <div className="alerts-box">
      <strong>🔔 Get updates about this booking</strong>
      <p className="muted" style={{ margin: "4px 0 0", fontSize: 14 }}>
        We&apos;ll let you know when your payment is confirmed (or if there&apos;s a problem with it), and remind you {hours} before
        your time.
      </p>

      {status.push && (
        <div className="alerts-row">
          {push === "on" ? (
            <>
              <span className="alerts-on">✓ Notifications on for this device</span>
              <button type="button" className="link-btn" disabled={busy} onClick={turnOff}>Turn off</button>
            </>
          ) : push === "off" ? (
            <button type="button" className="btn small" disabled={busy} onClick={turnOn}>Turn on notifications</button>
          ) : push === "denied" ? (
            <span className="hint">Notifications are blocked for this site — allow them in your browser settings, or use email.</span>
          ) : push === "needs-install" ? (
            <span className="hint">
              On iPhone/iPad: tap <strong>Share → Add to Home Screen</strong>, open NVBC from your Home Screen, then find your booking
              under My booking to turn on notifications. Or use email below.
            </span>
          ) : push === "insecure" ? (
            <span className="hint">
              Notifications only work when the site is opened over a secure <strong>https://</strong> address{status.emailReady ? " — use email for now." : "."}
            </span>
          ) : push === "unsupported" ? (
            <span className="hint">This browser can&apos;t show notifications{status.emailReady ? " — use email instead." : "."}</span>
          ) : null}
        </div>
      )}

      {status.emailReady && (
        <div className="alerts-row">
          {status.email && !editing ? (
            <>
              <span className="alerts-on">✓ Emails go to {status.email}</span>
              <button type="button" className="link-btn" disabled={busy} onClick={() => setEditing(true)}>Change</button>
              <button type="button" className="link-btn" disabled={busy} onClick={() => saveEmail("")}>Stop</button>
            </>
          ) : (
            <form className="alerts-email" onSubmit={(e) => { e.preventDefault(); saveEmail(email.trim()); }}>
              <input type="email" aria-label="Email for booking updates" placeholder="Email me updates (optional)" maxLength={120}
                autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <button className="btn small secondary" disabled={busy}>Save</button>
            </form>
          )}
        </div>
      )}
      {note && !error && <p className="hint" style={{ margin: "6px 0 0" }}>{note}</p>}
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
