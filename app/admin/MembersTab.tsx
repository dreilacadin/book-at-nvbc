"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ageOn, membershipState, membershipStateLabel, memberTypeLabel } from "@/lib/membership";
import { formatPeso, PAYMENT_STATUSES, paymentLabel, type PaymentStatus } from "@/lib/pricing";
import { sportLabel } from "@/lib/sports";
import EmailReminders, { type EmailStatus } from "./EmailReminders";
import EditMember from "./EditMember";
import ImportMembers from "./ImportMembers";
import QrScanner from "./QrScanner";
import { api, todayManila, type AdminMember } from "./shared";
import FullScreenLoader from "@/components/FullScreenLoader";

type Filter = "action" | "active" | "expired" | "forfeited" | "rejected" | "all";
type Act = (body: Record<string, unknown>, confirmText?: string) => Promise<boolean>;

const niceDate = (d: string | null) =>
  d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Staff: scan or look up a member, and approve / manage applications. */
export default function MembersTab({ onAuthError }: { onAuthError: (e: unknown) => void }) {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [filter, setFilter] = useState<Filter>("action");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // Expired list: tick to mark reminded
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const today = todayManila();

  const load = useCallback(async () => {
    try {
      const r = await api<{ members: AdminMember[]; email: EmailStatus }>("/api/admin/members");
      setMembers(r.members);
      setEmail(r.email);
      setError("");
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  const act: Act = async (body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return false;
    try {
      await api("/api/admin/members", body);
      setError("");
      load();
      return true;
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Action failed");
      return false;
    }
  };

  const stateOf = (m: AdminMember) => membershipState(m, today);
  const counts = {
    pending: members.filter((m) => stateOf(m) === "pending").length,
    verify: members.filter((m) => stateOf(m) === "pending" && m.payment_status === "for_verification").length,
    ready: members.filter((m) => stateOf(m) === "pending" && (m.payment_status === "paid" || m.payment_status === "waived")).length,
    active: members.filter((m) => stateOf(m) === "active").length,
    expiring: members.filter((m) => stateOf(m) === "active" && m.expires_on && daysBetween(today, m.expires_on) <= 30).length,
    expired: members.filter((m) => stateOf(m) === "expired").length,
    notReminded: members.filter((m) => stateOf(m) === "expired" && !m.reminded_on).length,
  };
  const q = search.trim().toLowerCase();
  const shown = members
    .filter((m) => {
      const st = stateOf(m);
      if (filter === "action" && st !== "pending") return false;
      if (filter !== "action" && filter !== "all" && st !== filter) return false;
      return !q || [m.full_name, m.email, m.mobile, m.member_code ?? ""].some((v) => v.toLowerCase().includes(q));
    })
    // Expired list: not yet reminded first, then longest expired first.
    .sort((a, b) =>
      filter === "expired" ? Number(!!a.reminded_on) - Number(!!b.reminded_on) || (a.expires_on ?? "").localeCompare(b.expires_on ?? "") : 0
    );

  // Expired list: select members to mark as reminded (e.g. everyone already emailed).
  const bulk = filter === "expired";
  const picked = shown.filter((m) => selected.has(m.id));
  const notReminded = shown.filter((m) => !m.reminded_on);
  const emailedNotMarked = notReminded.filter((m) => m.emailed_on);

  return (
    <div className="stack">
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        <button className="btn small secondary" onClick={() => { setEmailing((v) => !v); setImporting(false); }}>
          {emailing ? "Close emails" : `✉ Email expired members${counts.expired ? ` (${counts.expired})` : ""}`}
        </button>
        <button className="btn small secondary" onClick={() => { setImporting((v) => !v); setEmailing(false); }}>
          {importing ? "Close import" : "⬆ Import existing members"}
        </button>
      </div>
      {importing && <ImportMembers onDone={load} onAuthError={onAuthError} />}
      {emailing && (
        <EmailReminders
          expired={members.filter((m) => stateOf(m) === "expired").sort((a, b) => (a.expires_on ?? "").localeCompare(b.expires_on ?? ""))}
          email={email}
          onSent={load}
          onAuthError={onAuthError}
        />
      )}

      <MemberLookup today={today} onAuthError={onAuthError} act={act} onChanged={load} />

      <div className="stats">
        <button type="button" className="stat" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setFilter("action")}>
          <div className="n">{counts.pending}</div>
          <div className="l">pending{counts.verify ? ` · ${counts.verify} to verify` : ""}{counts.ready ? ` · ${counts.ready} ready to approve` : ""}</div>
        </button>
        <button type="button" className="stat" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setFilter("active")}>
          <div className="n">{counts.active}</div>
          <div className="l">active members{counts.expiring ? ` · ${counts.expiring} expire within 30 days` : ""}</div>
        </button>
        <button type="button" className="stat" style={{ textAlign: "left", cursor: "pointer", borderColor: counts.notReminded ? "#e0a800" : undefined }}
          onClick={() => setFilter("expired")}>
          <div className="n">{counts.expired}</div>
          <div className="l">expired — remind to renew or forfeit{counts.notReminded ? ` · ${counts.notReminded} not reminded yet` : ""}</div>
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select aria-label="Show" value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setSelected(new Set()); }} style={{ width: "auto" }}>
          <option value="action">Pending applications</option>
          <option value="active">Active members</option>
          <option value="expired">Expired — remind to renew or forfeit</option>
          <option value="forfeited">Forfeited</option>
          <option value="rejected">Not approved</option>
          <option value="all">Everyone</option>
        </select>
        <input type="text" placeholder="Search name, email, mobile or code" value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
      </div>

      {error && <div className="error">{error}</div>}

      {bulk && shown.length > 0 && (
        <div className="checklist-bar remind-bar">
          <span><strong>{picked.length}</strong> selected</span>
          <button type="button" className="btn small secondary" disabled={!emailedNotMarked.length}
            onClick={() => setSelected(new Set(emailedNotMarked.map((m) => m.id)))}>
            ✉ Emailed, not marked yet ({emailedNotMarked.length})
          </button>
          <button type="button" className="btn small secondary" disabled={!notReminded.length}
            onClick={() => setSelected(new Set(notReminded.map((m) => m.id)))}>
            All not reminded ({notReminded.length})
          </button>
          {picked.length > 0 && <button type="button" className="btn small secondary" onClick={() => setSelected(new Set())}>Clear</button>}
          <button type="button" className="btn small" style={{ marginLeft: "auto" }} disabled={!picked.length}
            onClick={async () => {
              if (await act({ action: "remind", ids: picked.map((m) => m.id) },
                `Mark ${picked.length} member${picked.length === 1 ? "" : "s"} as reminded to renew or forfeit?`)) setSelected(new Set());
            }}>
            ✓ Mark {picked.length || ""} reminded
          </button>
        </div>
      )}

      <div className="card table-wrap" style={{ padding: 0 }}>
        {loading && <FullScreenLoader label="Loading members…" />}
        {loading ? null : shown.length === 0 ? (
          <p className="muted" style={{ padding: 16 }}>Nobody here.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                {bulk && (
                  <th style={{ width: 36 }}>
                    <input type="checkbox" aria-label="Select everyone shown"
                      checked={picked.length > 0 && picked.length === shown.length}
                      ref={(el) => { if (el) el.indeterminate = picked.length > 0 && picked.length < shown.length; }}
                      onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((m) => m.id)) : new Set())} />
                  </th>
                )}
                <th>Name</th>
                <th>Type</th>
                <th>Fee / payment</th>
                <th>Membership</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const st = stateOf(m);
                const paid = m.payment_status === "paid" || m.payment_status === "waived";
                return (
                  <Fragment key={m.id}>
                    <tr className={bulk && selected.has(m.id) ? "row-picked" : undefined}>
                      {bulk && (
                        <td>
                          <input type="checkbox" aria-label={`Select ${m.full_name}`} checked={selected.has(m.id)}
                            onChange={(e) => setSelected((cur) => { const n = new Set(cur); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n; })} />
                        </td>
                      )}
                      <td>
                        <button type="button" className="link-btn" style={{ fontSize: 15, padding: 0, textDecoration: "none", fontWeight: 600, color: "var(--text)" }}
                          onClick={() => setOpen(open === m.id ? null : m.id)}>
                          {m.full_name} {open === m.id ? "▾" : "▸"}
                        </button>
                        <div className="muted" style={{ fontSize: 13 }}>{[m.mobile, m.email].filter(Boolean).join(" · ")}</div>
                        <div className="muted" style={{ fontSize: 12 }}>Applied {niceDate(m.created_at.slice(0, 10))}</div>
                      </td>
                      <td>{memberTypeLabel(m.member_type)}</td>
                      <td style={{ minWidth: 180 }}>
                        <div style={{ fontSize: 13, marginBottom: 4 }}>
                          {formatPeso(m.fee)} · {paymentLabel(m.payment_method)}
                          {m.payment_ref && <> · <span style={{ fontFamily: "ui-monospace, monospace" }}>{m.payment_ref}</span></>}
                          {m.has_proof && (
                            <> · <a href={`/api/admin/members/proof?id=${m.id}`} target="_blank" rel="noopener noreferrer">📷 Screenshot</a></>
                          )}
                        </div>
                        <select aria-label="Payment status" className={`pay-status ${m.payment_status}`} value={m.payment_status}
                          onChange={(e) => act({ action: "payment", id: m.id, status: e.target.value as PaymentStatus })}
                          style={{ width: "auto", border: 0, fontSize: 13, padding: "4px 8px" }}>
                          {PAYMENT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <span className={`badge member-${st}`}>{membershipStateLabel(st)}</span>
                        {m.member_code && <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, marginTop: 4 }}>{m.member_code}</div>}
                        {m.expires_on && (st === "active" || st === "expired") && (
                          <div className="muted" style={{ fontSize: 12 }}>{st === "expired" ? "Expired" : "Expires"} {niceDate(m.expires_on)}</div>
                        )}
                        {st === "expired" && (
                          <div style={{ fontSize: 12, fontWeight: 600 }}>
                            {m.reminded_on ? `Reminded ${niceDate(m.reminded_on)}` : "⚠ Not reminded yet"}
                          </div>
                        )}
                        {st === "expired" && m.emailed_on && (
                          <div className="muted" style={{ fontSize: 12 }}>✉ Emailed {niceDate(m.emailed_on)}</div>
                        )}
                        {st === "forfeited" && <div className="muted" style={{ fontSize: 12 }}>Forfeited {niceDate(m.forfeited_on)}</div>}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                          {st === "pending" && (
                            <>
                              <button className="btn small" disabled={!paid}
                                title={paid ? undefined : "Mark the fee Paid (or No charge) first"}
                                onClick={() => act({ action: "approve", id: m.id }, `Approve ${m.full_name} as an NVBC ${memberTypeLabel(m.member_type)} member for 365 days from today?`)}>
                                Approve
                              </button>
                              <button className="btn small secondary" onClick={() => {
                                const reason = window.prompt(`Decline ${m.full_name}'s application? Optional note (staff only):`, "");
                                if (reason !== null) act({ action: "reject", id: m.id, reason });
                              }}>
                                Decline
                              </button>
                            </>
                          )}
                          {(st === "active" || st === "expired" || st === "forfeited") && (
                            <button className={`btn small${st === "expired" ? "" : " secondary"}`} onClick={() => act({ action: "renew", id: m.id }, renewText(m, today))}>
                              {st === "forfeited" ? "Reactivate" : "Renew"}
                            </button>
                          )}
                          {st === "expired" && <ExpiredActions m={m} act={act} />}
                          {st === "rejected" && (
                            <button className="btn small secondary danger-text" onClick={() => deleteMember(m, act)}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {open === m.id && (
                      <tr className="edit-row">
                        <td colSpan={bulk ? 6 : 5}>
                          <MemberPanel m={m} today={today} act={act} onAuthError={onAuthError}
                            onChanged={() => load()} onDeleted={() => { setOpen(null); load(); }} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function renewText(m: AdminMember, today: string) {
  const early = m.status === "active" && m.expires_on && m.expires_on > today;
  const verb = m.status === "forfeited" ? "Reactivate" : "Renew";
  return `${verb} ${m.full_name}'s membership for 365 days${early ? ` (added after it ends on ${niceDate(m.expires_on)})` : " starting today"}? Collect the ${memberTypeLabel(m.member_type).toLowerCase()} fee first. They keep the same member code.`;
}

/** Expired: the member decides on their next visit — renew (button beside this), or forfeit. */
function ExpiredActions({ m, act }: { m: AdminMember; act: Act }) {
  return (
    <>
      <button className="btn small secondary danger-text" onClick={() => {
        const reason = window.prompt(
          `Forfeit ${m.full_name}'s membership? Their member code stops working. The front desk can reactivate it later.\n\nOptional note (staff only):`,
          ""
        );
        if (reason !== null) act({ action: "forfeit", id: m.id, reason });
      }}>
        Forfeit
      </button>
      {!m.reminded_on && (
        <button className="btn small secondary" title="They've been told to renew or forfeit" onClick={() => act({ action: "remind", id: m.id })}>
          Mark reminded
        </button>
      )}
    </>
  );
}

/** Scan (USB/Bluetooth scanner or camera) or type a member code to check a membership. */
function MemberLookup({
  today,
  onAuthError,
  act,
  onChanged,
}: {
  today: string;
  onAuthError: (e: unknown) => void;
  act: Act;
  onChanged: () => void; // reload the member list after an edit
}) {
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<AdminMember | null>(null);
  const [error, setError] = useState("");
  const [camera, setCamera] = useState(false);

  const lookup = useCallback(
    async (raw: string) => {
      if (!raw.trim()) return;
      setError("");
      try {
        setResult(await api<AdminMember>(`/api/admin/members?code=${encodeURIComponent(raw.trim())}`));
      } catch (e) {
        onAuthError(e);
        setResult(null);
        setError(e instanceof Error ? e.message : "Lookup failed");
      }
      setCode("");
      input.current?.focus(); // ready for the next scan
    },
    [onAuthError]
  );

  const fromCamera = useCallback(
    (text: string) => {
      setCamera(false);
      lookup(text);
    },
    [lookup]
  );

  const st = result && membershipState(result, today);
  const daysLeft = result?.expires_on ? daysBetween(today, result.expires_on) : null;

  return (
    <div className="card">
      <form onSubmit={(e) => { e.preventDefault(); lookup(code); }} className="lookup-bar">
        <input ref={input} type="text" autoFocus autoComplete="off" spellCheck={false} aria-label="Member code"
          placeholder="Scan member QR or type code (NVBC-XXXX-XXXX)" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn">Check</button>
        <button type="button" className="btn secondary" onClick={() => setCamera(true)}>📷 Camera</button>
      </form>
      <p className="hint" style={{ margin: "6px 0 0" }}>
        A USB or Bluetooth QR scanner types the code here automatically — click the box, then scan.
      </p>
      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      {result && st && (
        <div className={`lookup-result member-${st}`}>
          <div className="lookup-status">
            <span className="lookup-icon" aria-hidden="true">{st === "active" ? "✓" : st === "expired" ? "!" : "…"}</span>
            <div>
              <strong>
                {st === "active" ? "Active member" : st === "expired" ? "Membership expired" : st === "forfeited" ? "Membership forfeited" : membershipStateLabel(st)}
              </strong>
              <div>
                {st === "active" && daysLeft !== null && `Valid until ${niceDate(result.expires_on)} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                {st === "expired" && `Expired ${niceDate(result.expires_on)}${result.reminded_on ? ` · reminded ${niceDate(result.reminded_on)}` : ""}`}
                {st === "forfeited" && `Forfeited ${niceDate(result.forfeited_on)} — member rates don't apply`}
              </div>
            </div>
            {(st === "active" || st === "expired" || st === "forfeited") && (
              <div className="lookup-actions">
                <button className={`btn small${st === "active" ? " secondary" : ""}`}
                  onClick={async () => { if (await act({ action: "renew", id: result.id }, renewText(result, today))) lookup(result.member_code ?? ""); }}>
                  {st === "forfeited" ? "Reactivate" : "Renew"}
                </button>
                {st === "expired" && (
                  <ExpiredActions m={result} act={async (b, c) => { const ok = await act(b, c); if (ok) lookup(result.member_code ?? ""); return ok; }} />
                )}
              </div>
            )}
          </div>
          {st === "expired" && (
            <div className="notice" style={{ marginBottom: 12 }}>
              Ask {result.full_name.split(" ")[0]} whether they&apos;d like to <strong>renew</strong> ({formatPeso(result.fee)}) or{" "}
              <strong>forfeit</strong> their membership. Until then they book at the Regular rate.
            </div>
          )}
          <MemberPanel m={result} today={today} act={act} onAuthError={onAuthError}
            onChanged={(u) => { setResult(u); onChanged(); }} onDeleted={() => setResult(null)} />
        </div>
      )}
      {camera && <QrScanner onCode={fromCamera} onClose={() => setCamera(false)} />}
    </div>
  );
}

/** Asks for confirmation (typing DELETE for anyone beyond a declined application), then deletes. */
async function deleteMember(m: AdminMember, act: Act): Promise<boolean> {
  if (m.status === "rejected") return act({ action: "delete", id: m.id }, `Permanently delete ${m.full_name}'s declined application?`);
  const typed = window.prompt(
    `Permanently delete ${m.full_name}${m.member_code ? ` (${m.member_code})` : ""}?\n\n` +
      "Their member code and member page stop working, and this can't be undone. Their past bookings are kept.\n" +
      "If they're just not renewing, use Forfeit instead.\n\nType DELETE to confirm:"
  );
  if (typed === null) return false;
  if (typed.trim().toUpperCase() !== "DELETE") {
    window.alert("Not deleted — you need to type DELETE.");
    return false;
  }
  return act({ action: "delete", id: m.id });
}

/** A member's details, with Edit and Delete. */
function MemberPanel({
  m,
  today,
  act,
  onAuthError,
  onChanged,
  onDeleted,
}: {
  m: AdminMember;
  today: string;
  act: Act;
  onAuthError: (e: unknown) => void;
  onChanged: (updated: AdminMember) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <EditMember m={m} onAuthError={onAuthError} onClose={() => setEditing(false)}
        onSaved={(u) => { setEditing(false); onChanged(u); }} />
    );
  return (
    <div>
      <MemberDetails m={m} today={today} />
      <div className="actions" style={{ marginTop: 12, justifyContent: "flex-start" }}>
        <button type="button" className="btn small secondary" onClick={() => setEditing(true)}>✎ Edit details</button>
        <button type="button" className="btn small secondary danger-text" onClick={async () => { if (await deleteMember(m, act)) onDeleted(); }}>
          Delete member
        </button>
      </div>
    </div>
  );
}

function MemberDetails({ m, today }: { m: AdminMember; today: string }) {
  const rows: [string, React.ReactNode][] = [
    ["Name", <strong key="n">{m.full_name}</strong>],
    ["Member code", m.member_code ? <span style={{ fontFamily: "ui-monospace, monospace" }}>{m.member_code}</span> : "— (after approval)"],
    ["Type", `${memberTypeLabel(m.member_type)} · ${formatPeso(m.fee)}`],
    ["Member since", niceDate(m.member_since)],
    ["Current period", m.starts_on ? `${niceDate(m.starts_on)} – ${niceDate(m.expires_on)}` : "—"],
    ["Birthdate", m.birthdate ? `${niceDate(m.birthdate)} (age ${ageOn(m.birthdate, today)})${m.gender ? ` · ${m.gender}` : ""}` : "—"],
    ["Mobile", <a key="t" href={`tel:${m.mobile}`}>{m.mobile}</a>],
    ["Email", <a key="e" href={`mailto:${m.email}`}>{m.email}</a>],
    ["Address", m.address || "—"],
  ];
  if (m.member_type === "student") rows.push(["School", `${m.school} · ID ${m.student_id}`]);
  if (m.sports.length) rows.push(["Plays", m.sports.map(sportLabel).join(", ")]);
  rows.push(["Emergency contact", m.emergency_name || m.emergency_mobile ? `${m.emergency_name} · ${m.emergency_mobile}` : "—"]);
  if (m.staff_notes) rows.push(["Staff notes", <span key="s" style={{ whiteSpace: "pre-wrap" }}>{m.staff_notes}</span>]);
  if (m.status !== "rejected")
    rows.push(["Member's page", <a key="l" href={`/membership/${m.token}`} target="_blank" rel="noopener noreferrer">Open (to re-send their QR link)</a>]);

  return (
    <dl className="member-details">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
