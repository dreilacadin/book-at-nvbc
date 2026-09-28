"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ageOn, membershipState, membershipStateLabel, memberTypeLabel } from "@/lib/membership";
import { formatPeso, PAYMENT_STATUSES, paymentLabel, type PaymentStatus } from "@/lib/pricing";
import { sportLabel } from "@/lib/sports";
import QrScanner from "./QrScanner";
import { api, todayManila, type AdminMember } from "./shared";

type Filter = "action" | "active" | "expired" | "rejected" | "all";

const niceDate = (d: string | null) =>
  d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Staff: scan or look up a member, and approve / manage applications. */
export default function MembersTab({ onAuthError }: { onAuthError: (e: unknown) => void }) {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [filter, setFilter] = useState<Filter>("action");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const today = todayManila();

  const load = useCallback(async () => {
    try {
      setMembers((await api<{ members: AdminMember[] }>("/api/admin/members")).members);
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

  async function act(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await api("/api/admin/members", body);
      setError("");
      load();
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  const stateOf = (m: AdminMember) => membershipState(m, today);
  const counts = {
    pending: members.filter((m) => stateOf(m) === "pending").length,
    verify: members.filter((m) => stateOf(m) === "pending" && m.payment_status === "for_verification").length,
    ready: members.filter((m) => stateOf(m) === "pending" && (m.payment_status === "paid" || m.payment_status === "waived")).length,
    active: members.filter((m) => stateOf(m) === "active").length,
    expiring: members.filter((m) => stateOf(m) === "active" && m.expires_on && daysBetween(today, m.expires_on) <= 30).length,
  };
  const q = search.trim().toLowerCase();
  const shown = members.filter((m) => {
    const st = stateOf(m);
    if (filter === "action" && st !== "pending") return false;
    if (filter !== "action" && filter !== "all" && st !== filter) return false;
    return !q || [m.full_name, m.email, m.mobile, m.member_code ?? ""].some((v) => v.toLowerCase().includes(q));
  });

  return (
    <div className="stack">
      <MemberLookup today={today} onAuthError={onAuthError} onRenew={(m) => act({ action: "renew", id: m.id }, renewText(m, today))} />

      <div className="stats">
        <button type="button" className="stat" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setFilter("action")}>
          <div className="n">{counts.pending}</div>
          <div className="l">pending{counts.verify ? ` · ${counts.verify} to verify` : ""}{counts.ready ? ` · ${counts.ready} ready to approve` : ""}</div>
        </button>
        <button type="button" className="stat" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setFilter("active")}>
          <div className="n">{counts.active}</div>
          <div className="l">active members{counts.expiring ? ` · ${counts.expiring} expire within 30 days` : ""}</div>
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} style={{ width: "auto" }}>
          <option value="action">Pending applications</option>
          <option value="active">Active members</option>
          <option value="expired">Expired</option>
          <option value="rejected">Not approved</option>
          <option value="all">Everyone</option>
        </select>
        <input type="text" placeholder="Search name, email, mobile or code" value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card table-wrap" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 16 }}>Loading…</p>
        ) : shown.length === 0 ? (
          <p className="muted" style={{ padding: 16 }}>Nobody here.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
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
                    <tr>
                      <td>
                        <button type="button" className="link-btn" style={{ fontSize: 15, padding: 0, textDecoration: "none", fontWeight: 600, color: "var(--text)" }}
                          onClick={() => setOpen(open === m.id ? null : m.id)}>
                          {m.full_name} {open === m.id ? "▾" : "▸"}
                        </button>
                        <div className="muted" style={{ fontSize: 13 }}>{m.mobile} · {m.email}</div>
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
                        {m.expires_on && st !== "pending" && (
                          <div className="muted" style={{ fontSize: 12 }}>{st === "expired" ? "Expired" : "Expires"} {niceDate(m.expires_on)}</div>
                        )}
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
                          {(st === "active" || st === "expired") && (
                            <button className="btn small secondary" onClick={() => act({ action: "renew", id: m.id }, renewText(m, today))}>
                              Renew
                            </button>
                          )}
                          {st === "rejected" && (
                            <button className="btn small secondary danger-text"
                              onClick={() => act({ action: "delete", id: m.id }, `Permanently delete ${m.full_name}'s declined application?`)}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {open === m.id && (
                      <tr className="edit-row">
                        <td colSpan={5}><MemberDetails m={m} today={today} /></td>
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
  const early = m.expires_on && m.expires_on > today;
  return `Renew ${m.full_name}'s membership for another 365 days${early ? ` (added after it ends on ${niceDate(m.expires_on)})` : " starting today"}? Collect the ${memberTypeLabel(m.member_type).toLowerCase()} fee first.`;
}

/** Scan (USB/Bluetooth scanner or camera) or type a member code to check a membership. */
function MemberLookup({
  today,
  onAuthError,
  onRenew,
}: {
  today: string;
  onAuthError: (e: unknown) => void;
  onRenew: (m: AdminMember) => void;
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
              <strong>{st === "active" ? "Active member" : st === "expired" ? "Membership expired" : membershipStateLabel(st)}</strong>
              <div>
                {st === "active" && daysLeft !== null && `Valid until ${niceDate(result.expires_on)} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                {st === "expired" && `Expired ${niceDate(result.expires_on)}`}
              </div>
            </div>
            {(st === "active" || st === "expired") && (
              <button className="btn small secondary" style={{ marginLeft: "auto" }}
                onClick={async () => { onRenew(result); setTimeout(() => lookup(result.member_code ?? ""), 800); }}>
                Renew
              </button>
            )}
          </div>
          <MemberDetails m={result} today={today} />
        </div>
      )}
      {camera && <QrScanner onCode={fromCamera} onClose={() => setCamera(false)} />}
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
    ["Birthdate", `${niceDate(m.birthdate)} (age ${ageOn(m.birthdate, today)})${m.gender ? ` · ${m.gender}` : ""}`],
    ["Mobile", <a key="t" href={`tel:${m.mobile}`}>{m.mobile}</a>],
    ["Email", <a key="e" href={`mailto:${m.email}`}>{m.email}</a>],
    ["Address", m.address],
  ];
  if (m.member_type === "student") rows.push(["School", `${m.school} · ID ${m.student_id}`]);
  if (m.sports.length) rows.push(["Plays", m.sports.map(sportLabel).join(", ")]);
  rows.push(["Emergency contact", `${m.emergency_name} · ${m.emergency_mobile}`]);
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
