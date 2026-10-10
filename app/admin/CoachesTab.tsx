"use client";

import { useCallback, useEffect, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import { availabilityText, genderText, initials, type AvailabilitySlot, type Gender } from "@/lib/coach";
import { formatDateLong, formatRange } from "@/lib/format";
import { sportEmoji, sportLabel } from "@/lib/sports";
import ProofViewer from "./ProofViewer";
import { api, todayManila } from "./shared";

type AdminCoach = {
  id: string; full_name: string; nickname: string; gender: Gender | ""; gender_self: string; birthday: string | null;
  credentials: string; bio: string; email: string; mobile: string; phpa_id: string; has_phpa_photo: boolean; has_photo: boolean;
  sports: string[]; rates: string; availability: AvailabilitySlot[]; status: "pending" | "active" | "inactive" | "rejected";
  coach_code: string | null; staff_notes: string; created_at: string; approved_at: string | null; approved_by: string | null;
  status_by: string | null; last_login_at: string | null; upcoming: number; past: number; sessions: number; misuse: number; requests: number;
};
type CoachBooking = {
  id: string; code: string; date: string; start_hour: number; end_hour: number; court_name: string; sport: string; status: string;
  kind: "own" | "coaching"; customer_name: string | null; coaching_status: string | null; misuse: boolean;
};

const STATUS_LABEL = { pending: "Waiting for approval", active: "Active", inactive: "Inactive", rejected: "Rejected" } as const;
const FILTERS = [["all", "All coaches"], ["pending", "Waiting for approval"], ["active", "Active"], ["inactive", "Inactive"], ["rejected", "Rejected"]] as const;
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }) : "—";

/** Owner/managers: coaches — approve, activate / deactivate, codes, and each coach's bookings. */
export default function CoachesTab({ onAuthError }: { onAuthError: (e: unknown) => void }) {
  const [data, setData] = useState<{ coaches: AdminCoach[]; signupUrl: string; sharedCode: { set: boolean; enabled: boolean } } | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api("/api/admin/coaches"));
      setError("");
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't load coaches.");
    }
  }, [onAuthError]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(body: Record<string, unknown>, done?: string) {
    setError("");
    setNotice("");
    try {
      const r = await api<Record<string, unknown>>("/api/admin/coaches", body);
      if (done) setNotice(done);
      await load();
      return r;
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't save.");
      return null;
    }
  }

  if (!data) return error ? <div className="error">{error}</div> : <FullScreenLoader label="Loading coaches…" />;
  const q = search.trim().toLowerCase();
  const list = data.coaches.filter((c) => (filter === "all" || c.status === filter) && (!q || [c.full_name, c.nickname, c.email, c.mobile, c.coach_code ?? ""].some((v) => v.toLowerCase().includes(q))));
  const waiting = data.coaches.filter((c) => c.status === "pending").length;

  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 10 }}>
        <strong>Coach sign-up link</strong>
        <p className="hint" style={{ margin: 0 }}>
          Send this to coaches. They create their account (details, photo, PHPA ID, rates, availability, password) and wait for
          you to approve them here. Making a new link stops the old one working.
        </p>
        <div className="signup-link">
          <input readOnly value={data.signupUrl} aria-label="Coach sign-up link" onFocus={(e) => e.target.select()} />
          <button type="button" className="btn small" onClick={async () => {
            try { await navigator.clipboard.writeText(data.signupUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select and copy by hand */ }
          }}>{copied ? "Copied ✓" : "Copy"}</button>
          <button type="button" className="btn small secondary" onClick={() =>
            window.confirm("Make a new sign-up link? The current link stops working.") && act({ action: "new-signup-link" }, "New sign-up link made.")}>New link</button>
        </div>
        {data.sharedCode.set && (
          <label className="check-row">
            <input type="checkbox" checked={data.sharedCode.enabled}
              onChange={(e) => act({ action: "shared-code", enabled: e.target.checked }, e.target.checked ? "The shared coach code works again." : "The shared coach code is off — coaches use their own codes.")} />
            <span>The old <strong>shared coach code</strong> (Settings) still works. Turn this off once your coaches have their own codes.</span>
          </label>
        )}
      </div>

      {notice && <div className="success">{notice}</div>}
      {error && <div className="error">{error}</div>}

      <div className="list-controls">
        <input type="search" placeholder="Search coaches" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ width: "auto" }}>
          {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}{v === "pending" && waiting ? ` (${waiting})` : ""}</option>)}
        </select>
      </div>

      {list.length === 0 && <p className="muted">{data.coaches.length ? "No coaches match." : "No coaches yet — send them the sign-up link above."}</p>}
      <div className="bk-list">
        {list.map((c) => (
          <div key={c.id} className={`coach-row-wrap${open === c.id ? " open" : ""}`}>
            <button type="button" className="coach-row" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.has_photo ? <img src={`/api/coaches/photo?id=${c.id}`} alt="" /> : <span className="coach-row-ph coach-initials">{initials(c.nickname || c.full_name)}</span>}
              <span className="coach-row-main">
                <strong>{c.nickname || c.full_name}{c.nickname && <span className="muted" style={{ fontWeight: 400 }}> · {c.full_name}</span>}</strong>
                <small>{c.sports.map((s) => sportEmoji(s)).join(" ")} {c.mobile}{c.coach_code ? ` · ${c.coach_code}` : ""}</small>
                <small>
                  {c.upcoming} upcoming · {c.past} past · {c.sessions} sessions
                  {c.requests ? ` · ${c.requests} request${c.requests > 1 ? "s" : ""} waiting` : ""}
                  {c.misuse ? ` · ⚠ code misused ${c.misuse}×` : ""}
                </small>
              </span>
              <span className={`badge ${c.status === "active" ? "" : c.status === "pending" ? "pending" : "grey"}`}>{STATUS_LABEL[c.status]}</span>
            </button>
            {open === c.id && <CoachDetail c={c} act={act} onAuthError={onAuthError} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function CoachDetail({ c, act, onAuthError }: {
  c: AdminCoach; act: (b: Record<string, unknown>, done?: string) => Promise<Record<string, unknown> | null>; onAuthError: (e: unknown) => void;
}) {
  const [bookings, setBookings] = useState<CoachBooking[] | null>(null);
  const [notes, setNotes] = useState(c.staff_notes);
  const [resetUrl, setResetUrl] = useState("");
  useEffect(() => {
    api<{ bookings: CoachBooking[] }>(`/api/admin/coaches?coach=${c.id}`).then((r) => setBookings(r.bookings)).catch((e) => { onAuthError(e); setBookings([]); });
  }, [c.id, onAuthError]);
  const today = todayManila();
  const upcoming = (bookings ?? []).filter((b) => b.date >= today && b.status !== "cancelled").sort((a, b) => a.date.localeCompare(b.date) || a.start_hour - b.start_hour);
  const past = (bookings ?? []).filter((b) => !upcoming.includes(b));
  const status = (to: string, msg: string, confirm?: string) => (!confirm || window.confirm(confirm)) && act({ action: "status", id: c.id, to }, msg);

  return (
    <div className="coach-detail stack">
      <div className="card-actions" style={{ marginTop: 0 }}>
        {c.status === "pending" && (
          <>
            <button type="button" className="btn small" onClick={() => status("approve", `${c.full_name} is approved — their code was emailed to them.`)}>✓ Approve</button>
            <button type="button" className="btn small secondary danger-text" onClick={() => status("reject", `${c.full_name}'s application was declined.`, `Decline ${c.full_name}'s application? They won't be able to log in.`)}>Decline</button>
          </>
        )}
        {c.status === "active" && (
          <button type="button" className="btn small secondary" onClick={() => status("deactivate", `${c.full_name} is inactive — their code no longer works.`, `Set ${c.full_name} inactive? Their coach code stops working (no coach rate, no cash at the desk) and customers can't request them.`)}>Set inactive</button>
        )}
        {(c.status === "inactive" || c.status === "rejected") && (
          <button type="button" className="btn small" onClick={() => status("activate", `${c.full_name} is active.`)}>Set active</button>
        )}
        {c.coach_code && (
          <button type="button" className="btn small secondary" onClick={() => status("new-code", `${c.full_name} has a new code (emailed to them). The old one no longer works.`, `Give ${c.full_name} a new coach code? The old code stops working straight away — use this if it was shared with others.`)}>New code</button>
        )}
        <button type="button" className="btn small secondary" onClick={async () => {
          const r = await act({ action: "reset-link", id: c.id });
          if (r?.url) setResetUrl(String(r.url));
        }}>Password reset link</button>
      </div>
      {resetUrl && (
        <div className="notice info">Send this one-time link to {c.full_name} (valid for 3 days): <span className="mono" style={{ wordBreak: "break-all" }}>{resetUrl}</span></div>
      )}
      <dl className="member-details">
        <div><dt>Legal name</dt><dd>{c.full_name}</dd></div>
        <div><dt>Shown as</dt><dd>{c.nickname || "—"}</dd></div>
        <div><dt>Gender</dt><dd>{c.gender ? genderText(c.gender, c.gender_self) : "—"}</dd></div>
        <div><dt>Birthday</dt><dd>{c.birthday ? formatDateLong(c.birthday) : "—"}</dd></div>
        <div><dt>Email</dt><dd>{c.email}</dd></div>
        <div><dt>Mobile</dt><dd>{c.mobile}</dd></div>
        <div><dt>PHPA ID</dt><dd>{c.phpa_id || "—"}{c.has_phpa_photo && <> · <ProofViewer src={`/api/coaches/photo?id=${c.id}&kind=id`} alt={`${c.full_name}'s PHPA ID`} className="link-btn">📷 ID photo</ProofViewer></>}</dd></div>
        <div><dt>Coaches</dt><dd>{c.sports.map((s) => `${sportEmoji(s)} ${sportLabel(s)}`).join(", ")}</dd></div>
        <div><dt>Available</dt><dd>{availabilityText(c.availability)}</dd></div>
        <div><dt>Rates</dt><dd style={{ whiteSpace: "pre-wrap" }}>{c.rates}</dd></div>
        <div><dt>Credentials</dt><dd style={{ whiteSpace: "pre-wrap" }}>{c.credentials || "—"}</dd></div>
        <div><dt>Bio</dt><dd style={{ whiteSpace: "pre-wrap" }}>{c.bio || "—"}</dd></div>
        <div><dt>Joined</dt><dd>{shortDate(c.created_at)}{c.approved_by ? ` · approved by ${c.approved_by} ${shortDate(c.approved_at)}` : ""}</dd></div>
        <div><dt>Last login</dt><dd>{shortDate(c.last_login_at)}</dd></div>
      </dl>
      <div className="field">
        <label htmlFor={`cn-${c.id}`}>Staff notes <span className="hint">(only staff see these)</span></label>
        <textarea id={`cn-${c.id}`} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== c.staff_notes && act({ action: "notes", id: c.id, notes }, "Notes saved.")} />
      </div>
      <div>
        <strong>Upcoming ({upcoming.length})</strong>
        {bookings === null ? <p className="hint">Loading…</p> : <CoachBookingList list={upcoming} />}
      </div>
      {past.length > 0 && (
        <details className="bk-gone">
          <summary>Past and cancelled ({past.length})</summary>
          <CoachBookingList list={past} />
        </details>
      )}
    </div>
  );
}

function CoachBookingList({ list }: { list: CoachBooking[] }) {
  if (!list.length) return <p className="hint" style={{ margin: "4px 0" }}>None.</p>;
  return (
    <ul className="coach-bk-list">
      {list.map((b) => (
        <li key={b.id}>
          <span className="mono">{b.code}</span> · {formatDateLong(b.date)} {formatRange(b.start_hour, b.end_hour)} · {sportEmoji(b.sport)} {b.court_name} ·{" "}
          {b.kind === "own" ? "Booked with their code" : `Coaching ${b.customer_name} (${b.coaching_status})`}
          {b.status === "cancelled" && " · cancelled"}
          {b.misuse && " · ⚠ code misuse"}
        </li>
      ))}
    </ul>
  );
}
