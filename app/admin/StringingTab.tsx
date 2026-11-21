"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import StringingForm, { type CheckInBody, type FormOptions } from "@/components/StringingForm";
import { formatDateLong } from "@/lib/format";
import { formatPeso, paymentLabel, paymentStatusLabel, type PaymentMethod } from "@/lib/pricing";
import {
  NEXT_ACTION,
  PRESTRETCH_OPTIONS,
  priceLines,
  readTag,
  racketStatusLabel,
  setupLabel,
  colorStock,
  daysText,
  stockLines,
  stringName,
  tagLabel,
  TENSION_PRESETS,
  type StringingPrices,
  type StringItem,
} from "@/lib/stringing";
import type { OrderDetail, QueueRacket, QueueTurnaround, QueueView, RacketRow, StringerReport, FeedbackRow, StockMove, TagRacket } from "@/lib/stringings";
import Receipt from "@/components/Receipt";
import { addDays } from "@/lib/time";
import { LabelPrintStatus, LabelPrinterButton } from "./LabelPrinter";
import { labelPrinterOn, printTagLabels } from "./p12";
import ProofViewer from "./ProofViewer";
import QrScanner from "./QrScanner";
import { useCanManage } from "./role";
import { api, todayManila } from "./shared";
import { confirmDialog, copyDialog, promptDialog } from "@/components/Dialogs";

// Admin → Stringing: the queue of rackets (to receive, waiting, stringing, ready, picked up), each
// check-in (payment, rackets, history, SMS texts), checking in for walk-ins, tags, strings and their
// stock, and for the owner/managers the prices, the stringer report and feedback. Stringers get the
// same queue with only start / done.

const VIEWS: { id: QueueView; label: string; stringer?: string }[] = [
  { id: "to_receive", label: "To receive" },
  { id: "waiting", label: "Waiting", stringer: "To string" },
  { id: "in_progress", label: "Stringing" },
  { id: "ready", label: "Ready", stringer: "Done" },
  { id: "picked_up", label: "Picked up" },
  { id: "cancelled", label: "Cancelled" },
];
const STRINGER_VIEWS: QueueView[] = ["waiting", "in_progress", "ready"];

/** The queue view last chosen on this device (staff and stringers separately), so a reload stays on it. */
const viewKey = (stringer: boolean) => `nvbc_stringing_view_${stringer ? "stringer" : "staff"}`;
function savedView(stringer: boolean): QueueView | null {
  try {
    const v = localStorage.getItem(viewKey(stringer)) as QueueView | null;
    return v && VIEWS.some((x) => x.id === v) && (!stringer || STRINGER_VIEWS.includes(v)) ? v : null;
  } catch {
    return null;
  }
}

type Sms = { mobile: string; ready: string; thanks: string };

/**
 * Racket tags ("ids=a,b" or "order=<id>"): on this device's label printer when that's on, otherwise
 * the A4 page in a new tab. Blank tags are always A4 (the number is written by hand).
 */
export function printTags(q: string) {
  if (q !== "blank=1" && labelPrinterOn()) {
    void printTagLabels(async () => (await api<{ rackets: TagRacket[] }>(`/api/admin/stringing?print=1&${q}`)).rackets);
    return;
  }
  window.open(`/admin/stringing/tags?${q}`, "_blank", "noopener");
}
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/** "Due today", "Due Fri, Nov 21", "2 days late". */
function dueText(due: string, today: string): { text: string; late: boolean } {
  if (due < today) {
    const d = Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);
    return { text: `${d} day${d === 1 ? "" : "s"} late`, late: true };
  }
  if (due === today) return { text: "Due today", late: false };
  if (due === addDays(today, 1)) return { text: "Due tomorrow", late: false };
  return { text: `Due ${new Date(due + "T00:00:00Z").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}`, late: false };
}

const payChip = (r: Pick<QueueRacket, "payment_status" | "balance">) =>
  r.payment_status === "for_verification" ? <span className="badge pending">💸 Check payment</span>
  : r.balance <= 0 ? <span className="badge">✓ Paid</span>
  : <span className="badge grey">Not paid</span>;

type QueueData = { rackets: QueueRacket[]; counts: Record<QueueView, number>; tagQr: boolean; turnaround: QueueTurnaround };

export default function StringingTab({
  onAuthError,
  stringer = false,
  strings = true,
  me,
  openTag,
}: {
  onAuthError: (e: unknown) => void;
  stringer?: boolean;
  /** May start and finish stringing (not a Scholar who only does the desk side). */
  strings?: boolean;
  me: string; // the logged-in person's name
  openTag?: number | null; // from a scanned tag (/admin?tag=127)
}) {
  const manage = useCanManage() && !stringer;
  const [page, setPage] = useState<"queue" | "checkin" | "strings" | "report">("queue");
  const [view, setViewState] = useState<QueueView>(() => savedView(stringer) ?? (stringer ? "waiting" : "to_receive"));
  const setView = useCallback((v: QueueView) => {
    setViewState(v);
    try { localStorage.setItem(viewKey(stringer), v); } catch { /* private mode: fine */ }
  }, [stringer]);
  const [smsFor, setSmsFor] = useState<QueueRacket | null>(null);
  const [q, setQ] = useState(stringer && openTag ? String(openTag) : "");
  const [data, setData] = useState<QueueData | null>(null);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");

  // Only the newest request may fill the list, so a slow answer for the view we just left can't
  // overwrite the one we moved to.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const n = ++latest.current;
    try {
      const d = await api<QueueData>(`/api/admin/stringing?view=${view}&q=${encodeURIComponent(q.trim())}`);
      if (n !== latest.current) return;
      setData(d);
      setError("");
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't load the stringing queue.");
    }
  }, [view, q, onAuthError]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  // Keep it current while it's on screen: when the tab comes back, and every 45 seconds.
  useEffect(() => {
    const onShow = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onShow);
    const t = setInterval(() => document.visibilityState === "visible" && load(), 45_000);
    return () => { document.removeEventListener("visibilitychange", onShow); clearInterval(t); };
  }, [load]);

  // A scanned tag: open its check-in (staff) or find it (stringers).
  const openByTag = useCallback(async (tag: number) => {
    if (stringer) return setQ(String(tag));
    try {
      const r = await api<{ orderId: string }>(`/api/admin/stringing?tag=${tag}`);
      setOpenOrder(r.orderId);
    } catch (e) {
      setError(e instanceof Error ? e.message : `No racket with tag ${tagLabel(tag)}.`);
    }
  }, [stringer]);
  useEffect(() => {
    if (openTag && !stringer) openByTag(openTag);
  }, [openTag, stringer, openByTag]);

  async function step(r: QueueRacket, action: "start" | "done" | "pickup" | "undo") {
    if (action === "pickup" && r.balance > 0 && !(await confirmDialog(`${tagLabel(r.tag)}: ${formatPeso(r.balance)} is still unpaid. Collect it, then mark it picked up?`))) return;
    if (action === "undo" && !(await confirmDialog(`Undo the last step for ${tagLabel(r.tag)}?`, { confirmLabel: "Undo" }))) return;
    setBusy(r.id);
    setNote("");
    try {
      await api("/api/admin/stringing", { action: "step", ids: [r.id], step: action });
      // Follow the racket to where it went (and stay there after a reload).
      const to = q ? null : action === "start" ? "in_progress" : action === "done" ? "ready" : null;
      if (to && to !== view) setView(to); // the new view loads itself
      setNote(
        action === "start" ? `${tagLabel(r.tag)} — stringing started.`
        : action === "done" ? `${tagLabel(r.tag)} is ready — the customer has been told.`
        : action === "pickup" ? `${tagLabel(r.tag)} picked up.`
        : `${tagLabel(r.tag)} moved back a step.`
      );
      if (!to || to === view) await load();
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy("");
    }
  }

  async function remark(r: QueueRacket) {
    const text = await editRemarks(tagLabel(r.tag), r.remarks);
    if (text === null) return;
    setBusy(r.id);
    setNote("");
    try {
      await api("/api/admin/stringing", { action: "remarks", id: r.id, remarks: text });
      setNote(text ? `${tagLabel(r.tag)} — remarks saved.` : `${tagLabel(r.tag)} — remarks removed.`);
      await load();
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy("");
    }
  }

  if (page === "checkin") return <CheckInPage me={me} tagQr={!!data?.tagQr} onAuthError={onAuthError} onCancel={() => setPage("queue")} onDone={(id) => { setPage("queue"); setView("waiting"); setOpenOrder(id); }} />;
  if (page === "strings") return <StringsPage manage={manage} onAuthError={onAuthError} onBack={() => setPage("queue")} />;
  if (page === "report") return <ReportPage onAuthError={onAuthError} onBack={() => setPage("queue")} />;

  const today = todayManila();
  const views = VIEWS.filter((v) => !stringer || STRINGER_VIEWS.includes(v.id));
  const rows = data?.rackets ?? [];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="stack">
      <div className="voucher-toolbar">
        <input type="search" placeholder={stringer ? "Tag number, e.g. 127" : "Tag number, name, mobile or racket"} aria-label="Search rackets"
          inputMode={stringer ? "numeric" : undefined} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn secondary" onClick={() => setScanning(true)}>📷 Scan tag</button>
        {!stringer && <button type="button" className="btn" onClick={() => setPage("checkin")}>+ Check in rackets</button>}
      </div>
      {!stringer && (
        <div className="actions start">
          <button type="button" className="btn small secondary" onClick={() => printTags("blank=1")}>🖨 Blank tags</button>
          <button type="button" className="btn small secondary" onClick={() => setPage("strings")}>🧵 Strings &amp; stock</button>
          {manage && <button type="button" className="btn small secondary" onClick={() => setPage("report")}>📊 Stringer report</button>}
          <a className="btn small secondary" href="/string" target="_blank" rel="noopener">🔗 Customer page</a>
          <LabelPrinterButton tagQr={!!data?.tagQr} />
        </div>
      )}
      <LabelPrintStatus />
      {!stringer && data && (
        <TurnaroundBar t={data.turnaround} queued={data.counts.to_receive + data.counts.waiting + data.counts.in_progress}
          onAuthError={onAuthError} onSaved={load} />
      )}
      {scanning && (
        <QrScanner onClose={() => setScanning(false)} onCode={(t) => {
          setScanning(false);
          const tag = readTag(t);
          if (tag === null) return setError("That QR code isn't an NVBC stringing tag.");
          openByTag(tag);
        }} />
      )}
      {!q && (
        <div className="segmented sf-views" role="radiogroup" aria-label="Show">
          {views.map((v) => (
            <button key={v.id} type="button" role="radio" aria-checked={view === v.id} onClick={() => { setView(v.id); setSelected(new Set()); }}>
              {stringer ? v.stringer ?? v.label : v.label}
              <small>{data?.counts[v.id] ?? 0}</small>
            </button>
          ))}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {note && <div className="success">{note}</div>}
      {selected.size > 0 && (
        <div className="notice info voucher-selbar">
          <strong>{selected.size} selected</strong>
          <button type="button" className="btn small" onClick={() => printTags(`ids=${[...selected].join(",")}`)}>🖨 Print tags</button>
          <button type="button" className="btn small secondary" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          {q ? "No rackets match." : view === "to_receive" ? "No rackets waiting to be received. Customers check in at /string (the QR code at the desk)."
            : view === "waiting" ? "Nothing waiting to be strung." : view === "in_progress" ? "Nothing being strung right now." : "Nothing here."}
        </p>
      ) : (
        <div className="sf-queue">
          {rows.map((r) => {
            const due = dueText(r.due_on, today);
            const next = NEXT_ACTION[r.status];
            const stringing = next?.action === "start" || next?.action === "done";
            const canNext = next && (stringer ? stringing : strings || !stringing);
            return (
              <div key={r.id} className={`sf-row${r.rush ? " rush" : ""}${r.status === "cancelled" ? " cancelled" : ""}`}>
                {!stringer && (
                  <input type="checkbox" aria-label={`Select ${tagLabel(r.tag)}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                )}
                <button type="button" className="sf-row-main" onClick={() => !stringer && setOpenOrder(r.order_id)} disabled={stringer}>
                  <span className="sf-tag">{tagLabel(r.tag)}</span>
                  <span className="sf-row-text">
                    <strong>{r.racket}</strong>
                    <span>{r.string_name}{r.string_color ? ` (${r.string_color})` : ""}{r.own_string ? " · own string" : ""} · <strong>{setupLabel(Number(r.tension_main), Number(r.tension_cross), r.prestretch)}</strong></span>
                    <span className="hint">
                      {r.name}{r.order_rackets > 1 ? ` · 1 of ${r.order_rackets} rackets` : ""}
                      {(r.grommets_single + r.grommets_double) > 0 && ` · grommets: ${r.grommets_single} single, ${r.grommets_double} double`}
                      {r.notes && ` · “${r.notes}”`}
                    </span>
                    {r.remarks && <span className="sf-row-remarks">📝 {r.remarks}</span>}
                    <span className="sf-row-chips">
                      {r.rush && <span className="badge pending">⚡ RUSH</span>}
                      {r.status !== "picked_up" && r.status !== "cancelled" && <span className={`badge ${due.late ? "danger" : "grey"}`}>{due.text}</span>}
                      {!stringer && payChip(r)}
                      {r.status === "checked_in" && <span className="hint">checked in {when(r.created_at)}</span>}
                      {r.status === "in_progress" && <span className="hint">by {r.started_by} · {when(r.started_at)}</span>}
                      {r.status === "done" && <span className="hint">done by {r.done_by} · {when(r.done_at)}</span>}
                      {r.status === "picked_up" && <span className="hint">released by {r.picked_up_by} · {when(r.picked_up_at)}</span>}
                    </span>
                  </span>
                </button>
                <span className="sf-row-actions">
                  {canNext && next.action !== "receive" && (
                    <button type="button" className="btn" disabled={busy === r.id} onClick={() => step(r, next.action as "start" | "done" | "pickup")}>
                      {next.action === "start" ? "▶ Start" : next.action === "done" ? "✓ Done" : "Picked up"}
                    </button>
                  )}
                  {!stringer && r.status === "done" && (
                    <button type="button" className="btn secondary" onClick={() => setSmsFor(r)}>💬 SMS</button>
                  )}
                  {next?.action === "receive" && !stringer && (
                    <button type="button" className="btn" onClick={() => setOpenOrder(r.order_id)}>Receive</button>
                  )}
                  {r.status !== "cancelled" && (
                    <button type="button" className="link-btn" disabled={busy === r.id} onClick={() => remark(r)}>📝 {r.remarks ? "Edit remarks" : "Remarks"}</button>
                  )}
                  {(stringer ? r.status === "in_progress" || r.status === "done"
                    : r.status !== "checked_in" && r.status !== "cancelled" && (strings || (r.status !== "in_progress" && r.status !== "done"))) && (
                    <button type="button" className="link-btn" disabled={busy === r.id} onClick={() => step(r, "undo")}>Undo</button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {smsFor && <SmsModal orderId={smsFor.order_id} name={smsFor.name} onAuthError={onAuthError} onClose={() => setSmsFor(null)} />}
      {openOrder && (
        <OrderModal id={openOrder} me={me} strings={strings} tagQr={!!data?.tagQr} onAuthError={onAuthError} onClose={() => { setOpenOrder(null); load(); }} />
      )}
    </div>
  );
}

/** Asks for a racket's remarks (null: cancelled; "" removes them). */
// ---- The turnaround customers see, changed at the desk as the queue grows or shrinks ------------

function TurnaroundBar({ t, queued, onAuthError, onSaved }: {
  t: QueueTurnaround; queued: number; onAuthError: (e: unknown) => void; onSaved: () => Promise<void>;
}) {
  const [v, setV] = useState<string[] | null>(null); // standard from, to, rush from, to, while editing
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const edit = () => {
    setV([...t.standardDays, ...t.rushDays].map(String));
    setError("");
    setSaved(false);
  };
  // Busier or quieter: move every number by a day (not below 0).
  const shift = (d: number) => setV((x) => x && x.map((n) => String(Math.max(0, (Number(n) || 0) + d))));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!v) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/stringing", { action: "turnaround", standardDays: v.slice(0, 2), rushDays: v.slice(2) });
      await onSaved();
      setV(null);
      setSaved(true);
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Couldn't save the turnaround.");
    } finally {
      setBusy(false);
    }
  }
  const num = (i: number, label: string) => (
    <input type="number" inputMode="numeric" min={0} max={60} step={1} required aria-label={label} value={v?.[i] ?? ""}
      onChange={(e) => setV((x) => x && x.map((n, j) => (j === i ? e.target.value : n)))} />
  );
  const changed = t.turnaroundChanged;

  if (!v)
    return (
      <div className="sf-turnaround">
        <div className="sf-ta-now">
          <span className="sf-ta-title">⏱ Turnaround</span>
          <span><span className="muted">Standard</span> <strong>{daysText(t.standardDays)}</strong></span>
          <span><span className="muted">⚡ Rush</span> <strong>{daysText(t.rushDays)}</strong></span>
          <button type="button" className="btn small secondary" onClick={edit}>Change</button>
        </div>
        <p className="hint">
          {saved ? "Saved. New check-ins use it now. " : ""}
          {queued} racket{queued === 1 ? "" : "s"} in the queue
          {changed ? ` · changed by ${changed.by}, ${when(changed.at)}` : ""}
        </p>
      </div>
    );
  return (
    <form className="sf-turnaround editing" onSubmit={save}>
      <strong>⏱ Change the turnaround</strong>
      <p className="hint">
        {queued} racket{queued === 1 ? "" : "s"} in the queue. Customers see this on the check-in page, and the first number is
        the earliest collection date they can choose. Rackets already checked in keep their date.
      </p>
      <div className="sf-ta-fields">
        <div>
          <label>Standard (days)</label>
          <div className="sf-custom">{num(0, "Standard: from")}<span>to</span>{num(1, "Standard: to")}</div>
        </div>
        <div>
          <label>⚡ Rush (days)</label>
          <div className="sf-custom">{num(2, "Rush: from")}<span>to</span>{num(3, "Rush: to")}</div>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="sf-ta-actions">
        <div>
          <button type="button" className="btn small secondary" onClick={() => shift(-1)}>− 1 day</button>
          <button type="button" className="btn small secondary" onClick={() => shift(1)}>+ 1 day</button>
        </div>
        <div>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => setV(null)}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </form>
  );
}

function editRemarks(tag: string, current: string): Promise<string | null> {
  return promptDialog("What did you notice about this racket? The customer sees this on their racket's page.", {
    title: `Remarks on ${tag}`,
    defaultValue: current,
    placeholder: "e.g. Slight crack near the throat. Loose grip.",
    multiline: true,
    maxLength: 500,
    confirmLabel: "Save",
  }).then((t) => (t === null || t.trim() === current.trim() ? null : t.trim()));
}

// ---- Checking in a walk-in ----------------------------------------------------------------------

function CheckInPage({ me, tagQr, onAuthError, onCancel, onDone }: {
  me: string; tagQr: boolean; onAuthError: (e: unknown) => void; onCancel: () => void; onDone: (id: string) => void;
}) {
  const [options, setOptions] = useState<FormOptions | null>(null);
  useEffect(() => {
    fetch("/api/stringing", { cache: "no-store" }).then((r) => r.json()).then(setOptions).catch(() => {});
  }, []);
  async function submit(b: CheckInBody) {
    try {
      const r = await api<{ id: string; tags: number[] }>("/api/admin/stringing", { action: "create", ...b });
      // With QR tags (a label printer), offer to print them; otherwise the number is written on a blank tag.
      if (b.receive && tagQr && (await confirmDialog(`Checked in ${r.tags.map(tagLabel).join(", ")}. Print the tag${r.tags.length === 1 ? "" : "s"} now?`, { confirmLabel: "Print", cancelLabel: "Not now" })))
        printTags(`order=${r.id}`);
      onDone(r.id);
    } catch (e) {
      onAuthError(e);
      throw e;
    }
  }
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div><button type="button" className="link-btn" onClick={onCancel}>← Stringing queue</button></div>
      <h2>Check in rackets</h2>
      <p className="hint">For customers without data. Type their mobile number first: returning customers&apos; names and rackets fill in.</p>
      {options ? <StringingForm options={options} staffName={me} onSubmit={submit} /> : <p className="muted">Loading…</p>}
    </div>
  );
}

// ---- SMS texts ----------------------------------------------------------------------------------

/** The "ready" and "thank you" texts, to copy or open in Messages and send from the desk phone. */
function SmsPanel({ sms }: { sms: Sms }) {
  const [copied, setCopied] = useState("");
  async function copy(label: string, t: string) {
    try { await navigator.clipboard.writeText(t); setCopied(label); } catch { void copyDialog("Copy this message:", t); }
  }
  return (
    <div className="card stack sf-sms">
      {([["ready", "Ready for pickup", sms.ready], ["thanks", "Thank you + feedback", sms.thanks]] as const).map(([k, label, t]) => (
        <div key={k}>
          <strong>{label}</strong>
          <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{t}</p>
          <div className="actions start" style={{ marginTop: 10 }}>
            <button type="button" className="btn small" onClick={() => copy(k, t)}>{copied === k ? "✓ Copied" : "📋 Copy"}</button>
            <a className="btn small secondary" href={`sms:${sms.mobile}?body=${encodeURIComponent(t)}`}>Open in Messages</a>
          </div>
        </div>
      ))}
    </div>
  );
}

/** From the queue (a racket that's ready): just the SMS texts for that customer. */
function SmsModal({ orderId, name, onAuthError, onClose }: { orderId: string; name: string; onAuthError: (e: unknown) => void; onClose: () => void }) {
  const [sms, setSms] = useState<Sms | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Sms>("/api/admin/stringing", { action: "sms", id: orderId }).then(setSms).catch((e) => {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't load the texts.");
    });
  }, [orderId, onAuthError]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="card modal stack" role="dialog" aria-modal="true" aria-label={`Text ${name}`} onClick={(e) => e.stopPropagation()}>
        <div className="sf-modal-head">
          <div>
            <h2 style={{ margin: 0 }}>💬 Text {name}</h2>
            {sms && <div className="muted"><a href={`tel:${sms.mobile}`}>{sms.mobile}</a></div>}
          </div>
          <button type="button" className="btn small secondary" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {error ? <div className="error">{error}</div> : sms ? <SmsPanel sms={sms} /> : <p className="muted">Loading…</p>}
      </div>
    </div>
  );
}

// ---- One check-in -------------------------------------------------------------------------------

function OrderModal({ id, me, strings, tagQr, onAuthError, onClose }: { id: string; me: string; strings: boolean; tagQr: boolean; onAuthError: (e: unknown) => void; onClose: () => void }) {
  const manage = useCanManage();
  const [d, setD] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // racket id, or "customer"
  const [receivePaid, setReceivePaid] = useState<PaymentMethod | "">("");
  const [receiveIds, setReceiveIds] = useState<Set<string>>(new Set());
  const [sms, setSms] = useState<Sms | null>(null);

  const load = useCallback(async () => {
    try {
      const x = await api<OrderDetail>(`/api/admin/stringing?order=${id}`);
      setD(x);
      setReceiveIds(new Set(x.rackets.filter((r) => r.status === "checked_in").map((r) => r.id)));
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't load the check-in.");
    }
  }, [id, onAuthError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await api("/api/admin/stringing", body);
      setNote(done);
      setEditing(null);
      setSms(null);
      await load();
      return true;
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const step = (ids: string[], s: string, done: string, extra: Record<string, unknown> = {}) => run({ action: "step", ids, step: s, ...extra }, done);

  const o = d?.order;
  const toReceive = d?.rackets.filter((r) => r.status === "checked_in") ?? [];
  const live = d?.rackets.filter((r) => r.status !== "cancelled") ?? [];

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="card modal staff-modal sf-modal" role="dialog" aria-modal="true" aria-label="Stringing check-in" onClick={(e) => e.stopPropagation()}>
        {!d || !o ? (
          error ? <div className="error">{error}</div> : <p className="muted">Loading…</p>
        ) : (
          <div className="stack">
            <div className="sf-modal-head">
              <div>
                <h2 style={{ margin: 0 }}>{o.name}</h2>
                <div className="muted">
                  <a href={`tel:${o.mobile}`}>{o.mobile}</a>{o.email && <> · {o.email}</>} · checked in {when(o.created_at)}{o.created_by ? ` by ${o.created_by}` : " (by the customer)"}
                </div>
              </div>
              <button type="button" className="btn small secondary" onClick={onClose} aria-label="Close">✕</button>
            </div>
            {error && <div className="error">{error}</div>}
            {note && <div className="success">{note}</div>}

            {editing === "customer" ? (
              <CustomerEdit o={o} busy={busy} onCancel={() => setEditing(null)}
                onSave={(v) => run({ action: "customer", id, ...v }, "Customer details saved.")} />
            ) : (
              <div className="actions start">
                <button type="button" className="btn small secondary" onClick={() => setEditing("customer")}>✎ Edit customer</button>
                {live.length > 0 && <button type="button" className="btn small secondary" onClick={() => printTags(`order=${id}`)}>🖨 Print tags</button>}
                <button type="button" className="btn small secondary" onClick={async () => {
                  try { setSms(await api(`/api/admin/stringing`, { action: "sms", id })); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load."); }
                }}>💬 SMS texts</button>
                <a className="btn small secondary" href={`/string/${o.token}`} target="_blank" rel="noopener">Customer&apos;s page</a>
              </div>
            )}
            {sms && <SmsPanel sms={sms} />}

            {toReceive.length > 0 && (
              <fieldset className="sf-receive">
                <legend>📥 Receive at the desk</legend>
                {toReceive.length > 1 && (
                  <div className="court-checks">
                    {toReceive.map((r) => (
                      <label key={r.id}>
                        <input type="checkbox" checked={receiveIds.has(r.id)} onChange={() => setReceiveIds((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                        {tagLabel(r.tag)} {r.racket}
                      </label>
                    ))}
                  </div>
                )}
                <div className="sf-write-tags">
                  <span className="hint">Write on {toReceive.length === 1 ? "the tag" : "each tag"}:</span>
                  <span className="sf-chips">
                    {toReceive.filter((r) => receiveIds.has(r.id)).map((r) => <span key={r.id} className="sf-tag">{tagLabel(r.tag)}{r.rush ? " ⚡" : ""}</span>)}
                  </span>
                  <span className="hint">and tick Paid or Not yet paid{toReceive.some((r) => r.rush) ? ", and Rush" : ""}.</span>
                </div>
                <div className="row field">
                  <div>
                    <label>Received by</label>
                    <p className="sf-locked">🔒 {me} <span className="hint">· {when(new Date().toISOString())}</span></p>
                  </div>
                  <div>
                    <label htmlFor="sf-rp">Payment</label>
                    {o.balance <= 0 ? (
                      <input id="sf-rp" disabled value="✓ Paid" />
                    ) : (
                      <select id="sf-rp" value={receivePaid} onChange={(e) => setReceivePaid(e.target.value as PaymentMethod | "")}>
                        <option value="">{o.payment_status === "for_verification" ? "Online — check it below" : "Not paid yet"}</option>
                        <option value="cash">Paid now — Cash {formatPeso(o.balance)}</option>
                      </select>
                    )}
                  </div>
                </div>
                <div className="actions">
                  <button type="button" className="btn" disabled={busy || !receiveIds.size} onClick={async () => {
                    const ids = [...receiveIds];
                    if (await step(ids, "receive", `Received ${toReceive.filter((r) => receiveIds.has(r.id)).map((r) => tagLabel(r.tag)).join(", ")}.`, { paidMethod: receivePaid || null }) && tagQr)
                      printTags(`ids=${ids.join(",")}`);
                  }}>{tagQr ? `Receive ${receiveIds.size > 1 ? `${receiveIds.size} rackets ` : ""}& print tag${receiveIds.size > 1 ? "s" : ""}` : `✓ Receive${receiveIds.size > 1 ? ` ${receiveIds.size} rackets` : ""}`}</button>
                </div>
              </fieldset>
            )}

            <PaymentSection d={d} busy={busy} onRun={run} />

            <section className="stack">
              <h3>Rackets</h3>
              {d.rackets.map((r) => editing === r.id ? (
                <RacketEdit key={r.id} r={r} busy={busy} onAuthError={onAuthError} onCancel={() => setEditing(null)}
                  onSave={(v) => run({ action: "edit", id: r.id, ...v }, `${tagLabel(r.tag)} updated.`)} />
              ) : (
                <div key={r.id} className={`sf-racket-card${r.status === "cancelled" ? " cancelled" : ""}`}>
                  <span className="sf-tag">{tagLabel(r.tag)}</span>
                  <div className="sf-row-text">
                    <span><strong>{r.racket}</strong> <span className="badge grey">{racketStatusLabel(r.status)}</span>{r.rush && <> <span className="badge pending">⚡ RUSH</span></>}</span>
                    <span>{r.string_name}{r.string_color ? ` (${r.string_color})` : ""}{r.own_string ? " · own string" : ""} · {setupLabel(Number(r.tension_main), Number(r.tension_cross), r.prestretch)} · collect {formatDateLong(r.due_on)}</span>
                    {(r.grommets_single + r.grommets_double) > 0 && <span className="hint">Grommets: {r.grommets_single} single, {r.grommets_double} double</span>}
                    {r.notes && <span className="hint">Notes: {r.notes}</span>}
                    {r.remarks && <span className="sf-row-remarks">📝 {r.remarks}</span>}
                    <Receipt className="small" total={Number(r.total)} lines={priceLines(
                      { labor: Number(r.labor_fee), rush: Number(r.rush_fee), string: Number(r.string_price), grommets: Number(r.grommet_fee) },
                      r.grommets_single + r.grommets_double)} />
                    <span className="hint">
                      {[r.received_at && `Received by ${r.received_by}, ${when(r.received_at)}`, r.started_at && `started by ${r.started_by}, ${when(r.started_at)}`,
                        r.done_at && `done by ${r.done_by}, ${when(r.done_at)}`, r.picked_up_at && `picked up, released by ${r.picked_up_by}, ${when(r.picked_up_at)}`,
                        r.cancelled_at && `cancelled by ${r.cancelled_by}, ${when(r.cancelled_at)}`].filter(Boolean).join(" · ")}
                    </span>
                    <div className="actions start" style={{ marginTop: 10 }}>
                      {strings && r.status === "received" && <button type="button" className="btn small" disabled={busy} onClick={() => step([r.id], "start", `${tagLabel(r.tag)} — stringing started.`)}>▶ Start</button>}
                      {strings && (r.status === "received" || r.status === "in_progress") && <button type="button" className="btn small" disabled={busy} onClick={() => step([r.id], "done", `${tagLabel(r.tag)} is ready — the customer has been told.`)}>✓ Done</button>}
                      {r.status === "done" && <button type="button" className="btn small" disabled={busy} onClick={async () => {
                        if (o.balance > 0 && !(await confirmDialog(`${formatPeso(o.balance)} is still unpaid. Collect it, then mark ${tagLabel(r.tag)} picked up?`))) return;
                        step([r.id], "pickup", `${tagLabel(r.tag)} picked up.`);
                      }}>Picked up</button>}
                      {r.status !== "picked_up" && r.status !== "cancelled" && <button type="button" className="btn small secondary" onClick={() => setEditing(r.id)}>✎ Edit</button>}
                      {r.status !== "cancelled" && <button type="button" className="btn small secondary" disabled={busy} onClick={async () => {
                        const text = await editRemarks(tagLabel(r.tag), r.remarks);
                        if (text !== null) run({ action: "remarks", id: r.id, remarks: text }, text ? `${tagLabel(r.tag)} — remarks saved.` : `${tagLabel(r.tag)} — remarks removed.`);
                      }}>📝 Remarks</button>}
                      {r.status !== "checked_in" && (strings || (r.status !== "in_progress" && r.status !== "done")) && <button type="button" className="btn small secondary" disabled={busy} onClick={async () => (await confirmDialog(`Undo the last step for ${tagLabel(r.tag)}?`, { confirmLabel: "Undo" })) && step([r.id], "undo", `${tagLabel(r.tag)} moved back a step.`)}>↩ Undo</button>}
                      {r.status !== "picked_up" && r.status !== "cancelled" && <button type="button" className="btn small secondary danger-text" disabled={busy} onClick={async () => (await confirmDialog(`Cancel ${tagLabel(r.tag)}? It comes off the total.`, { confirmLabel: "Yes, cancel", cancelLabel: "Keep", danger: true })) && step([r.id], "cancel", `${tagLabel(r.tag)} cancelled.`)}>Cancel</button>}
                    </div>
                  </div>
                </div>
              ))}
            </section>

            {o.feedback_rating && (
              <div className="card">
                <strong>Feedback: {"★".repeat(o.feedback_rating)}{"☆".repeat(5 - o.feedback_rating)}</strong>
                {o.feedback_comment && <p style={{ margin: "4px 0 0" }}>“{o.feedback_comment}”</p>}
              </div>
            )}

            <section className="stack">
              <h3>History</h3>
              <ul className="voucher-history">
                {d.events.map((e, i) => (
                  <li key={i}><span className="muted">{when(e.at)}</span> <strong>{e.action}</strong> by {e.actor}{e.details ? ` — ${e.details}` : ""}</li>
                ))}
              </ul>
            </section>
            {manage && (
              <button type="button" className="link-btn danger-text" disabled={busy} onClick={async () => {
                if (!(await confirmDialog(`Delete this check-in for ${o.name} (${d.rackets.map((r) => tagLabel(r.tag)).join(", ")}) for good? Only for check-ins made by mistake.`, { confirmLabel: "Delete", danger: true }))) return;
                if (await run({ action: "delete", id }, "Deleted.")) onClose();
              }}>Delete this check-in</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The check-in's payment: what's due, the customer's online payment to check, and setting it. */
function PaymentSection({ d, busy, onRun }: { d: OrderDetail; busy: boolean; onRun: (b: Record<string, unknown>, done: string) => Promise<boolean> }) {
  const o = d.order;
  const id = o.id;
  const [method, setMethod] = useState<PaymentMethod>(o.payment_method);
  const status = o.payment_status;
  const sent = status === "for_verification";
  return (
    <fieldset className="sf-pay">
      <legend>💸 Payment</legend>
      <div className="pay-row">
        <span>Total {formatPeso(Number(o.total))} · <strong>{paymentStatusLabel(status)}</strong>{status === "paid" ? ` (${paymentLabel(o.payment_method)}${o.paid_by ? `, ${o.paid_by}` : ""})` : ""}</span>
        <strong>{o.balance > 0 ? `${formatPeso(o.balance)} to pay` : "Nothing to pay"}</strong>
      </div>
      {status === "rejected" && o.rejected_note && <p className="hint">Rejected: {o.rejected_note}</p>}
      {(sent || o.payment_ref || o.has_proof) && status !== "paid" && (
        <div className="sf-proof">
          <span>{paymentLabel(o.payment_method)}{o.payment_ref && <> · ref <strong className="mono">{o.payment_ref}</strong></>}
            {o.paid_amount_reported !== null && <> · says they sent <strong>{formatPeso(Number(o.paid_amount_reported))}</strong>
              {Math.abs(Number(o.paid_amount_reported) - o.balance) >= 0.01 && <span className="badge danger">≠ {formatPeso(o.balance)}</span>}</>}
            {o.payment_sent_at && <span className="hint"> · sent {when(o.payment_sent_at)}</span>}
          </span>
          {o.has_proof && <ProofViewer src={`/api/admin/stringing?proof=${id}`} alt={`${o.name}'s payment screenshot`} className="link-btn">📷 Screenshot</ProofViewer>}
        </div>
      )}
      {d.reuse.length > 0 && (
        <div className="notice">
          ⚠ {d.reuse.some((x) => x.same_proof) ? "This screenshot" : "This reference number"} was also sent for:{" "}
          {d.reuse.map((x, i) => (
            <span key={i}>{i ? "; " : ""}{x.kind === "booking" ? `booking ${x.code}` : `stringing ${x.code}`} ({x.name}, {x.date}, {x.status})</span>
          ))}. Check carefully — it may be reused.
        </div>
      )}
      <div className="actions start">
        {status !== "paid" && (
          <>
            <select aria-label="Paid by" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} style={{ width: "auto" }}>
              {(["cash", "gcash", "qrph", "bpi"] as PaymentMethod[]).map((m) => <option key={m} value={m}>{paymentLabel(m)}</option>)}
            </select>
            <button type="button" className="btn small" disabled={busy} onClick={() => onRun({ action: "payment", id, status: "paid", method }, "Payment confirmed.")}>
              {sent ? "✓ Confirm paid" : "✓ Mark paid"}
            </button>
          </>
        )}
        {sent && (
          <button type="button" className="btn small secondary danger-text" disabled={busy} onClick={async () => {
            const note = await promptDialog("Why can't it be confirmed? The customer sees this.", {
              title: "Reject the payment?", placeholder: "e.g. No payment with that reference number", required: true, multiline: true,
              maxLength: 300, confirmLabel: "Reject", danger: true,
            });
            if (note) onRun({ action: "payment", id, status: "rejected", note }, "Payment rejected — the customer has been told.");
          }}>Reject</button>
        )}
        {(status === "paid" || status === "waived") && (
          <button type="button" className="btn small secondary" disabled={busy} onClick={async () => (await confirmDialog("Set this back to not paid?")) && onRun({ action: "payment", id, status: "unpaid" }, "Set to not paid.")}>Set not paid</button>
        )}
        {status !== "waived" && status !== "paid" && (
          <button type="button" className="btn small secondary" disabled={busy} onClick={async () => (await confirmDialog("No charge for this check-in?")) && onRun({ action: "payment", id, status: "waived" }, "No charge.")}>No charge</button>
        )}
      </div>
    </fieldset>
  );
}

function CustomerEdit({ o, busy, onSave, onCancel }: { o: OrderDetail["order"]; busy: boolean; onSave: (v: Record<string, string>) => void; onCancel: () => void }) {
  const [v, setV] = useState({ name: o.name, mobile: o.mobile, email: o.email });
  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <div className="row field">
        <div><label htmlFor="ce-n">Name</label><input id="ce-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <div><label htmlFor="ce-m">Mobile</label><input id="ce-m" type="tel" value={v.mobile} onChange={(e) => setV({ ...v, mobile: e.target.value })} /></div>
      </div>
      <div className="field"><label htmlFor="ce-e">Email</label><input id="ce-e" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
      <div className="actions">
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={busy}>Save</button>
      </div>
    </form>
  );
}

/** Correcting a racket: everything from the check-in form (the price is worked out again). */
function RacketEdit({ r, busy, onAuthError, onSave, onCancel }: {
  r: RacketRow; busy: boolean; onAuthError: (e: unknown) => void; onSave: (v: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const [strings, setStrings] = useState<StringItem[]>([]);
  const [v, setV] = useState({
    racket: r.racket, ownString: r.own_string, stringId: r.string_id ? String(r.string_id) : "", stringColor: r.string_color,
    ownStringName: r.own_string ? r.string_name : "", tensionMain: String(Number(r.tension_main)), tensionCross: String(Number(r.tension_cross)),
    rush: r.rush, dueOn: r.due_on, grommetsSingle: String(r.grommets_single), grommetsDouble: String(r.grommets_double), notes: r.notes,
    prestretch: r.prestretch ? String(r.prestretch) : "",
  });
  useEffect(() => {
    api<{ strings: StringItem[] }>("/api/admin/stringing?strings=1").then((x) => setStrings(x.strings)).catch(onAuthError);
  }, [onAuthError]);
  const s = strings.find((x) => String(x.id) === v.stringId);
  // The colour the box shows (its first colour when the saved one isn't on the list), which is what's saved.
  const color = s && s.colors.includes(v.stringColor) ? v.stringColor : s?.colors[0] ?? "";
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  return (
    <form className="card stack" onSubmit={(e) => {
      e.preventDefault();
      onSave({ ...v, stringId: v.ownString ? null : Number(v.stringId), stringColor: v.ownString ? "" : color });
    }}>
      <strong>Edit {tagLabel(r.tag)}</strong>
      <div className="field"><label htmlFor="re-r">Racket</label><input id="re-r" value={v.racket} onChange={(e) => set({ racket: e.target.value })} /></div>
      <label className="check-row"><input type="checkbox" checked={v.ownString} onChange={(e) => set({ ownString: e.target.checked })} /> Customer&apos;s own string</label>
      {v.ownString ? (
        <div className="field"><label htmlFor="re-os">String</label><input id="re-os" value={v.ownStringName} onChange={(e) => set({ ownStringName: e.target.value })} /></div>
      ) : (
        <div className="row field">
          <div>
            <label htmlFor="re-s">String</label>
            <select id="re-s" value={v.stringId} onChange={(e) => { const n = strings.find((x) => String(x.id) === e.target.value); set({ stringId: e.target.value, stringColor: n?.colors.includes(v.stringColor) ? v.stringColor : n?.colors[0] ?? "" }); }}>
              <option value="">Choose…</option>
              {strings.filter((x) => x.active || String(x.id) === v.stringId).map((x) => <option key={x.id} value={x.id}>{stringName(x)} — {formatPeso(x.price)} · {x.stock} in stock</option>)}
            </select>
          </div>
          {s && s.colors.length > 0 && (
            <div>
              <label htmlFor="re-c">Colour</label>
              <select id="re-c" value={color} onChange={(e) => set({ stringColor: e.target.value })}>
                {s.colors.map((c) => <option key={c} value={c}>{c} · {colorStock(s, c)} in stock</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      <div className="row field">
        <div>
          <label htmlFor="re-tm">Tension mains (lbs)</label>
          <input id="re-tm" inputMode="decimal" list="re-tensions" value={v.tensionMain} onChange={(e) => set({ tensionMain: e.target.value })} />
        </div>
        <div>
          <label htmlFor="re-tc">Crosses (lbs)</label>
          <input id="re-tc" inputMode="decimal" list="re-tensions" value={v.tensionCross} onChange={(e) => set({ tensionCross: e.target.value })} />
        </div>
        <datalist id="re-tensions">{TENSION_PRESETS.map((t) => <option key={t} value={t} />)}</datalist>
        <div>
          <label htmlFor="re-ps">Pre-stretch</label>
          <select id="re-ps" value={v.prestretch} onChange={(e) => set({ prestretch: e.target.value })}>
            <option value="">None</option>
            {PRESTRETCH_OPTIONS.map((p) => <option key={p} value={p}>{p}%</option>)}
          </select>
        </div>
      </div>
      <div className="row field">
        <div><label htmlFor="re-d">Collection date</label><input id="re-d" type="date" value={v.dueOn} onChange={(e) => set({ dueOn: e.target.value })} /></div>
        <label className="check-row" style={{ alignSelf: "end" }}><input type="checkbox" checked={v.rush} onChange={(e) => set({ rush: e.target.checked })} /> ⚡ Rush</label>
      </div>
      <div className="row field">
        <div><label htmlFor="re-gs">Single grommets</label><input id="re-gs" type="number" min={0} value={v.grommetsSingle} onChange={(e) => set({ grommetsSingle: e.target.value })} /></div>
        <div><label htmlFor="re-gd">Double grommets</label><input id="re-gd" type="number" min={0} value={v.grommetsDouble} onChange={(e) => set({ grommetsDouble: e.target.value })} /></div>
      </div>
      <div className="field"><label htmlFor="re-n">Notes</label><input id="re-n" maxLength={200} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
      <div className="actions">
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={busy}>Save</button>
      </div>
    </form>
  );
}

// ---- Strings and stock (all staff); prices and tag settings (owner/managers) --------------------

type StringForm = { id?: number; brand: string; model: string; colors: string; price: string; stock: Record<string, string>; active: boolean };
const EMPTY_STRING: StringForm = { brand: "", model: "", colors: "", price: "", stock: {}, active: true };
/** The colours typed in "White, Yellow, pink, Yellow": each once, as first spelled. */
const typedColors = (raw: string) =>
  raw.split(",").map((c) => c.trim()).filter((c, i, all) => c && all.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i);
type StockEdit = { id: number; mode: "add" | "set"; counts: Record<string, string>; note: string };
const stockClass = (n: number) => `sf-stock-n${n <= 0 ? " out" : n <= 3 ? " low" : ""}`;

function StringsPage({ manage, onAuthError, onBack }: { manage: boolean; onAuthError: (e: unknown) => void; onBack: () => void }) {
  const [strings, setStrings] = useState<StringItem[] | null>(null);
  const [prices, setPrices] = useState<Record<string, string> | null>(null);
  const [tagQr, setTagQr] = useState(false);
  const [form, setForm] = useState<StringForm>(EMPTY_STRING);
  const [moves, setMoves] = useState<{ id: number; list: StockMove[] } | null>(null);
  const [stock, setStock] = useState<StockEdit | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // The string form sits below the list, so Edit brings it into view (it looked like nothing happened).
  function editString(s: StringItem) {
    setForm({ id: s.id, brand: s.brand, model: s.model, colors: s.colors.join(", "), price: String(s.price), stock: {}, active: s.active });
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      formRef.current?.querySelector<HTMLInputElement>("#ss-b")?.focus({ preventScroll: true });
    });
  }

  const load = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([
        api<{ strings: StringItem[] }>("/api/admin/stringing?strings=1"),
        fetch("/api/stringing", { cache: "no-store" }).then((r) => r.json() as Promise<{ prices: StringingPrices }>),
      ]);
      setStrings(s.strings);
      const p = o.prices;
      setPrices({
        labor: String(p.labor), rush: String(p.rush), grommetSingle: String(p.grommetSingle), grommetDouble: String(p.grommetDouble),
      });
      setTagQr(p.tagQr);
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't load.");
    }
  }, [onAuthError]);
  useEffect(() => { load(); }, [load]);

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await api("/api/admin/stringing", body);
      setNote(done);
      await load();
      if (moves) await showMoves(moves.id, true);
      return true;
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function showMoves(id: number, keep = false) {
    if (!keep && moves?.id === id) return setMoves(null);
    try {
      setMoves({ id, list: (await api<{ moves: StockMove[] }>(`/api/admin/stringing?moves=${id}`)).moves });
    } catch (e) {
      onAuthError(e);
    }
  }
  // A delivery (how many of each colour came in) or a count (how many of each are on the shelf).
  function openStock(s: StringItem, mode: StockEdit["mode"]) {
    if (stock?.id === s.id && stock.mode === mode) return setStock(null);
    const counts = Object.fromEntries(stockLines(s).map((l) => [l.color, mode === "set" ? String(Math.max(0, l.stock)) : ""]));
    setStock({ id: s.id, mode, counts, note: "" });
  }
  async function saveStock(s: StringItem) {
    if (!stock) return;
    const counts: Record<string, number> = {};
    for (const [color, v] of Object.entries(stock.counts)) {
      if (v.trim() === "") continue;
      const n = Number(v);
      if (!Number.isInteger(n) || (stock.mode === "set" && n < 0)) return setError(`Enter a whole number of sets${color ? ` for ${color}` : ""}.`);
      if (stock.mode === "set" || n !== 0) counts[color] = n;
    }
    if (!Object.keys(counts).length) return setError(stock.mode === "add" ? "Enter how many sets came in." : "Enter the counts.");
    const added = Object.values(counts).reduce((a, b) => a + b, 0);
    if (await run({ action: "string-stock", id: s.id, mode: stock.mode, counts, note: stock.note },
      stock.mode === "add" ? `${added} set${added === 1 ? "" : "s"} of ${stringName(s)} added.` : `${stringName(s)}: count saved.`)) setStock(null);
  }

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <div><button type="button" className="link-btn" onClick={onBack}>← Stringing queue</button></div>
      <h2>Strings &amp; stock</h2>
      <p className="hint">
        Stock is counted per colour; each set is enough for one racket. When a customer buys a string at check-in, one set of that
        colour comes off (and goes back if the racket is cancelled). Customers can&apos;t choose a colour that&apos;s out of stock.
      </p>
      {error && <div className="error">{error}</div>}
      {note && <div className="success">{note}</div>}

      {strings && (
        strings.length === 0 ? <p className="muted">No strings yet — customers can only choose “I brought my own string” until you add some.</p> : (
          <div className="table-wrap">
            <table className="list sf-stock">
              <thead><tr><th>String</th><th>Price</th><th>In stock</th><th></th></tr></thead>
              <tbody>
                {strings.map((s) => {
                  const lines = stockLines(s);
                  const perColor = lines.some((l) => l.color);
                  return (
                    <Fragment key={s.id}>
                      <tr className={s.active ? undefined : "muted"}>
                        <td>
                          <strong>{stringName(s)}</strong>{!s.active && <span className="badge grey" style={{ marginLeft: 6 }}>Not offered</span>}
                        </td>
                        <td>{formatPeso(s.price)}</td>
                        <td>
                          {perColor ? <span className="sf-stock-total">{s.stock} in all</span> : (
                            <>
                              <span className={stockClass(s.stock)}>{s.stock}</span>
                              {s.stock <= 0 && <span className="hint"> {s.stock < 0 ? "— count it" : "out"}</span>}
                            </>
                          )}
                        </td>
                        <td className="sf-stock-actions">
                          <button type="button" className="btn small" disabled={busy} onClick={() => openStock(s, "add")}>+ Delivery</button>
                          <button type="button" className="btn small secondary" disabled={busy} onClick={() => openStock(s, "set")}>Count</button>
                          <button type="button" className="link-btn" onClick={() => showMoves(s.id)}>{moves?.id === s.id ? "Hide history" : "History"}</button>
                          <button type="button" className="link-btn" onClick={() => editString(s)}>{form.id === s.id ? "Editing…" : "Edit"}</button>
                          {manage && (
                            <button type="button" className="link-btn danger-text" onClick={async () => (await confirmDialog(`Remove ${stringName(s)}? If rackets used it, it's hidden from customers instead.`, { confirmLabel: "Remove", danger: true })) &&
                              run({ action: "string-delete", id: s.id }, `${stringName(s)} removed.`)}>Remove</button>
                          )}
                        </td>
                      </tr>
                      {perColor && lines.map((l) => (
                        <tr key={l.color} className={`sf-stock-color${s.active ? "" : " muted"}`}>
                          <td>{l.color}{!l.listed && <span className="hint"> · not on the list any more</span>}</td>
                          <td></td>
                          <td>
                            <span className={stockClass(l.stock)}>{l.stock}</span>
                            {l.stock <= 0 && <span className="hint"> {l.stock < 0 ? "— count it" : "out"}</span>}
                          </td>
                          <td></td>
                        </tr>
                      ))}
                      {stock?.id === s.id && (
                        <tr className="sf-moves-row">
                          <td colSpan={4}>
                            <form className="sf-stock-edit" onSubmit={(e) => { e.preventDefault(); saveStock(s); }}>
                              <strong>{stock.mode === "add" ? `New delivery of ${stringName(s)}` : `Count ${stringName(s)}`}</strong>
                              <p className="hint">
                                {stock.mode === "add" ? "How many sets of each came in? Leave the others blank." : "How many sets of each are on the shelf?"}
                              </p>
                              <div className="sf-stock-grid">
                                {lines.map((l) => (
                                  <label key={l.color}>
                                    <span>{l.color || "Sets"} <span className="hint">· {l.stock} now</span></span>
                                    <input type="number" inputMode="numeric" step={1} min={stock.mode === "set" ? 0 : undefined} placeholder="0"
                                      value={stock.counts[l.color] ?? ""} onChange={(e) => setStock({ ...stock, counts: { ...stock.counts, [l.color]: e.target.value } })} />
                                  </label>
                                ))}
                              </div>
                              <input aria-label="Note" maxLength={120} placeholder="Note (optional), e.g. supplier or receipt no." value={stock.note}
                                onChange={(e) => setStock({ ...stock, note: e.target.value })} />
                              <div className="actions start">
                                <button className="btn" disabled={busy}>{stock.mode === "add" ? "Add to stock" : "Save count"}</button>
                                <button type="button" className="btn secondary" onClick={() => setStock(null)}>Cancel</button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                      {moves?.id === s.id && (
                        <tr className="sf-moves-row">
                          <td colSpan={4}>
                            {moves.list.length === 0 ? <span className="muted">No stock changes yet.</span> : (
                              <ul className="voucher-history">
                                {moves.list.map((m, i) => (
                                  <li key={i}>
                                    <span className="muted">{when(m.at)}</span> {m.color && <strong>{m.color}</strong>}{" "}
                                    <strong className={m.change > 0 ? "sf-up" : "sf-down"}>{m.change > 0 ? `+${m.change}` : m.change}</strong>{" "}
                                    → {m.stock_after} · {m.reason} <span className="muted">({m.actor})</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      <form ref={formRef} className="card stack" onSubmit={async (e) => {
        e.preventDefault();
        const colors = typedColors(form.colors);
        const stock = Object.fromEntries((colors.length ? colors : [""]).map((c) => [c, form.stock[c] ?? ""]));
        if (await run({ action: "string-save", ...form, stock }, form.id ? "String saved." : "String added.")) setForm(EMPTY_STRING);
      }}>
        <strong>{form.id ? `Edit ${form.brand} ${form.model}` : "Add a string NVBC sells"}</strong>
        <div className="row field">
          <div><label htmlFor="ss-b">Brand</label><input id="ss-b" required placeholder="Yonex" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></div>
          <div><label htmlFor="ss-m">Model</label><input id="ss-m" required placeholder="BG66 Ultimax" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
        </div>
        <div className="row field">
          <div><label htmlFor="ss-c">Colours <span className="hint">comma-separated</span></label><input id="ss-c" placeholder="White, Yellow, Pink" value={form.colors} onChange={(e) => setForm({ ...form, colors: e.target.value })} /></div>
          <div><label htmlFor="ss-p">Price (₱)</label><input id="ss-p" required type="number" min={0} step="any" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
        </div>
        {!form.id && (
          <div className="field">
            <label>Sets in stock {typedColors(form.colors).length > 0 && <span className="hint">per colour</span>}</label>
            <div className="sf-stock-grid">
              {(typedColors(form.colors).length ? typedColors(form.colors) : [""]).map((c) => (
                <label key={c.toLowerCase()}>
                  {c && <span>{c}</span>}
                  <input type="number" inputMode="numeric" min={0} step={1} placeholder="0" aria-label={c ? `${c} sets` : "Sets"}
                    value={form.stock[c] ?? ""} onChange={(e) => setForm({ ...form, stock: { ...form.stock, [c]: e.target.value } })} />
                </label>
              ))}
            </div>
          </div>
        )}
        {form.id && <label className="check-row"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Offered to customers</label>}
        <div className="actions">
          {form.id && <button type="button" className="btn secondary" onClick={() => setForm(EMPTY_STRING)}>Cancel</button>}
          <button className="btn" disabled={busy}>{form.id ? "Save string" : "Add string"}</button>
        </div>
      </form>

      {manage && prices && (
        <form className="card stack" onSubmit={(e) => {
          e.preventDefault();
          run({ action: "prices", prices: {
            labor: prices.labor, rush: prices.rush, grommetSingle: prices.grommetSingle, grommetDouble: prices.grommetDouble, tagQr,
          } }, "Settings saved.");
        }}>
          <strong>Prices &amp; tags <span className="hint">· owner and managers</span></strong>
          <p className="hint">The turnaround is at the top of the Stringing queue, so the desk can change it as it gets busy.</p>
          <div className="row field">
            <div><label htmlFor="sp-l">Stringing labour (₱ per racket)</label><input id="sp-l" type="number" min={0} step="any" value={prices.labor} onChange={(e) => setPrices({ ...prices, labor: e.target.value })} /></div>
            <div><label htmlFor="sp-r">Rush (₱ added)</label><input id="sp-r" type="number" min={0} step="any" value={prices.rush} onChange={(e) => setPrices({ ...prices, rush: e.target.value })} /></div>
          </div>
          <div className="row field">
            <div><label htmlFor="sp-gs">Single grommet (₱ each)</label><input id="sp-gs" type="number" min={0} step="any" value={prices.grommetSingle} onChange={(e) => setPrices({ ...prices, grommetSingle: e.target.value })} /></div>
            <div><label htmlFor="sp-gd">Double grommet (₱ each)</label><input id="sp-gd" type="number" min={0} step="any" value={prices.grommetDouble} onChange={(e) => setPrices({ ...prices, grommetDouble: e.target.value })} /></div>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={tagQr} onChange={(e) => setTagQr(e.target.checked)} />
            <span>
              Print tags with QR codes <span className="hint">— turn on once you have a label printer. Receiving a racket then prints its tag, and
              scanning the tag opens it. Off: staff write the number on a blank tag.</span>
            </span>
          </label>
          <div className="actions"><button className="btn" disabled={busy}>Save</button></div>
        </form>
      )}
    </div>
  );
}

// ---- Owner/managers: stringer report and feedback -----------------------------------------------

function ReportPage({ onAuthError, onBack }: { onAuthError: (e: unknown) => void; onBack: () => void }) {
  const today = todayManila();
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [r, setR] = useState<StringerReport | null>(null);
  const [feedback, setFeedback] = useState<FeedbackRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<StringerReport>(`/api/admin/stringing?report=1&from=${from}&to=${to}`).then((x) => { setR(x); setError(""); })
      .catch((e) => { onAuthError(e); setError(e instanceof Error ? e.message : "Couldn't load."); });
  }, [from, to, onAuthError]);
  useEffect(() => {
    api<{ feedback: FeedbackRow[] }>("/api/admin/stringing?feedback=1").then((x) => setFeedback(x.feedback)).catch(() => {});
  }, []);
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <div><button type="button" className="link-btn" onClick={onBack}>← Stringing queue</button></div>
      <h2>Stringer report</h2>
      <div className="row field" style={{ maxWidth: 420 }}>
        <div><label htmlFor="rp-f">From</label><input id="rp-f" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label htmlFor="rp-t">To</label><input id="rp-t" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {error && <div className="error">{error}</div>}
      {r && (
        <>
          <p className="hint">Rackets each stringer marked <strong>Done</strong> in these dates (for paying them per racket).</p>
          {r.stringers.length === 0 ? <p className="muted">No rackets finished in these dates.</p> : (
            <div className="table-wrap">
              <table className="list">
                <thead><tr><th>Stringer</th><th>Rackets</th><th>Rush</th><th>Grommets changed</th></tr></thead>
                <tbody>
                  {r.stringers.map((s) => <tr key={s.name}><td><strong>{s.name}</strong></td><td>{s.rackets}</td><td>{s.rush}</td><td>{s.grommets}</td></tr>)}
                  <tr><td><strong>Total</strong></td><td><strong>{r.stringers.reduce((a, s) => a + s.rackets, 0)}</strong></td>
                    <td>{r.stringers.reduce((a, s) => a + s.rush, 0)}</td><td>{r.stringers.reduce((a, s) => a + s.grommets, 0)}</td></tr>
                </tbody>
              </table>
            </div>
          )}
          {r.rackets.length > 0 && (
            <details>
              <summary>All {r.rackets.length} rackets</summary>
              <div className="table-wrap">
                <table className="list">
                  <thead><tr><th>Tag</th><th>Racket</th><th>Stringer</th><th>Done</th><th>Price</th></tr></thead>
                  <tbody>
                    {r.rackets.map((x) => (
                      <tr key={x.tag}><td>{tagLabel(x.tag)}</td><td>{x.racket}{x.rush ? " ⚡" : ""}</td><td>{x.done_by}</td><td>{when(x.done_at)}</td><td>{formatPeso(Number(x.total))}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <p>Feedback in these dates: {r.feedback.count ? <><strong>{r.feedback.average} ★</strong> average from {r.feedback.count}</> : "none"}.</p>
        </>
      )}
      <h3>Latest feedback</h3>
      {!feedback ? <p className="muted">Loading…</p> : feedback.length === 0 ? <p className="muted">No feedback yet.</p> : (
        <ul className="voucher-history">
          {feedback.map((f) => (
            <li key={f.id}><strong>{"★".repeat(f.rating)}{"☆".repeat(5 - f.rating)}</strong> {f.name} ({f.tags}) · <span className="muted">{when(f.at)}</span>{f.comment && <> — “{f.comment}”</>}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
