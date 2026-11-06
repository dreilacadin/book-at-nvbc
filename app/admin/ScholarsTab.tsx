"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ageOn } from "@/lib/membership";
import { SCHOLAR_BATCHES, scholarBatchLabel, scholarBatchWhen, SCHOLAR_SPORTS, scholarSportLabel, SCHOLAR_STATUSES, type ScholarStatus } from "@/lib/scholar";
import type { ScholarRecord } from "@/lib/scholars";
import { api, todayManila } from "./shared";

const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="scholar-line"><span className="muted">{label}</span><span>{children}</span></div>;
}

function ConsentBadge({ a }: { a: ScholarRecord }) {
  if (!a.consent_required) return <span className="badge grey">18+ · no guardian needed</span>;
  if (a.consent_at) return <span className="badge member-active">Consent signed</span>;
  return <span className="badge member-pending">Waiting for consent</span>;
}

/** Owner and managers: applications to be an NVBC Scholar. They hold minors' health details, so staff accounts don't get this tab. */
export default function ScholarsTab({ onAuthError }: { onAuthError: (e: unknown) => void }) {
  const [apps, setApps] = useState<ScholarRecord[] | null>(null);
  const [sport, setSport] = useState("");
  const [batch, setBatch] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setApps((await api<{ applications: ScholarRecord[] }>("/api/admin/scholars")).applications);
      setError("");
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [onAuthError]);

  useEffect(() => {
    // Loads on opening the tab, and setState happens after the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const shown = useMemo(() => (apps ?? []).filter((a) => (!sport || a.sport === sport) && (!batch || a.batch === batch)), [apps, sport, batch]);
  const count = (s: string) => (apps ?? []).filter((a) => a.sport === s).length;

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0 }}>Scholar applications</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          From <a href="/scholars" target="_blank">/scholars</a>. Only the owner and managers can see these. Before selecting an applicant under 18,
          call their guardian to confirm the consent. Delete applications when you no longer need them.
        </p>
        <p style={{ margin: "0 0 12px" }}><strong>{apps?.length ?? "…"}</strong> applications: {SCHOLAR_SPORTS.map((s) => `${count(s.id)} ${s.label.toLowerCase()}`).join(", ")}</p>
        <div className="row">
          <div>
            <label htmlFor="sf-sport">Sport</label>
            <select id="sf-sport" value={sport} onChange={(e) => setSport(e.target.value)}>
              <option value="">All sports</option>
              {SCHOLAR_SPORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="sf-batch">Batch</label>
            <select id="sf-batch" value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="">All batches</option>
              {SCHOLAR_BATCHES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
        </div>
      </div>
      {error && <div className="error" style={{ marginBottom: 14 }}>{error}</div>}
      {apps && shown.length === 0 && <p className="muted">No applications yet.</p>}
      {shown.map((a) => <ApplicationCard key={a.id} a={a} onChanged={load} onAuthError={onAuthError} />)}
    </div>
  );
}

function ApplicationCard({ a, onChanged, onAuthError }: { a: ScholarRecord; onChanged: () => Promise<void>; onAuthError: (e: unknown) => void }) {
  const [status, setStatus] = useState<ScholarStatus>(a.status);
  const [notes, setNotes] = useState(a.staff_notes);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const dirty = status !== a.status || notes !== a.staff_notes;

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await api("/api/admin/scholars", { id: a.id, ...body });
      await onChanged();
    } catch (e) {
      onAuthError(e);
      setMessage(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/scholars/consent/${a.token}`);
    setCopied(true);
  }

  return (
    <details className="card scholar-card">
      <summary>
        <strong>{a.full_name}</strong> <span className="muted">({ageOn(a.birthdate, todayManila())})</span>
        <span className="scholar-card-sub muted">{scholarSportLabel(a.sport)} · {scholarBatchLabel(a.batch)} · {a.school}</span>
        <span className="scholar-card-badges">
          <ConsentBadge a={a} />
          {a.status !== "received" && <span className="badge">{SCHOLAR_STATUSES.find((s) => s.id === a.status)?.label}</span>}
        </span>
      </summary>

      <h3>Applicant</h3>
      <Line label="Date of birth">{a.birthdate}</Line>
      <Line label="Mobile"><a href={`tel:${a.mobile}`}>{a.mobile}</a></Line>
      <Line label="Facebook">{a.facebook_name}</Line>
      <Line label="Address">{a.address}</Line>
      <Line label="School">{a.school}, {a.year_level}</Line>
      <Line label="Applied">{when(a.created_at)}</Line>

      <h3>Tryout</h3>
      <Line label="Batch">{scholarBatchLabel(a.batch)}: {scholarBatchWhen(a.batch)}</Line>
      <Line label="Playing for">{a.years_playing}</Line>
      {a.experience && <Line label="Experience"><span className="scholar-text">{a.experience}</span></Line>}
      <Line label="Free on">{a.availability.map((s) => s.replace("-", " ")).join(", ")}</Line>

      <h3>Why them</h3>
      <Line label="Good fit"><span className="scholar-text">{a.why_fit}</span></Line>
      <Line label="Helped out"><span className="scholar-text">{a.initiative}</span></Line>

      <h3>Emergency and health</h3>
      <Line label="Contact">{a.emergency_name}, <a href={`tel:${a.emergency_mobile}`}>{a.emergency_mobile}</a></Line>
      <Line label="Health"><span className="scholar-text">{a.medical}</span></Line>
      <Line label="Photos and videos">{a.photo_consent === "yes" ? "Allowed" : a.photo_consent === "no" ? "Not allowed" : "Not answered yet"}</Line>

      {a.consent_required && (
        <>
          <h3>Parent or guardian</h3>
          {a.consent_at ? (
            <>
              <Line label="Name">{a.guardian_name} ({a.guardian_relationship})</Line>
              <Line label="Mobile"><a href={`tel:${a.guardian_mobile}`}>{a.guardian_mobile}</a></Line>
              {a.guardian_notes && <Line label="Health notes"><span className="scholar-text">{a.guardian_notes}</span></Line>}
              <Line label="Signed">&ldquo;{a.consent_signature}&rdquo;, {when(a.consent_at)}</Line>
            </>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>Not signed yet. If it was signed on paper, add that to the notes below.</p>
              <button className="btn secondary small" type="button" onClick={copyLink}>{copied ? "Copied!" : "Copy consent link"}</button>
            </>
          )}
        </>
      )}

      <h3>NVBC</h3>
      <div className="field">
        <label htmlFor={`st-${a.id}`}>Status</label>
        <select id={`st-${a.id}`} value={status} onChange={(e) => setStatus(e.target.value as ScholarStatus)}>
          {SCHOLAR_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`no-${a.id}`}>Notes <span className="hint">(tryout notes, paper consent…)</span></label>
        <textarea id={`no-${a.id}`} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {message && <div className="error" style={{ marginTop: 10 }}>{message}</div>}
      <div className="actions">
        <button className="btn secondary danger-text" type="button" disabled={busy}
          onClick={() => window.confirm(`Delete ${a.full_name}'s application? This can't be undone.`) && act({ action: "delete" })}>Delete</button>
        <button className="btn" type="button" disabled={busy || !dirty} onClick={() => act({ action: "update", status, notes })}>Save</button>
      </div>
    </details>
  );
}
