"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { payByLabel } from "@/components/BookingPolicy";
import {
  awaitingPayment,
  bookingPhase,
  minutesUntilStart,
  phaseLabel,
  REFUND_HOURS,
  refundOnCancel,
  RELEASE_MINUTES,
  startedUnverified,
  type Phase,
} from "@/lib/booking-policy";
import { formatClock, formatDateLong, formatHour, formatRange } from "@/lib/format";
import {
  bookingStatusLabel,
  formatPeso,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  paymentLabel,
  paymentStatusLabel,
  rateTypeLabel,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/pricing";
import { sportEmoji } from "@/lib/sports";
import { nowAtFacility } from "@/lib/time";
import BookingHistory from "./BookingHistory";
import EditBooking from "./EditBooking";
import QrScanner from "./QrScanner";
import { api, type AdminBooking, type Court, type PaymentReuse } from "./shared";

/** Refund wording for cancelling this booking now (online payments: 12-hour rule). */
export function refundNote(b: AdminBooking): string {
  const r = refundOnCancel({ ...b, start_hour: b.start_hour }, nowAtFacility());
  if (r === "refundable") return `\n\nPaid by ${paymentLabel(b.payment_method)} and cancelled ${REFUND_HOURS}+ hours before the start: eligible for a refund of ${formatPeso(b.amount)}.`;
  if (r === "non-refundable") return `\n\nPaid by ${paymentLabel(b.payment_method)}, less than ${REFUND_HOURS} hours before the start: non-refundable under the booking policy.`;
  if (b.payment_status === "paid") return `\n\nThis booking is PAID (${formatPeso(b.amount)}, ${paymentLabel(b.payment_method)}).`;
  return "";
}

/** "10:32 AM" in Manila time, from an ISO timestamp. */
export function clockFromIso(iso: string): string {
  const d = new Date(iso);
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const [h, m] = t.split(":").map(Number);
  return formatClock(h + m / 60);
}

/**
 * What to show for a booking right now: its progress (in progress / completed) if it has one,
 * otherwise its status — with "released" for bookings released automatically.
 */
export type DisplayStatus = "pending" | "reserved" | "confirmed" | "in_progress" | "completed" | "cancelled" | "released";
export function displayStatus(b: AdminBooking): DisplayStatus {
  if (b.status === "cancelled") return b.cancelled_by === "system" ? "released" : "cancelled";
  return bookingPhase(b, nowAtFacility()) ?? b.status;
}
export const displayLabel = (d: DisplayStatus) =>
  d === "in_progress" || d === "completed" ? phaseLabel(d) : d === "released" ? "Released" : bookingStatusLabel(d);

/** When an unpaid active booking is released, in words. */
export function releaseNote(b: AdminBooking): string | null {
  if ((b.status !== "pending" && b.status !== "reserved") || !awaitingPayment(b.payment_status) || b.amount <= 0) return null;
  if (b.phase || !b.auto_release) return null; // marked in progress/completed, or restored: kept
  if (b.pay_by) return `Released at ${clockFromIso(b.pay_by)} if not paid online`;
  return `Released at ${payByLabel(b.date, b.start_hour)} if unpaid`;
}

/** "Tue, Sep 29" in Manila time, from an ISO timestamp. */
const dayFromIso = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" });

/** The online payment proof (reference and/or screenshot) to check, if any. */
export const hasOnlineProof = (b: AdminBooking) => b.payment_method !== "cash" && (b.payment_ref !== "" || b.has_proof);

/** What staff should see on the screenshot, one line each, for the checklist. */
function paymentChecks(b: AdminBooking): { id: string; label: ReactNode }[] {
  const checks: { id: string; label: ReactNode }[] = [
    { id: "amount", label: <>The amount is <strong>{formatPeso(b.amount)}</strong></> },
  ];
  if (b.pay_to) checks.push({ id: "to", label: <>It was sent to <strong>{b.pay_to}</strong></> });
  if (b.payment_sent_at)
    checks.push({
      id: "when",
      label: (
        <>
          It&apos;s dated <strong>{dayFromIso(b.payment_sent_at)}</strong>, at or a little before{" "}
          <strong>{clockFromIso(b.payment_sent_at)}</strong>
          <span className="muted"> (sent to us then; booked {dayFromIso(b.created_at) === dayFromIso(b.payment_sent_at) ? "" : `${dayFromIso(b.created_at)} `}at {clockFromIso(b.created_at)})</span>
        </>
      ),
    });
  if (b.payment_ref)
    checks.push({ id: "ref", label: <>Its reference number is <strong className="mono">{b.payment_ref}</strong></> });
  return checks;
}

/** Other bookings that used the same reference number or screenshot — shown whatever the payment status. */
function ReuseWarning({ b }: { b: AdminBooking }) {
  const others = b.payment_reuse;
  if (others.length === 0) return null;
  const what = (o: PaymentReuse) => (o.same_ref && o.same_proof ? "same reference and screenshot" : o.same_proof ? "same screenshot" : "same reference");
  const active = others.filter((o) => o.status !== "cancelled");
  // One transfer covering several bookings by the same person is fine if the amount covers them all.
  const samePerson = others.every((o) => o.name.trim().toLowerCase() === b.name.trim().toLowerCase());
  const total = b.amount + active.reduce((n, o) => n + o.amount, 0);
  return (
    <div className="notice pay-reuse" style={{ marginTop: 10 }}>
      <strong>⚠ {others.some((o) => o.same_proof) ? "This payment was also sent" : "This reference number was also used"} for {others.length} other booking{others.length > 1 ? "s" : ""}:</strong>
      <ul>
        {others.map((o) => (
          <li key={o.code}>
            <span className="mono">{o.code}</span> · {o.name} · {formatDateLong(o.date)} {formatHour(o.start_hour)} ·{" "}
            {formatPeso(o.amount)} · {o.status === "cancelled" ? "cancelled" : bookingStatusLabel(o.status).toLowerCase()} — <em>{what(o)}</em>
          </li>
        ))}
      </ul>
      {samePerson && active.length > 0 ? (
        <span>Same name — this may be one payment for several bookings. If so, the amount on it should be <strong>{formatPeso(total)}</strong> in total.</span>
      ) : (
        <span>{samePerson ? "Same name, but on a cancelled booking" : "A different name"} — check carefully; it may be a reused screenshot or reference.</span>
      )}
    </div>
  );
}

/**
 * Online payment waiting to be verified: the screenshot beside a checklist of what it should show.
 * Amounts and dates on a screenshot can't be read automatically, so staff tick them off; reuse of
 * the same reference number or screenshot is found automatically (ReuseWarning).
 */
function PaymentCheck({ b, ticked, onTick }: { b: AdminBooking; ticked: Set<string>; onTick: (id: string) => void }) {
  const proof = `/api/admin/bookings/proof?id=${b.id}`;
  return (
    <div className="pay-check">
      {b.has_proof ? (
        <a href={proof} target="_blank" rel="noopener noreferrer" className="pay-shot" title="Open the screenshot full size">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-protected image */}
          <img src={proof} alt={`${b.name}'s payment screenshot`} />
          <span>🔍 Open full size</span>
        </a>
      ) : (
        <div className="pay-shot none">
          No screenshot — reference number only. Look it up in the {paymentLabel(b.payment_method)} app&apos;s history.
        </div>
      )}
      <div className="pay-checklist">
        <strong>Check the payment</strong>
        {paymentChecks(b).map((c) => (
          <label key={c.id} className="check-row">
            <input type="checkbox" checked={ticked.has(c.id)} onChange={() => onTick(c.id)} />
            <span>{c.label}</span>
          </label>
        ))}
        <div className={`auto-check ${b.payment_reuse.length ? "bad" : "good"}`}>
          {b.payment_reuse.length
            ? "⚠ Reference or screenshot also sent for another booking (see below)"
            : `✓ ${b.payment_ref && b.has_proof ? "Reference and screenshot" : b.payment_ref ? "Reference" : "Screenshot"} not used on any other booking`}
        </div>
      </div>
    </div>
  );
}

/** Common reasons, to fill the note with one tap (staff can edit it). */
const REJECT_REASONS = [
  "The amount on the screenshot doesn't match the booking.",
  "We haven't received this payment in our account.",
  "The reference number doesn't match our records.",
  "The screenshot is unclear or incomplete.",
  "This screenshot was already used for another booking.",
];

/** Staff reject an online payment, with a note that's sent to the customer. */
function RejectPayment({ b, busy, onReject, onCancel }: { b: AdminBooking; busy: boolean; onReject: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState("");
  const soon = minutesUntilStart(b.date, b.start_hour, nowAtFacility()) <= RELEASE_MINUTES + 1;
  const reach = [b.alert_devices > 0 ? "push notification" : "", b.customer_email ? "email" : ""].filter(Boolean).join(" and ");
  return (
    <form className="reject-box" onSubmit={(e) => {
      e.preventDefault();
      if (soon && !window.confirm(`This booking starts within ${RELEASE_MINUTES} minutes, so rejecting the payment releases the slot right away. Reject anyway?`)) return;
      onReject(note.trim());
    }}>
      <strong>Reject this payment</strong>
      <p className="hint" style={{ margin: 0 }}>
        The booking stays held, and the customer gets 15 minutes to send a correct payment or screenshot (or it&apos;s released).
        They see your note on their booking page{reach ? ` and by ${reach}` : " — they haven't turned on notifications, so you may want to call them"}.
      </p>
      <div className="reason-chips">
        {REJECT_REASONS.map((r) => (
          <button key={r} type="button" className={`chip${note === r ? " on" : ""}`} onClick={() => setNote(r)}>{r}</button>
        ))}
      </div>
      <textarea aria-label="Note for the customer" required minLength={3} maxLength={300} value={note}
        placeholder="Note for the customer, e.g. The screenshot shows ₱300, but the booking is ₱400."
        onChange={(e) => setNote(e.target.value)} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn danger" disabled={busy || note.trim().length < 3}>✕ Reject and tell the customer</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Back</button>
      </div>
    </form>
  );
}

/**
 * One booking with staff actions: confirm payment, edit, cancel. Used by the booking scanner in
 * /admin and by staff mode on the public booking grid.
 */
export function AdminBookingCard({
  b,
  onChanged,
  onOpenDate,
  onAuthError,
}: {
  b: AdminBooking;
  onChanged: () => void; // reload after a change
  onOpenDate?: (date: string) => void;
  onAuthError: (e: unknown) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>(b.payment_method);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [courts, setCourts] = useState<Court[] | null>(null); // loaded when editing
  const [editing, setEditing] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set()); // payment checklist
  const [rejecting, setRejecting] = useState(false);
  const shown = displayStatus(b);
  const verifying = b.status !== "cancelled" && b.payment_status === "for_verification" && hasOnlineProof(b);
  const tick = (id: string) =>
    setTicked((t) => {
      const n = new Set(t);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const confirmPayment = () => {
    if (verifying) {
      const left = paymentChecks(b).filter((c) => !ticked.has(c.id)).length;
      const warn = [
        left ? `${left} check${left > 1 ? "s aren't" : " isn't"} ticked yet.` : "",
        b.payment_reuse.length ? "This reference number or screenshot was also sent for another booking." : "",
      ].filter(Boolean);
      if (warn.length && !window.confirm(`${warn.join("\n")}\n\nConfirm ${b.name}'s payment of ${formatPeso(b.amount)} anyway?`)) return;
    }
    run({ action: "payment", id: b.id, status: "paid", method });
  };
  const phase = bookingPhase(b, nowAtFacility());

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/bookings", body);
      onChanged();
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function startEdit() {
    try {
      if (!courts) setCourts((await api<{ courts: Court[] }>("/api/admin/courts")).courts);
      setEditing(true);
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Could not load courts");
    }
  }

  const released = shown === "released";
  const release = releaseNote(b);
  const played = phase ? `\n\nThis booking is marked ${phaseLabel(phase).toLowerCase()} — it has already been played.` : "";
  const cancel = () => window.confirm(`Cancel ${b.name}'s booking (${b.code})?${refundNote(b)}${played}`) && run({ action: "cancel", id: b.id });
  const setPhase = (p: Phase | null) => run({ action: "phase", id: b.id, phase: p });
  const restore = (p: Phase | null) =>
    window.confirm(
      `Restore ${b.name}'s booking (${b.code}) as ${p ? phaseLabel(p) : "upcoming"}? It takes its time slot back and won't be released for non-payment again.`
    ) && run({ action: "restore", id: b.id, phase: p });
  const remove = () =>
    window.confirm(`Permanently delete ${b.name}'s cancelled booking (${b.code})? This can't be undone.`) && run({ action: "delete", id: b.id });
  const remind = async () => {
    try {
      await api("/api/admin/members", { action: "remind", id: b.expired_member_id });
      onChanged();
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  if (editing && courts)
    return (
      <div className={`lookup-result booking-${b.status}`}>
        <EditBooking booking={b} courts={courts} onAuthError={onAuthError} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChanged(); }} />
      </div>
    );

  return (
    <div className={`lookup-result booking-${shown}`}>
      <div className="lookup-status">
        <span className="lookup-icon" aria-hidden="true">
          {shown === "confirmed" || shown === "completed" ? "✓" : shown === "in_progress" ? "▶" : shown === "pending" ? "…" : shown === "reserved" ? "R" : "×"}
        </span>
        <div>
          <strong>
            {shown === "in_progress" ? `In progress${b.phase ? " (marked by staff)" : ""}`
              : shown === "completed" ? `Completed${b.phase ? " (marked by staff)" : ""}`
              : shown === "confirmed" ? "Confirmed"
              : shown === "pending" ? (b.payment_status === "for_verification" ? `Pending — payment ${b.rejected_at ? "sent again" : "sent"}, please verify`
                : b.payment_status === "rejected" ? "Pending — payment rejected, waiting for the customer"
                : "Pending — waiting for payment")
              : shown === "reserved" ? "Reserved — coach paying cash at the desk"
              : released ? "Released (not paid in time)"
              : `Cancelled${b.cancelled_by ? ` by ${b.cancelled_by}` : ""}`}
          </strong>
          <div>
            {b.code} · {sportEmoji(b.sport)} {b.court_name} · {formatDateLong(b.date)} · {formatRange(b.start_hour, b.end_hour)}
          </div>
        </div>
        {onOpenDate && (
          <button type="button" className="btn small secondary" style={{ marginLeft: "auto" }} onClick={() => onOpenDate(b.date)}>
            Open that day
          </button>
        )}
      </div>

      <dl className="member-details">
        <div><dt>Name</dt><dd><strong>{b.name}</strong></dd></div>
        <div><dt>Contact</dt><dd>{b.contact}</dd></div>
        <div>
          <dt>Rate</dt>
          <dd>{rateTypeLabel(b.rate_type)}{b.member_code ? ` · ${b.member_code}` : ""} · {formatPeso(b.hourly_rate)}/hr</dd>
        </div>
        <div><dt>Amount</dt><dd><strong>{formatPeso(b.amount)}</strong></dd></div>
        <div>
          <dt>Payment</dt>
          <dd>
            {paymentLabel(b.payment_method)} · {paymentStatusLabel(b.payment_status)}
            {b.payment_ref && <> · <span style={{ fontFamily: "ui-monospace, monospace" }}>{b.payment_ref}</span></>}
            {b.has_proof && <> · <a href={`/api/admin/bookings/proof?id=${b.id}`} target="_blank" rel="noopener noreferrer">📷 Screenshot</a></>}
          </dd>
        </div>
        {release && <div><dt>If unpaid</dt><dd><strong>{release}</strong></dd></div>}
        {b.status !== "cancelled" && (
          <div>
            <dt>Updates</dt>
            <dd>
              {b.alert_devices || b.customer_email
                ? [b.alert_devices ? `🔔 ${b.alert_devices} device${b.alert_devices > 1 ? "s" : ""}` : "", b.customer_email ? `✉ ${b.customer_email}` : ""].filter(Boolean).join(" · ")
                : <span className="muted">Not turned on</span>}
            </dd>
          </div>
        )}
        {b.notes && <div><dt>Notes</dt><dd>{b.notes}</dd></div>}
      </dl>

      {startedUnverified(b, nowAtFacility()) && (
        <div className="notice" style={{ marginTop: 10 }}>⚠ This booking has started, but its payment hasn&apos;t been verified yet.</div>
      )}
      {b.rejected_at && b.status !== "cancelled" && (b.payment_status === "rejected" || b.payment_status === "for_verification") && (
        <div className="rejected-note">
          <strong>✕ {b.payment_status === "rejected" ? "Payment rejected" : "Rejected earlier"}</strong> by {b.rejected_by ?? "staff"},{" "}
          {clockFromIso(b.rejected_at)}: “{b.rejected_note}”
        </div>
      )}
      {verifying && <PaymentCheck b={b} ticked={ticked} onTick={tick} />}
      <ReuseWarning b={b} />
      {b.expired_member_id && (
        <div className="expired-flag" style={{ marginTop: 10 }}>
          ⚠ {b.expired_member_name}&apos;s membership expired — remind them to renew or forfeit.{" "}
          {b.expired_member_reminded ? <span className="muted">Reminded.</span> : (
            <button type="button" className="link-btn" onClick={remind}>Mark reminded</button>
          )}
        </div>
      )}
      {b.restored_by && b.status !== "cancelled" && (
        <p className="hint" style={{ margin: "8px 0 0" }}>Restored by {b.restored_by} after an automatic release — it won&apos;t be released again.</p>
      )}
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}

      {b.status !== "cancelled" && (
        <>
          {b.status !== "confirmed" && (
            <div className="confirm-pay">
              <label htmlFor={`bl-method-${b.id}`} style={{ margin: 0 }}>Paid by</label>
              <select id={`bl-method-${b.id}`} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} style={{ width: "auto" }}>
                {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              <button className="btn" disabled={busy} onClick={confirmPayment}>
                ✓ Payment received — confirm ({formatPeso(b.amount)})
              </button>
              {verifying && !rejecting && (
                <button type="button" className="btn secondary danger-text" disabled={busy} onClick={() => setRejecting(true)}>
                  ✕ Reject payment…
                </button>
              )}
            </div>
          )}
          {verifying && rejecting && (
            <RejectPayment b={b} busy={busy} onCancel={() => setRejecting(false)}
              onReject={(note) => run({ action: "payment", id: b.id, status: "rejected", note })} />
          )}
          <div className="card-actions">
            <div className="segmented phase-switch" role="radiogroup" aria-label="Progress">
              <button type="button" role="radio" aria-checked={!b.phase} disabled={busy} onClick={() => setPhase(null)}
                title="Paid bookings are In progress during their time and Completed after">
                Automatic{!b.phase && phase ? ` · ${phaseLabel(phase)}` : ""}
              </button>
              <button type="button" role="radio" aria-checked={b.phase === "in_progress"} disabled={busy} onClick={() => setPhase("in_progress")}>
                ▶ In progress
              </button>
              <button type="button" role="radio" aria-checked={b.phase === "completed"} disabled={busy} onClick={() => setPhase("completed")}>
                ✓ Completed
              </button>
            </div>
            <label className="pay-status-pick">
              Payment
              <select aria-label="Payment status" className={`pay-status ${b.payment_status}`} value={b.payment_status} disabled={busy}
                onChange={(e) => run({ action: "payment", id: b.id, status: e.target.value as PaymentStatus })}>
                {PAYMENT_STATUSES.filter((st) => st.id !== "rejected" || b.payment_status === "rejected").map((st) => (
                  <option key={st.id} value={st.id} disabled={st.id === "rejected"}>{st.label}</option>
                ))}
              </select>
            </label>
            <button className="btn small secondary" disabled={busy} onClick={startEdit}>✎ Edit</button>
            <button className="btn small secondary danger-text" disabled={busy} onClick={cancel}>Cancel booking</button>
          </div>
        </>
      )}

      {released && (
        <div className="card-actions">
          <span style={{ fontSize: 14, fontWeight: 600 }}>Undo release:</span>
          <button className="btn small" disabled={busy} onClick={() => restore(null)}>↺ Restore</button>
          <button className="btn small secondary" disabled={busy} onClick={() => restore("in_progress")}>↺ Restore as In progress</button>
          <button className="btn small secondary" disabled={busy} onClick={() => restore("completed")}>↺ Restore as Completed</button>
        </div>
      )}
      {b.status === "cancelled" && (
        <div className="card-actions">
          <button className="btn small secondary danger-text" disabled={busy} onClick={remove}>Delete permanently</button>
        </div>
      )}
      <BookingHistory bookingId={b.id} onAuthError={onAuthError}
        version={[b.status, b.payment_status, b.phase, b.date, b.start_hour, b.end_hour, b.court_id, b.name, b.amount, b.payment_ref, b.rejected_at].join("|")} />
    </div>
  );
}

/** Staff: scan a player's booking QR (or type the code) to check it and confirm payment. */
export default function BookingLookup({
  onChanged,
  onOpenDate,
  onAuthError,
}: {
  onChanged: () => void; // reload the day's list
  onOpenDate: (date: string) => void;
  onAuthError: (e: unknown) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [b, setB] = useState<AdminBooking | null>(null);
  const [error, setError] = useState("");
  const [camera, setCamera] = useState(false);

  const lookup = useCallback(
    async (raw: string) => {
      if (!raw.trim()) return;
      setError("");
      try {
        setB(await api<AdminBooking>(`/api/admin/bookings?code=${encodeURIComponent(raw.trim())}`));
      } catch (e) {
        onAuthError(e);
        setB(null);
        setError(e instanceof Error ? e.message : "Lookup failed");
      }
      setCode("");
      input.current?.focus();
    },
    [onAuthError]
  );

  const fromCamera = useCallback((text: string) => {
    setCamera(false);
    lookup(text);
  }, [lookup]);

  return (
    <div className="card">
      <form onSubmit={(e) => { e.preventDefault(); lookup(code); }} className="lookup-bar">
        <input ref={input} type="text" autoComplete="off" spellCheck={false} aria-label="Booking code"
          placeholder="Scan booking QR or type code (NV-XXXXXX)" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn">Check</button>
        <button type="button" className="btn secondary" onClick={() => setCamera(true)}>📷 Camera</button>
      </form>
      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      {b && (
        <AdminBookingCard key={b.id + b.status + b.payment_status} b={b} onOpenDate={onOpenDate} onAuthError={onAuthError}
          onChanged={() => { onChanged(); lookup(b.code); }} />
      )}
      {camera && <QrScanner onCode={fromCamera} onClose={() => setCamera(false)} />}
    </div>
  );
}
