"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import { PaymentDetails, ProofFields, usePaymentInfo } from "@/components/PaymentPanel";
import { formatDateLong } from "@/lib/format";
import { formatPeso, paymentLabel, type PaymentMethod } from "@/lib/pricing";
import { currentSubscription, isIos, isStandalone, pushSupported, subscribeDevice } from "@/lib/push-client";
import { rememberOrder } from "@/lib/saved-stringing";
import { priceLines, RACKET_STATUSES, RACKET_STEPS, racketStatusLabel, setupLabel, tagLabel } from "@/lib/stringing";
import Receipt from "@/components/Receipt";
import type { StringingView } from "@/lib/stringings";

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/stringing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Something went wrong. Please try again.");
  return j as T;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/** /string/<token>: the customer's rackets and where each one is, paying, updates, and feedback. */
export default function StringingStatus({ token }: { token: string }) {
  const [v, setV] = useState<StringingView | null>(null);
  const [error, setError] = useState("");
  const seen = useRef(""); // the stamp of what's on screen
  const lastNews = useRef(Date.now());

  const load = useCallback(async () => {
    try {
      const view = await post<StringingView>({ action: "view", token });
      setV(view);
      setError("");
      seen.current = view.stamp;
      rememberOrder(token, view.rackets.map((r) => r.tag));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your rackets.");
    }
  }, [token]);
  useEffect(() => {
    load();
    // Back on this page (e.g. from a notification): show the latest.
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      lastNews.current = Date.now();
      load();
    };
    document.addEventListener("visibilitychange", onShow);
    // A push notification arrived while the page is open: show it now.
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    const onPush = (e: MessageEvent) => e.data?.type === "nvbc-push" && load();
    sw?.addEventListener("message", onPush);
    sw?.startMessages?.();
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      sw?.removeEventListener("message", onPush);
    };
  }, [load]);
  // While it's on screen, check for news: a tiny request (has anything changed?) every 15 seconds
  // while the racket is with us, every minute once it's ready; the page loads again only when
  // something changed. It stops after half an hour without news (until the page is opened again),
  // and once everything is picked up.
  useEffect(() => {
    if (!v) return;
    const open = v.rackets.filter((r) => r.status !== "picked_up" && r.status !== "cancelled");
    const waitingOnUs = v.paymentStatus === "for_verification";
    if (!open.length && !waitingOnUs) return;
    const busy = waitingOnUs || open.some((r) => r.status !== "done");
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible" || Date.now() - lastNews.current > 30 * 60_000) return;
      try {
        const { stamp } = await post<{ stamp: string }>({ action: "stamp", token });
        if (stamp !== seen.current) {
          lastNews.current = Date.now();
          load();
        }
      } catch {
        // offline for a moment: try again next time
      }
    }, busy ? 15_000 : 60_000);
    return () => clearInterval(t);
  }, [v, token, load]);
  useEffect(() => {
    if (v && window.location.hash === "#feedback") document.getElementById("feedback")?.scrollIntoView({ behavior: "smooth" });
  }, [v]);

  if (error && !v) return <div className="stack"><div className="error">{error}</div><Link href="/string" className="btn secondary">Check in a racket</Link></div>;
  if (!v) return <FullScreenLoader label="Getting your rackets…" />;
  const live = v.rackets.filter((r) => r.status !== "cancelled");
  const ready = live.filter((r) => r.status === "done");
  const paid = v.paymentStatus === "paid" || v.paymentStatus === "waived";

  return (
    <div className="stack stringing-page">
      <div>
        <h1 style={{ margin: 0 }}>🏸 Your racket{live.length === 1 ? "" : "s"}</h1>
        <p className="lead" style={{ margin: "6px 0 0" }}>
          {v.name} · checked in {when(v.createdAt)}
        </p>
      </div>
      {ready.length > 0 && (
        <div className="success sf-ready">
          🎉 <strong>{ready.map((r) => tagLabel(r.tag)).join(", ")} {ready.length === 1 ? "is" : "are"} ready for pickup</strong> at the NVBC
          front desk. Just give your name or tag number.
          {v.balance > 0 && <> Please pay the balance of <strong>{formatPeso(v.balance)}</strong>.</>}
        </div>
      )}

      {v.rackets.map((r) => {
        const step = RACKET_STEPS.indexOf(r.status);
        return (
          <div key={r.tag} className={`card sf-status${r.status === "cancelled" ? " cancelled" : ""}`}>
            <div className="sf-status-head">
              <span className="sf-tag">{tagLabel(r.tag)}</span>
              <div>
                <strong>{r.racket}</strong>
                <div className="hint">
                  {r.string_name}{r.string_color ? ` (${r.string_color})` : ""}{r.own_string ? " · your own string" : ""} ·{" "}
                  {setupLabel(Number(r.tension_main), Number(r.tension_cross), r.prestretch)}
                  {r.rush && <> · <span className="badge pending">⚡ Rush</span></>}
                </div>
              </div>
            </div>
            {r.status === "cancelled" ? (
              <p className="muted" style={{ margin: 0 }}>Cancelled.</p>
            ) : (
              <>
                <ol className="sf-steps">
                  {RACKET_STEPS.map((s, i) => (
                    <li key={s} className={i < step ? "done" : i === step ? "current" : ""}>
                      {racketStatusLabel(s)}
                      <small>
                        {s === "received" && when(r.received_at)}
                        {s === "in_progress" && when(r.started_at)}
                        {s === "done" && when(r.done_at)}
                        {s === "picked_up" && when(r.picked_up_at)}
                      </small>
                    </li>
                  ))}
                </ol>
                <p style={{ margin: 0 }}>
                  {r.status === "checked_in"
                    ? <>👉 Bring it to the front desk and say <strong>tag {tagLabel(r.tag)}</strong>. </>
                    : `${RACKET_STATUSES.find((x) => x.id === r.status)?.step}. `}
                  {r.status !== "picked_up" && r.status !== "done" && <>Collection date: <strong>{formatDateLong(r.due_on)}</strong>.</>}
                </p>
              </>
            )}
            <Receipt className="sf-receipt" total={Number(r.total)} lines={priceLines(
              { labor: Number(r.labor_fee), rush: Number(r.rush_fee), string: Number(r.string_price), grommets: Number(r.grommet_fee) },
              r.grommets_single + r.grommets_double)} />
            {r.notes && <p className="hint" style={{ margin: 0 }}>Notes: {r.notes}</p>}
            {r.remarks && <Remarks text={r.remarks} />}
          </div>
        );
      })}

      {live.length > 0 && <PayBox v={v} token={token} paid={paid} onDone={load} />}
      {live.length > 0 && <KeepPage token={token} />}
      {live.some((r) => r.status !== "picked_up") && <Updates token={token} email={v.email} onChanged={load} />}
      {v.canGiveFeedback && <Feedback token={token} given={v.feedback} />}

      <p className="hint">
        This page is saved on this device. Checking in another racket? <Link href="/string">Start a new check-in</Link>.
      </p>
    </div>
  );
}

/** Paying: online (GCash and others, with the reference or a screenshot) or cash at the desk. */
function PayBox({ v, token, paid, onDone }: { v: StringingView; token: string; paid: boolean; onDone: () => void }) {
  const { info } = usePaymentInfo();
  const methods = v.methods;
  const [method, setMethod] = useState<PaymentMethod>(methods.includes(v.paymentMethod) ? v.paymentMethod : methods[0] ?? "cash");
  const [reference, setReference] = useState(v.paymentRef);
  const [proof, setProof] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sent = v.paymentStatus === "for_verification";

  if (paid)
    return (
      <div className="card pay-row total">
        <span>✓ Paid{v.paymentStatus === "waived" ? " (no charge)" : ""}</span>
        <span>{v.balance > 0 ? `${formatPeso(v.balance)} left to pay` : formatPeso(v.total)}</span>
      </div>
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (method !== "cash" && !reference.trim() && !proof && !v.hasProof) return setError("Enter the reference number or upload a screenshot of your receipt.");
    setBusy(true);
    setError("");
    try {
      await post({ action: "pay", token, method, reference, proof, amountPaid: amount });
      setProof("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your payment details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pay-box">
      <div className="pay-row">
        <span>To pay</span>
        <strong style={{ fontSize: 22 }}>{formatPeso(v.balance)}</strong>
      </div>
      {v.paymentStatus === "rejected" && v.rejectedNote && (
        <div className="error" style={{ marginTop: 10 }}>We couldn&apos;t confirm your payment: {v.rejectedNote}</div>
      )}
      {sent && <div className="success" style={{ marginTop: 10 }}>Payment details received — the front desk will check them. You can correct them below.</div>}
      <div className="method-pills" role="radiogroup" aria-label="Payment method">
        {methods.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}>
            {m === "cash" ? "Cash at the desk" : paymentLabel(m)}
          </button>
        ))}
      </div>
      {method === "cash" ? (
        <p style={{ margin: "10px 0 0" }}>Pay <strong>{formatPeso(v.balance)}</strong> in cash at the front desk when you drop off your racket.</p>
      ) : (
        <form onSubmit={submit}>
          {info && <PaymentDetails info={info} method={method} amount={v.balance} />}
          <p className="muted" style={{ fontSize: 14, margin: "10px 0" }}>
            After paying, enter the reference number or upload a screenshot of the receipt so the front desk can confirm it.
          </p>
          <ProofFields reference={reference} onReference={setReference} proof={proof} onProof={setProof} hasProof={v.hasProof}
            amount={amount} onAmount={setAmount} expectedAmount={v.balance} />
          <button className="btn" disabled={busy} style={{ marginTop: 10 }}>{busy ? "Sending…" : sent ? "Update" : "Send payment details"}</button>
        </form>
      )}
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}

// Chrome (Android, computers) offers to install the page as an app; keep that offer for our button.
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installPrompt: InstallPrompt | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== "undefined")
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    installListeners.forEach((f) => f());
  });

/** "Keep this page handy": the page's link to share or copy, and Add to Home Screen (it opens this page). */
function KeepPage({ token }: { token: string }) {
  const [url, setUrl] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [home, setHome] = useState<"hidden" | "prompt" | "ios" | "android" | "computer">("hidden");
  const [howTo, setHowTo] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUrl(`${window.location.origin}/string/${token}`);
    setCanShare(typeof navigator.share === "function");
    const pick = () =>
      setHome(isStandalone() ? "hidden" // opened from the Home Screen already
        : installPrompt ? "prompt"
        : isIos() ? "ios"
        : /android/i.test(navigator.userAgent) ? "android"
        : "computer");
    pick();
    installListeners.add(pick);
    return () => { installListeners.delete(pick); };
  }, [token]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      input.current?.select(); // they can copy it from the box
    }
  }
  async function addToHome() {
    if (!installPrompt) return setHowTo((x) => !x);
    await installPrompt.prompt().catch(() => {});
    installPrompt = null;
    setHome("hidden");
  }
  if (!url) return null;

  return (
    <div className="card stack sf-keep">
      <div>
        <strong>📌 Keep this page handy</strong>
        <div className="hint">It&apos;s your racket&apos;s own link. Save it to check on your racket any time, from any phone.</div>
      </div>
      <input ref={input} className="share-url" readOnly aria-label="Your link" value={url} onFocus={(e) => e.target.select()} />
      <div className="sf-keep-actions">
        {canShare && (
          <button type="button" className="btn" onClick={() => navigator.share({ title: "My racket stringing — NVBC", url }).catch(() => {})}>
            Share link
          </button>
        )}
        <button type="button" className={`btn${canShare ? " secondary" : ""}`} onClick={copy}>{copied ? "✓ Copied" : "Copy link"}</button>
      </div>
      {home !== "hidden" && (
        <div className="sf-keep-home">
          <div>
            <strong>{home === "computer" ? "Bookmark it" : "Add to Home Screen"}</strong>
            <div className="hint">
              {home === "computer" ? "Press Ctrl+D (⌘D on a Mac) to find it again in one click." : "One tap to your racket, like an app."}
            </div>
          </div>
          {home !== "computer" && (
            <button type="button" className="btn small secondary" aria-expanded={home === "prompt" ? undefined : howTo} onClick={addToHome}>
              {home === "prompt" ? "Add" : "How?"}
            </button>
          )}
        </div>
      )}
      {howTo && home === "ios" && (
        <p className="hint" style={{ margin: 0 }}>Tap the Share button (the square with an arrow) in your browser, then <strong>Add to Home Screen</strong>.</p>
      )}
      {howTo && home === "android" && (
        <p className="hint" style={{ margin: 0 }}>Open your browser&apos;s menu (⋮), then <strong>Add to Home screen</strong> or <strong>Install app</strong>.</p>
      )}
      <p className="hint" style={{ margin: 0 }}>Anyone with the link can see your racket&apos;s progress, so share it only with people you trust.</p>
    </div>
  );
}

/** What the stringer noticed about the racket (a crack, a loose grip…). */
function Remarks({ text }: { text: string }) {
  return (
    <div className="sf-remarks">
      <strong>📝 From our stringer</strong>
      <p>{text}</p>
    </div>
  );
}

/** "Tell me when it's ready": push on this device, and email. */
function Updates({ token, email, onChanged }: { token: string; email: string; onChanged: () => void }) {
  const [push, setPush] = useState<"checking" | "on" | "off" | "unavailable" | "needs-install" | "denied">("checking");
  const [key, setKey] = useState<string | null>(null);
  const [mail, setMail] = useState(email);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const sub = await currentSubscription().catch(() => null);
      const s = await post<{ on: boolean; push: { publicKey: string } | null }>({ action: "push-status", token, endpoint: sub?.endpoint }).catch(() => null);
      setKey(s?.push?.publicKey ?? null);
      if (!s?.push || !window.isSecureContext) setPush("unavailable");
      else if (!pushSupported()) setPush(isIos() && !isStandalone() ? "needs-install" : "unavailable");
      else if (Notification.permission === "denied") setPush("denied");
      else setPush(s.on ? "on" : "off");
    })();
  }, [token]);

  async function turnOn() {
    if (!key) return;
    setBusy(true);
    setError("");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setPush("denied");
      const sub = await subscribeDevice(key);
      await post({ action: "push", token, on: true, subscription: sub.toJSON() });
      setPush("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn on notifications.");
    } finally {
      setBusy(false);
    }
  }
  async function turnOff() {
    setBusy(true);
    try {
      const sub = await currentSubscription();
      await post({ action: "push", token, on: false, endpoint: sub?.endpoint });
      setPush("off");
    } finally {
      setBusy(false);
    }
  }
  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post({ action: "email", token, email: mail });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <strong>🔔 Tell me when it&apos;s ready</strong>
      {push === "on" && (
        <p>✓ This phone gets a notification when your racket is ready.{" "}
          <button type="button" className="link-btn" disabled={busy} onClick={turnOff}>Turn off</button></p>
      )}
      {push === "off" && <div><button type="button" className="btn secondary" disabled={busy} onClick={turnOn}>Notify this phone</button></div>}
      {push === "needs-install" && <p className="hint">On iPhone, add this page to your Home Screen (Share → Add to Home Screen) to get notifications.</p>}
      {push === "denied" && <p className="hint">Notifications are blocked for this site in your browser settings.</p>}
      {editing || !email ? (
        <form className="sf-inline" onSubmit={saveEmail}>
          <input type="email" inputMode="email" required placeholder="Your email" aria-label="Email for updates" value={mail} onChange={(e) => setMail(e.target.value)} />
          <button className="btn secondary" disabled={busy}>Save</button>
        </form>
      ) : (
        <p>✉ We&apos;ll also email <strong>{email}</strong>.{" "}
          <button type="button" className="link-btn" onClick={() => setEditing(true)}>Change</button></p>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

/** 1–5 stars and a comment, after pickup. */
function Feedback({ token, given }: { token: string; given: StringingView["feedback"] }) {
  const [rating, setRating] = useState(given?.rating ?? 0);
  const [comment, setComment] = useState(given?.comment ?? "");
  const [done, setDone] = useState(!!given);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return setError("Tap 1 to 5 stars.");
    setBusy(true);
    setError("");
    try {
      await post({ action: "feedback", token, rating, comment });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your feedback.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id="feedback" className="card stack" onSubmit={submit}>
      <strong>How was our stringing service?</strong>
      {done ? (
        <p>
          Thank you for your feedback! {"★".repeat(rating)}{" "}
          <button type="button" className="link-btn" onClick={() => setDone(false)}>Change</button>
        </p>
      ) : (
        <>
          <div className="sf-stars" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? "" : "s"}`}
                className={n <= rating ? "on" : ""} onClick={() => setRating(n)}>★</button>
            ))}
          </div>
          <textarea rows={3} maxLength={1000} placeholder="Anything we could do better? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
          {error && <div className="error">{error}</div>}
          <button className="btn" disabled={busy}>{busy ? "Sending…" : "Send feedback"}</button>
        </>
      )}
    </form>
  );
}
