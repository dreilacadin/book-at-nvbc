"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import VoucherCard, { useSite, VoucherTerms } from "@/components/VoucherCard";
import { formatDateLong } from "@/lib/format";
import { formatPeso } from "@/lib/pricing";
import { allActivities, sportEmoji } from "@/lib/sports";
import { addDays } from "@/lib/time";
import {
  defaultTerms,
  hasBalance,
  normalizeVoucherCode,
  ONDECK_HOST,
  ONDECK_SESSIONS,
  onDeckSessionName,
  TERMS_PLACEHOLDERS,
  VOUCHER_KINDS,
  voucherKindLabel,
  voucherLeftLabel,
  voucherPath,
  voucherStateLabel,
  voucherValueLabel,
  type VoucherKind,
  type VoucherState,
  type VoucherStatus,
} from "@/lib/voucher";
import type { AdminVoucher, VoucherEvent, VoucherUse } from "@/lib/vouchers";
import QrScanner from "./QrScanner";
import { useCanManage } from "./role";
import { api, todayManila } from "./shared";

// Admin → Vouchers: the list (search, scan, filter, print), creating vouchers, and each voucher's
// own page (status, dates, terms, balance, the bookings it was used on, and its history).

const STATE_BADGE: Record<VoucherState, string> = {
  ready: "badge", not_yet: "badge pending", paused: "badge pending", used_up: "badge grey", expired: "badge grey", void: "badge grey",
  redeemed: "badge grey",
};
const printUrl = (ids: string[]) => `/admin/vouchers/print?ids=${ids.join(",")}`;
const openPrint = (ids: string[]) => window.open(printUrl(ids), "_blank", "noopener");
const dateOrNone = (d: string | null) => (d ? formatDateLong(d) : "No expiry");

/** Deletes vouchers after a confirm; a message for staff, or null if they cancelled. */
async function deleteVouchers(vouchers: { id: string; code: string }[]): Promise<{ ok: boolean; text: string; deleted: number } | null> {
  const what = vouchers.length === 1 ? vouchers[0].code : `${vouchers.length} vouchers`;
  if (!window.confirm(`Delete ${what} for good? Printed copies stop working, and this can't be undone. (A voucher that's been used is kept — void it or mark it redeemed instead.)`))
    return null;
  try {
    const r = await api<{ deleted: string[]; kept: { code: string; used: number }[] }>("/api/admin/vouchers", { action: "delete", ids: vouchers.map((v) => v.id) });
    const kept = r.kept.map((k) => `${k.code} (used ${k.used === 1 ? "once" : `${k.used} times`})`).join(", ");
    return {
      ok: r.kept.length === 0,
      deleted: r.deleted.length,
      text: [r.deleted.length ? `Deleted ${r.deleted.length === 1 ? r.deleted[0] : `${r.deleted.length} vouchers`}.` : "",
        kept ? `Kept ${kept} — a voucher that's been used can't be deleted; void it or mark it redeemed instead.` : ""].filter(Boolean).join(" "),
    };
  } catch (e) {
    return { ok: false, deleted: 0, text: e instanceof Error ? e.message : "Couldn't delete." };
  }
}

export default function VouchersTab({
  onAuthError,
  openId,
  onOpenBooking,
}: {
  onAuthError: (e: unknown) => void;
  openId?: string | null; // a voucher to open (from /admin?voucher=…)
  onOpenBooking: (code: string) => void;
}) {
  const [view, setView] = useState<{ kind: "list"; batch?: string } | { kind: "create" } | { kind: "detail"; id: string }>(
    openId ? { kind: "detail", id: openId } : { kind: "list" }
  );
  if (view.kind === "create")
    return (
      <CreateVouchers
        onAuthError={onAuthError}
        onCancel={() => setView({ kind: "list" })}
        onCreated={(ids, batch) => setView(ids.length === 1 ? { kind: "detail", id: ids[0] } : { kind: "list", batch })}
      />
    );
  if (view.kind === "detail")
    return <VoucherPage id={view.id} onAuthError={onAuthError} onBack={() => setView({ kind: "list" })} onOpenBooking={onOpenBooking} />;
  return (
    <VoucherList
      onAuthError={onAuthError}
      initialQuery={view.batch ?? ""}
      onOpen={(id) => setView({ kind: "detail", id })}
      onCreate={() => setView({ kind: "create" })}
    />
  );
}

// ---- List ---------------------------------------------------------------------------------------

function VoucherList({
  onAuthError,
  initialQuery,
  onOpen,
  onCreate,
}: {
  onAuthError: (e: unknown) => void;
  initialQuery: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const manage = useCanManage();
  const [q, setQ] = useState(initialQuery);
  const [filter, setFilter] = useState<"all" | VoucherState>("all");
  const [vouchers, setVouchers] = useState<AdminVoucher[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (query: string) => {
    try {
      const r = await api<{ vouchers: AdminVoucher[] }>(`/api/admin/vouchers?q=${encodeURIComponent(query)}`);
      setVouchers(r.vouchers);
      setError("");
      return r.vouchers;
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't load vouchers.");
      return [];
    }
  }, [onAuthError]);
  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  const shown = (vouchers ?? []).filter((v) => filter === "all" || v.state === filter);
  const counts = useMemo(() => {
    const c: Partial<Record<VoucherState, number>> = {};
    for (const v of vouchers ?? []) c[v.state] = (c[v.state] ?? 0) + 1;
    return c;
  }, [vouchers]);
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const allShownSelected = shown.length > 0 && shown.every((v) => selected.has(v.id));

  return (
    <div className="stack">
      <div className="voucher-toolbar">
        <input type="search" placeholder="Search a code, name, title, note or batch" aria-label="Search vouchers"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn secondary" onClick={() => setScanning(true)}>📷 Scan</button>
        {manage && <button type="button" className="btn" onClick={onCreate}>+ Create vouchers</button>}
      </div>
      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onCode={async (text) => {
            setScanning(false);
            const code = normalizeVoucherCode(text);
            if (!code) return setError("That QR code isn't an NVBC voucher.");
            setQ(code);
            const found = await load(code);
            if (found.length === 1) onOpen(found[0].id);
            else if (!found.length) setError(`No voucher found with code ${code}.`);
          }}
        />
      )}
      <div className="segmented voucher-filter" role="radiogroup" aria-label="Show">
        {(["all", "ready", "used_up", "redeemed", "expired", "paused", "void"] as const).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : voucherStateLabel(f)}
            <small>{f === "all" ? vouchers?.length ?? 0 : counts[f] ?? 0}</small>
          </button>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      {note && <div className={note.ok ? "success" : "notice"}>{note.text}</div>}
      {selected.size > 0 && (
        <div className="notice info voucher-selbar">
          <strong>{selected.size} selected</strong>
          <button type="button" className="btn small" onClick={() => openPrint([...selected])}>🖨 Print selected</button>
          {manage && (
            <button type="button" className="btn small secondary danger-text" onClick={async () => {
              const r = await deleteVouchers((vouchers ?? []).filter((v) => selected.has(v.id)));
              if (!r) return;
              setNote(r);
              setSelected(new Set());
              load(q.trim());
            }}>🗑 Delete selected</button>
          )}
          <button type="button" className="btn small secondary" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {!vouchers ? (
        <p className="muted">Loading vouchers…</p>
      ) : shown.length === 0 ? (
        <p className="muted">
          {vouchers.length === 0 && !q ? (manage ? "No vouchers yet. Tap + Create vouchers to make the first one." : "No vouchers yet.") : "No vouchers match."}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="list voucher-list">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" aria-label="Select all shown" checked={allShownSelected}
                    onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((v) => v.id)))} />
                </th>
                <th>Code</th>
                <th>Voucher</th>
                <th>Left</th>
                <th>Status</th>
                <th>Valid until</th>
                <th>For</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <tr key={v.id} onClick={() => onOpen(v.id)} className="clickable">
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${v.code}`} checked={selected.has(v.id)} onChange={() => toggle(v.id)} />
                  </td>
                  <td className="mono">{v.code}</td>
                  <td>
                    <strong>{voucherValueLabel(v)}</strong>
                    <div className="hint">{voucherKindLabel(v.kind)}{v.title ? ` · ${v.title}` : ""}</div>
                  </td>
                  <td>{voucherLeftLabel(v)}</td>
                  <td><span className={STATE_BADGE[v.state]}>{voucherStateLabel(v.state)}</span></td>
                  <td>{v.expiresOn ? formatDateLong(v.expiresOn) : <span className="muted">No expiry</span>}</td>
                  <td>{v.issuedTo || <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Shared form parts --------------------------------------------------------------------------

type FormState = {
  title: string; issuedTo: string; note: string; terms: string; validFrom: string; expiresOn: string;
  sports: string[]; maxUses: string; maxDiscount: string;
};

/** Sports and activities a voucher is for (none ticked = any). */
function SportsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const all = allActivities();
  const any = value.length === 0;
  return (
    <div className="court-checks">
      {all.map((a) => (
        <label key={a.id}>
          <input type="checkbox" checked={any || value.includes(a.id)}
            onChange={(e) => {
              const cur = any ? all.map((x) => x.id) : value;
              const next = e.target.checked ? [...new Set([...cur, a.id])] : cur.filter((x) => x !== a.id);
              onChange(next.length === all.length ? [] : next);
            }} />
          {sportEmoji(a.id)} {a.label}
        </label>
      ))}
    </div>
  );
}

/** The terms editor: the text with its placeholders, a reset, and how it reads. */
function TermsEditor({
  kind, value, onChange, preview,
}: {
  kind: VoucherKind;
  value: string;
  onChange: (v: string) => void;
  preview: Parameters<typeof VoucherTerms>[0]["v"];
}) {
  return (
    <div className="field">
      <label htmlFor="v-terms">
        Terms &amp; conditions <span className="hint">— one per line; printed with the voucher and shown on its page</span>
      </label>
      <textarea id="v-terms" rows={9} maxLength={2000} value={value} onChange={(e) => onChange(e.target.value)} />
      <p className="hint" style={{ margin: "4px 0 0" }}>
        Filled in for you:{" "}
        {TERMS_PLACEHOLDERS.map((p, i) => (
          <span key={p.key}>{i ? " · " : ""}<code>{`{${p.key}}`}</code> {p.hint}</span>
        ))}
        .{" "}
        {value !== defaultTerms(kind) && (
          <button type="button" className="link-btn" onClick={() => onChange(defaultTerms(kind))}>Reset to the default terms</button>
        )}
      </p>
      <details className="voucher-terms-preview">
        <summary>How the terms read</summary>
        <VoucherTerms v={preview} />
      </details>
    </div>
  );
}

const fieldsBody = (f: FormState) => ({
  title: f.title, issuedTo: f.issuedTo, note: f.note, terms: f.terms, validFrom: f.validFrom, expiresOn: f.expiresOn,
  sports: f.sports, maxUses: f.maxUses === "" ? 1 : Number(f.maxUses), maxDiscount: f.maxDiscount,
});

// ---- Create -------------------------------------------------------------------------------------

function CreateVouchers({
  onAuthError,
  onCancel,
  onCreated,
}: {
  onAuthError: (e: unknown) => void;
  onCancel: () => void;
  onCreated: (ids: string[], batch: string) => void;
}) {
  const today = todayManila();
  const [kind, setKind] = useState<VoucherKind>("free_hours");
  const [value, setValue] = useState("1");
  const [quantity, setQuantity] = useState("1");
  const [f, setF] = useState<FormState>({
    title: "", issuedTo: "", note: "", terms: defaultTerms("free_hours"), validFrom: "", expiresOn: addDays(today, 90),
    sports: [], maxUses: "1", maxDiscount: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));

  const chooseKind = (k: VoucherKind) => {
    setKind(k);
    setValue({ free_hours: "1", fixed: "200", percent: "20", cash: "1000", ondeck_session: "1" }[k]);
    // Default terms follow the kind (unless staff already changed them); cash vouchers don't expire.
    // An On Deck voucher is for one sport (Pickleball Open Play to start with).
    setF((x) => ({
      ...x,
      terms: x.terms === defaultTerms(kind) ? defaultTerms(k) : x.terms,
      expiresOn: k === "cash" ? "" : x.expiresOn || addDays(today, 90),
      sports: k === "ondeck_session" ? ["pickleball"] : kind === "ondeck_session" ? [] : x.sports,
    }));
  };
  const n = Number(value) || 0;
  const preview = {
    code: "VCH-XXXX-XXXX", kind, value: n, maxDiscount: f.maxDiscount ? Number(f.maxDiscount) : null, maxUses: Number(f.maxUses) || 1,
    validFrom: f.validFrom || null, expiresOn: f.expiresOn || null, sports: f.sports, title: f.title, issuedTo: f.issuedTo, terms: f.terms,
  };
  const qty = Number(quantity) || 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (qty > 1 && f.issuedTo && !window.confirm(`Create ${qty} vouchers all issued to ${f.issuedTo}?`)) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ ids: string[] }>("/api/admin/vouchers", { action: "create", kind, value: n, quantity: qty, ...fieldsBody(f) });
      // A batch: show it in the list (its vouchers share a batch name, shown on each).
      const batch = qty > 1 ? (await api<{ voucher: AdminVoucher }>(`/api/admin/vouchers?id=${r.ids[0]}`)).voucher.batch : "";
      onCreated(r.ids, batch);
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Couldn't create the vouchers.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack voucher-form" onSubmit={submit}>
      <div><button type="button" className="link-btn" onClick={onCancel}>← All vouchers</button></div>
      <h2 style={{ margin: 0 }}>Create vouchers</h2>
      <fieldset>
        <legend>Kind of voucher</legend>
        <div className="voucher-kinds" role="radiogroup" aria-label="Kind of voucher">
          {VOUCHER_KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => chooseKind(k.id)}>
              <strong>{k.label}</strong>
              <small>{k.hint}</small>
            </button>
          ))}
        </div>
        <div className="row field" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="v-value">
              {kind === "free_hours" ? "Free court hours" : kind === "percent" ? "Percent off" : kind === "fixed" ? "Pesos off (₱)"
                : kind === "ondeck_session" ? "Free sessions" : "Value (₱)"}
            </label>
            <input id="v-value" type="number" required min={kind === "free_hours" ? 0.5 : 1}
              step={kind === "free_hours" ? 0.5 : kind === "percent" || kind === "ondeck_session" ? 1 : 0.01}
              max={kind === "free_hours" ? 100 : kind === "percent" ? 100 : kind === "ondeck_session" ? 50 : 100000} value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          {kind === "percent" && (
            <div>
              <label htmlFor="v-cap">At most (₱) <span className="hint">optional</span></label>
              <input id="v-cap" type="number" min={1} step={0.01} placeholder="No cap" value={f.maxDiscount} onChange={(e) => set("maxDiscount", e.target.value)} />
            </div>
          )}
          {(kind === "fixed" || kind === "percent") && (
            <div>
              <label htmlFor="v-uses">Bookings it can be used on</label>
              <input id="v-uses" type="number" min={1} max={1000} step={1} required value={f.maxUses} onChange={(e) => set("maxUses", e.target.value)} />
            </div>
          )}
          <div>
            <label htmlFor="v-qty">How many vouchers</label>
            <input id="v-qty" type="number" min={1} max={100} step={1} required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          {kind === "free_hours" && "Covers court time at the rate the booking is made at (member, coach or regular). Unused hours stay on the voucher."}
          {kind === "fixed" && "Taken off the court fee of each booking it's used on; if the fee is lower, the rest is forfeited."}
          {kind === "percent" && "Off the court fee of each booking it's used on (all courts of a group booking)."}
          {kind === "cash" && "Spent on court fees like a gift card; the balance carries over. Cash vouchers that people pay for shouldn't expire (see below)."}
          {kind === "ondeck_session" && `Used at NVBC On Deck (${ONDECK_HOST}): its staff scan or type the code when the player joins, and each visit uses one session. It can't be used on court bookings here.`}
          {qty > 1 && ` ${qty} vouchers will be made, each with its own code and QR, all with these settings.`}
        </p>
      </fieldset>

      <VoucherFields f={f} set={set} kind={kind} preview={preview} isNew />

      <fieldset>
        <legend>Preview</legend>
        <VoucherCard v={preview} />
      </fieldset>
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ position: "sticky", bottom: 0, background: "var(--bg)", padding: "10px 0" }}>
        <button className="btn" disabled={busy}>{busy ? "Creating…" : qty > 1 ? `Create ${qty} vouchers` : "Create voucher"}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Dates, sports, who it's for, notes and terms: when creating and on the voucher's page. */
function VoucherFields({
  f, set, kind, preview, isNew = false,
}: {
  f: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  kind: VoucherKind;
  preview: Parameters<typeof VoucherTerms>[0]["v"];
  isNew?: boolean;
}) {
  const today = todayManila();
  return (
    <>
      <fieldset>
        <legend>When and what for</legend>
        <div className="row field">
          <div>
            <label htmlFor="v-from">Valid from <span className="hint">optional</span></label>
            <input id="v-from" type="date" value={f.validFrom} onChange={(e) => set("validFrom", e.target.value)} />
          </div>
          <div>
            <label htmlFor="v-exp">Expires on <span className="hint">leave blank for no expiry</span></label>
            <input id="v-exp" type="date" min={isNew ? today : undefined} value={f.expiresOn} onChange={(e) => set("expiresOn", e.target.value)} />
          </div>
        </div>
        <p className="hint" style={{ margin: "0 0 8px" }}>
          {kind === "ondeck_session"
            ? "The session's date must be within these dates."
            : "The booking's date must be within these dates (it can be booked any time before)."}
          {kind === "cash" && f.expiresOn && (
            <> <strong>Heads-up:</strong> if this cash voucher is sold or given in exchange for money, the Gift Check Act (RA 10962)
            doesn&apos;t allow an expiry date on it. Leave it blank unless it&apos;s a free promo.</>
          )}
        </p>
        {kind === "ondeck_session" && !isNew ? (
          <p style={{ margin: 0 }}>
            <strong>For</strong> {sportEmoji(f.sports[0])} {onDeckSessionName(f.sports[0])} at NVBC On Deck{" "}
            <span className="hint">— printed on the voucher, so it can&apos;t be changed</span>
          </p>
        ) : kind === "ondeck_session" ? (
          <div className="field">
            <label>For</label>
            <div className="court-checks" role="radiogroup" aria-label="What it's for">
              {ONDECK_SESSIONS.map((o) => (
                <label key={o.sport}>
                  <input type="radio" name="v-ondeck-sport" checked={f.sports[0] === o.sport} onChange={() => set("sports", [o.sport])} />
                  {sportEmoji(o.sport)} {onDeckSessionName(o.sport)}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div className="field">
            <label>For <span className="hint">— all ticked: any sport or activity, including ones added later</span></label>
            <SportsPicker value={f.sports} onChange={(v) => set("sports", v)} />
          </div>
        )}
      </fieldset>
      <fieldset>
        <legend>Details</legend>
        <div className="row field">
          <div>
            <label htmlFor="v-title">Title <span className="hint">optional, printed — e.g. “Opening promo”</span></label>
            <input id="v-title" maxLength={60} value={f.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div>
            <label htmlFor="v-to">Issued to <span className="hint">optional, printed</span></label>
            <input id="v-to" maxLength={80} value={f.issuedTo} onChange={(e) => set("issuedTo", e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="v-note">Staff note <span className="hint">— not shown to customers (e.g. why it was given, OR number if sold)</span></label>
          <input id="v-note" maxLength={300} value={f.note} onChange={(e) => set("note", e.target.value)} />
        </div>
        <TermsEditor kind={kind} value={f.terms} onChange={(v) => set("terms", v)} preview={preview} />
      </fieldset>
    </>
  );
}

// ---- One voucher's page -------------------------------------------------------------------------

/** What a use took off the voucher: "₱150", "₱400 (2 h)", "1 session". */
function useTook(u: VoucherUse): string {
  if (u.sessions) return `${u.sessions} session${u.sessions === 1 ? "" : "s"}`;
  if (u.hours) return u.amount ? `${formatPeso(u.amount)} (${u.hours} h)` : `${u.hours} h`;
  return formatPeso(u.amount);
}

function VoucherPage({
  id, onAuthError, onBack, onOpenBooking,
}: {
  id: string;
  onAuthError: (e: unknown) => void;
  onBack: () => void;
  onOpenBooking: (code: string) => void;
}) {
  const manage = useCanManage();
  const site = useSite();
  const [data, setData] = useState<{ voucher: AdminVoucher; uses: VoucherUse[]; events: VoucherEvent[] } | null>(null);
  const [f, setF] = useState<FormState | null>(null);
  const [balance, setBalance] = useState("");
  const [balanceReason, setBalanceReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ voucher: AdminVoucher; uses: VoucherUse[]; events: VoucherEvent[] }>(`/api/admin/vouchers?id=${id}`);
      setData(d);
      const v = d.voucher;
      setF({
        title: v.title, issuedTo: v.issuedTo, note: v.note, terms: v.terms, validFrom: v.validFrom ?? "", expiresOn: v.expiresOn ?? "",
        sports: v.sports, maxUses: String(v.maxUses), maxDiscount: v.maxDiscount === null ? "" : String(v.maxDiscount),
      });
      setBalance(String(v.balance));
      setBalanceReason("");
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't load the voucher.");
    }
  }, [id, onAuthError]);
  useEffect(() => { load(); }, [load]);

  if (!data || !f) return error ? <div className="error">{error}</div> : <p className="muted">Loading voucher…</p>;
  const v = data.voucher;
  const set = <K extends keyof FormState>(k: K, val: FormState[K]) => { setSaved(""); setF((x) => (x ? { ...x, [k]: val } : x)); };
  const preview = {
    ...v, title: f.title, issuedTo: f.issuedTo, terms: f.terms, validFrom: f.validFrom || null, expiresOn: f.expiresOn || null,
    sports: f.sports, maxUses: Number(f.maxUses) || 1, maxDiscount: f.maxDiscount ? Number(f.maxDiscount) : null,
  };
  const link = site.origin + voucherPath(v.code);

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await api("/api/admin/vouchers", { id, ...body });
      await load();
      setSaved(done);
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }
  const setStatus = (status: VoucherStatus) => {
    if (status === "void") {
      const reason = window.prompt(
        `Void ${v.code}? It stops working right away (bookings it's already on keep their discount). Why? (e.g. "Lost", "Replaced by VCH-…")`
      );
      if (reason === null) return;
      return run({ action: "status", status, reason }, "Voucher voided.");
    }
    if (status === "redeemed") {
      const left = hasBalance(v.kind) && v.balance > 0 ? ` What's left (${voucherLeftLabel(v).replace(/ of .*/, "")}) is used up.` : "";
      const reason = window.prompt(
        `Mark ${v.code} as redeemed? It stops working, and the card shows REDEEMED.${left} How was it redeemed? (e.g. "Used at the desk for a walk-in, OR 1234")`
      );
      if (reason === null) return;
      return run({ action: "status", status, reason }, "Voucher marked redeemed.");
    }
    if (v.status === "redeemed" && !window.confirm(`Undo redeemed on ${v.code}? It works again, with what it had left given back.`)) return;
    run({ action: "status", status }, status === "paused" ? "Voucher paused — it can't be used until it's activated again."
      : v.status === "redeemed" ? "Redeemed undone — the voucher works again." : "Voucher activated.");
  };
  const balanceChanged = hasBalance(v.kind) && balance !== "" && Number(balance) !== v.balance;

  return (
    <div className="stack voucher-page">
      <div><button type="button" className="link-btn" onClick={onBack}>← All vouchers</button></div>
      <VoucherCard v={preview} state={v.state} />
      <div className="voucher-summary">
        <span className={STATE_BADGE[v.state]}>{voucherStateLabel(v.state)}</span>
        <strong>{voucherLeftLabel(v)}</strong>
        <span className="muted">
          {voucherKindLabel(v.kind)}{v.kind === "ondeck_session" ? "" : ` · ${formatPeso(v.given)} used so far`} · created by {v.createdBy || "staff"}{" "}
          {new Date(v.createdAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" })}{v.batch ? ` · batch ${v.batch}` : ""}
        </span>
      </div>
      <div className="actions" style={{ margin: 0 }}>
        <button type="button" className="btn" onClick={() => openPrint([v.id])}>🖨 Print</button>
        <button type="button" className="btn secondary" onClick={async () => {
          try { await navigator.clipboard.writeText(link); setCopied(true); } catch { window.prompt("Copy the voucher's link:", link); }
        }}>{copied ? "✓ Link copied" : "🔗 Copy link"}</button>
        {manage && v.status === "redeemed" && <button type="button" className="btn secondary" disabled={busy} onClick={() => setStatus("active")}>↩ Undo redeemed</button>}
        {manage && (v.status === "paused" || v.status === "void") && <button type="button" className="btn secondary" disabled={busy} onClick={() => setStatus("active")}>▶ Activate</button>}
        {manage && v.status === "active" && <button type="button" className="btn secondary" disabled={busy} onClick={() => setStatus("paused")}>⏸ Pause</button>}
        {manage && (v.status === "active" || v.status === "paused") && (
          <button type="button" className="btn secondary" disabled={busy} onClick={() => setStatus("redeemed")}>✓ Mark redeemed</button>
        )}
        {manage && (v.status === "active" || v.status === "paused") && <button type="button" className="btn secondary danger-text" disabled={busy} onClick={() => setStatus("void")}>⊘ Void</button>}
        {manage && (
          <button type="button" className="btn secondary danger-text" disabled={busy} onClick={async () => {
            const r = await deleteVouchers([v]);
            if (!r) return;
            if (r.deleted) return onBack();
            setError(r.text);
          }}>🗑 Delete</button>
        )}
      </div>
      {v.state === "expired" && v.kind === "cash" && (
        <div className="notice">This cash voucher has expired. If it was paid for, consider extending it (the Gift Check Act doesn&apos;t allow expiry on paid gift checks).</div>
      )}
      {error && <div className="error">{error}</div>}
      {saved && <div className="success">{saved}</div>}

      {manage ? (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          if (balanceChanged && !balanceReason.trim()) return setError("Please give a reason for changing the balance.");
          run({ action: "update", ...fieldsBody(f), ...(balanceChanged ? { balance, balanceReason } : {}) }, "Changes saved.");
        }}>
          {(hasBalance(v.kind) || v.kind === "fixed" || v.kind === "percent") && (
            <fieldset>
              <legend>{hasBalance(v.kind) ? "Balance" : "Uses"}</legend>
              {hasBalance(v.kind) ? (
                <div className="row field">
                  <div>
                    <label htmlFor="v-bal">{v.kind === "free_hours" ? "Hours left" : v.kind === "ondeck_session" ? "Sessions left" : "Pesos left (₱)"}</label>
                    <input id="v-bal" type="number" min={0} step={v.kind === "free_hours" ? 0.5 : v.kind === "ondeck_session" ? 1 : 0.01}
                      value={balance} onChange={(e) => setBalance(e.target.value)} />
                  </div>
                  {balanceChanged && (
                    <div>
                      <label htmlFor="v-bal-why">Why <span className="hint">logged</span></label>
                      <input id="v-bal-why" maxLength={120} placeholder="e.g. Topped up, paid ₱500 (OR 1234)" value={balanceReason} onChange={(e) => setBalanceReason(e.target.value)} />
                    </div>
                  )}
                </div>
              ) : (
                <div className="row field">
                  <div>
                    <label htmlFor="v-uses2">Bookings it can be used on <span className="hint">used on {v.uses} now</span></label>
                    <input id="v-uses2" type="number" min={Math.max(1, v.uses)} max={1000} step={1} value={f.maxUses} onChange={(e) => set("maxUses", e.target.value)} />
                  </div>
                  {v.kind === "percent" && (
                    <div>
                      <label htmlFor="v-cap2">At most (₱) <span className="hint">optional</span></label>
                      <input id="v-cap2" type="number" min={1} step={0.01} placeholder="No cap" value={f.maxDiscount} onChange={(e) => set("maxDiscount", e.target.value)} />
                    </div>
                  )}
                </div>
              )}
              <p className="hint" style={{ margin: 0 }}>
                What it&apos;s worth ({voucherValueLabel(v)}) is printed, so it can&apos;t be changed — void it and create a new one instead.
              </p>
            </fieldset>
          )}
          <VoucherFields f={f} set={set} kind={v.kind} preview={preview} />
          <div className="actions" style={{ position: "sticky", bottom: 0, background: "var(--bg)", padding: "10px 0" }}>
            <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
            <span className="hint">Changed details show on the voucher&apos;s page right away; reprint it if the printed details changed.</span>
          </div>
        </form>
      ) : (
        <>
          <dl className="member-details">
            <div><dt>Valid</dt><dd>{v.validFrom ? `${formatDateLong(v.validFrom)} – ` : ""}{dateOrNone(v.expiresOn)}</dd></div>
            <div><dt>Issued to</dt><dd>{v.issuedTo || "—"}</dd></div>
            {v.note && <div><dt>Note</dt><dd>{v.note}</dd></div>}
          </dl>
          <VoucherTerms v={v} />
        </>
      )}

      <section className="stack">
        <h3 style={{ margin: 0 }}>Used on</h3>
        {data.uses.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{v.kind === "ondeck_session" ? "Not used at On Deck yet." : "Not used on any booking yet."}</p>
        ) : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Where</th><th>Details</th><th>Took off</th><th>When</th><th></th></tr></thead>
              <tbody>
                {data.uses.map((u) => (
                  <tr key={u.id} className={u.restoredAt || u.dropped ? "muted" : undefined}>
                    <td>
                      {u.source === "ondeck" ? "📋 NVBC On Deck"
                        : u.source === "desk" ? "✓ Marked redeemed"
                        : <button type="button" className="link-btn mono" onClick={() => onOpenBooking(u.bookingCode)}>{u.bookingCode}</button>}
                    </td>
                    <td>
                      {u.source === "booking" ? <>{u.court ?? "—"}{u.date ? ` · ${formatDateLong(u.date)}` : ""}</> : u.details || "—"}
                    </td>
                    <td>{useTook(u)}</td>
                    <td>{new Date(u.usedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })} · {u.usedBy}</td>
                    <td>
                      {u.dropped ? "Full price charged (booking restored)"
                        : !u.restoredAt ? ""
                        : u.source === "ondeck" ? "Given back (undone at On Deck)"
                        : u.source === "desk" ? "Given back (redeemed undone)"
                        : u.removed ? "Given back (removed by staff)" : "Given back (booking cancelled)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="stack">
        <h3 style={{ margin: 0 }}>History</h3>
        <ul className="voucher-history">
          {data.events.map((e, i) => (
            <li key={i}>
              <span className="muted">{new Date(e.at).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</span>{" "}
              <strong>{e.action}</strong> by {e.actor}{e.details ? ` — ${e.details}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
