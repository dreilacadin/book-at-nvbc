"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { kindIcon, NOTIFY_KINDS, timeAgo, type AdminEvent, type NotifyKind } from "@/lib/notify-kinds";
import { api } from "./shared";

type Data = {
  events: AdminEvent[];
  unread: number;
  lastSeen: number;
  kinds: NotifyKind[];
  devices: number;
  push: { publicKey: string } | null;
};
type Toast = { key: number; title: string; body: string; event?: AdminEvent };
type PushState = "checking" | "unsupported" | "needs-install" | "denied" | "off" | "on";

const POLL_MS = 20_000;
const SOUND_KEY = "nvbc_notify_sound";

/** A short two-note chime (no sound file needed). Browsers only play it after the page was clicked once. */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const t = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* audio not available */
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** Staff notifications: the bell in the admin header, pop-ups, a chime, and push on this device. */
export default function Notifications({
  onOpenBooking,
  onOpenMembers,
  onAuthError,
}: {
  onOpenBooking: (code: string) => void;
  onOpenMembers: () => void;
  onAuthError: (e: unknown) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sound, setSound] = useState(true);
  const [push, setPush] = useState<PushState>("checking");
  const [pushMsg, setPushMsg] = useState("");
  const newestSeen = useRef<number | null>(null); // newest event already shown (pop-ups only for newer ones)
  const baseTitle = useRef("");
  const panel = useRef<HTMLDivElement>(null);

  const addToasts = useCallback((fresh: AdminEvent[]) => {
    const list: Toast[] =
      fresh.length > 3
        ? [{ key: Date.now(), title: `${fresh.length} new notifications`, body: fresh.slice(0, 3).map((e) => e.title).join(" · ") + " · …" }]
        : fresh.map((e) => ({ key: e.id, title: e.title, body: e.body, event: e }));
    setToasts((t) => [...list, ...t].slice(0, 4));
    for (const t of list) setTimeout(() => setToasts((all) => all.filter((x) => x.key !== t.key)), 8000);
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api<Data>("/api/admin/notifications");
      setData(d);
      const newest = d.events[0]?.id ?? 0;
      if (newestSeen.current === null) newestSeen.current = Math.max(newest, d.lastSeen);
      else if (newest > newestSeen.current) {
        const fresh = d.events.filter((e) => e.id > newestSeen.current!).reverse();
        newestSeen.current = newest;
        addToasts(fresh);
        let soundOn = true;
        try {
          soundOn = localStorage.getItem(SOUND_KEY) !== "off";
        } catch {
          /* storage unavailable */
        }
        if (soundOn) chime();
      }
    } catch (e) {
      onAuthError(e);
    }
  }, [addToasts, onAuthError]);

  useEffect(() => {
    try {
      setSound(localStorage.getItem(SOUND_KEY) !== "off");
    } catch {
      /* storage unavailable */
    }
    baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "");
    load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.title = baseTitle.current;
    };
  }, [load]);

  // Unread count in the browser tab title, e.g. "(3) NVBC — Court Reservations".
  useEffect(() => {
    if (!baseTitle.current) return;
    document.title = data?.unread ? `(${data.unread}) ${baseTitle.current}` : baseTitle.current;
  }, [data?.unread]);

  // Close the panel on an outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => panel.current && !panel.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Is push on for this device?
  const checkPush = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPush(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") return setPush("denied");
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    setPush(sub ? "on" : "off");
  }, []);
  useEffect(() => {
    checkPush();
  }, [checkPush]);

  async function markAllRead() {
    if (!data?.events.length) return;
    const upTo = Math.max(data.events[0].id, data.lastSeen);
    setData({ ...data, unread: 0, lastSeen: upTo });
    try {
      await api("/api/admin/notifications", { action: "seen", upTo });
    } catch (e) {
      onAuthError(e);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    setSettings(false);
    if (next && data?.unread) markAllRead();
  }

  function openEvent(e: AdminEvent) {
    setOpen(false);
    setToasts((t) => t.filter((x) => x.event?.id !== e.id));
    if (e.booking_code) onOpenBooking(e.booking_code);
    else if (e.kind === "member_applied") onOpenMembers();
  }

  async function setKinds(kind: NotifyKind, on: boolean) {
    if (!data) return;
    const kinds = on ? [...new Set([...data.kinds, kind])] : data.kinds.filter((k) => k !== kind);
    setData({ ...data, kinds });
    try {
      await api("/api/admin/notifications", { action: "kinds", kinds });
      load();
    } catch (e) {
      onAuthError(e);
    }
  }

  function setSoundOn(on: boolean) {
    setSound(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {
      /* storage unavailable */
    }
    if (on) chime(); // preview
  }

  async function turnOnPush() {
    setPushMsg("");
    try {
      if (!data?.push) return setPushMsg("Push notifications aren't set up on the server yet.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPush(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(data.push.publicKey) as BufferSource }));
      await api("/api/admin/notifications", { action: "subscribe", subscription: sub.toJSON(), device: navigator.userAgent });
      setPush("on");
      setPushMsg("Notifications are on for this device.");
      load();
    } catch (e) {
      onAuthError(e);
      setPushMsg(e instanceof Error ? e.message : "Couldn't turn on notifications.");
    }
  }

  async function turnOffPush() {
    setPushMsg("");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api("/api/admin/notifications", { action: "unsubscribe", endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setPush("off");
      load();
    } catch (e) {
      onAuthError(e);
      setPushMsg(e instanceof Error ? e.message : "Couldn't turn off notifications.");
    }
  }

  async function sendTest() {
    setPushMsg("Sending…");
    try {
      const r = await api<{ sent: number }>("/api/admin/notifications", { action: "test" });
      setPushMsg(r.sent ? `Test sent to ${r.sent} device${r.sent === 1 ? "" : "s"}.` : "No devices are turned on yet.");
    } catch (e) {
      onAuthError(e);
      setPushMsg(e instanceof Error ? e.message : "Test failed.");
    }
  }

  const unread = data?.unread ?? 0;

  return (
    <div className="notify" ref={panel}>
      <button type="button" className="bell" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open} onClick={toggle}>
        🔔{unread > 0 && <span className="bell-count">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && data && (
        <div className="notify-panel" role="dialog" aria-label="Notifications">
          <div className="notify-head">
            <strong>Notifications</strong>
            <button type="button" className="link-btn" onClick={() => setSettings((v) => !v)}>{settings ? "Back" : "⚙ Settings"}</button>
          </div>

          {settings ? (
            <div className="notify-settings">
              <p className="hint" style={{ margin: 0 }}>Notify me about:</p>
              {NOTIFY_KINDS.map((k) => (
                <label key={k.id} className="check">
                  <input type="checkbox" checked={data.kinds.includes(k.id)} onChange={(e) => setKinds(k.id, e.target.checked)} />
                  {k.icon} {k.label}
                </label>
              ))}
              <label className="check" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={sound} onChange={(e) => setSoundOn(e.target.checked)} />
                🔊 Chime for new notifications (this device)
              </label>

              <div className="notify-push">
                <strong>Push notifications on this device</strong>
                {push === "on" && (
                  <>
                    <p className="hint">On ✓ — you&apos;ll be notified even when this page is closed.</p>
                    <div className="card-actions" style={{ marginTop: 0 }}>
                      <button type="button" className="btn small secondary" onClick={sendTest}>Send a test</button>
                      <button type="button" className="btn small secondary" onClick={turnOffPush}>Turn off</button>
                    </div>
                  </>
                )}
                {push === "off" && (
                  <>
                    <p className="hint">Get notified on this phone or computer even when the admin panel is closed.</p>
                    <button type="button" className="btn small" onClick={turnOnPush} disabled={!data.push}>Turn on notifications</button>
                    {!data.push && <p className="hint">Not set up on the server yet (VAPID keys).</p>}
                  </>
                )}
                {push === "denied" && (
                  <p className="hint">Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload.</p>
                )}
                {push === "needs-install" && (
                  <p className="hint">On iPhone/iPad: tap <strong>Share → Add to Home Screen</strong>, open NVBC from the Home Screen, log in, and turn notifications on there (iOS 16.4 or later).</p>
                )}
                {push === "unsupported" && <p className="hint">This browser doesn&apos;t support push notifications.</p>}
                {data.devices > 0 && <p className="hint">{data.devices} device{data.devices === 1 ? "" : "s"} turned on for your account.</p>}
                {pushMsg && <p className="hint" role="status">{pushMsg}</p>}
              </div>
            </div>
          ) : data.events.length === 0 ? (
            <p className="muted" style={{ margin: 12 }}>No notifications yet.</p>
          ) : (
            <ul className="notify-list">
              {data.events.map((e) => (
                <li key={e.id}>
                  <button type="button" className={e.id > data.lastSeen ? "unread" : undefined} onClick={() => openEvent(e)}>
                    <span className="notify-icon" aria-hidden="true">{kindIcon(e.kind)}</span>
                    <span className="notify-text">
                      <strong>{e.title}</strong>
                      <span>{e.body}</span>
                      <small>{timeAgo(e.created_at)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <button type="button" key={t.key} className="toast" onClick={() => (t.event ? openEvent(t.event) : (setOpen(true), setToasts([])))}>
            <span aria-hidden="true">{t.event ? kindIcon(t.event.kind) : "🔔"}</span>
            <span>
              <strong>{t.title}</strong>
              <small>{t.body}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
