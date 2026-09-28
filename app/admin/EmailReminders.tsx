"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPeso } from "@/lib/pricing";
import {
  DEFAULT_REMINDER_BODY,
  DEFAULT_REMINDER_SUBJECT,
  fillTemplate,
  niceLongDate,
  REMINDER_PLACEHOLDERS,
  type ReminderVars,
} from "@/lib/reminder-email";
import { api, todayManila, type AdminMember } from "./shared";

export type EmailStatus = { ready: true; from: string } | { ready: false };

type Outcome = { id: string; name: string; ok: boolean; error?: string };

const BATCH = 10; // matches the server's limit per request
const RECENT_DAYS = 14; // don't email the same person again this soon (unless ticked by hand)
const DRAFT_KEY = "nvbc_reminder_draft";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Common typos in sign-up sheets ("gmail.con", "gmial.com") — these bounce, so they start unticked.
const LIKELY_TYPO = /@(g?mial|gamil|gmai|gmal|gnail)\.|@(gmail|yahoo|hotmail|outlook|icloud|ymail)\.(con|cm|co|om|comm|cmo)$/i;

const shortDate = (d: string | null) =>
  d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }) : "";
const daysSince = (d: string, today: string) => Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000);

function varsFor(m: AdminMember): ReminderVars {
  return {
    first_name: m.full_name.split(" ")[0],
    name: m.full_name,
    expired_on: m.expires_on ? niceLongDate(m.expires_on) : "",
    fee: formatPeso(m.fee),
    member_code: m.member_code ?? "",
    member_page: `${location.origin}/membership/${m.token}`,
  };
}

/** Staff: email expired members a reminder to drop by and renew. */
export default function EmailReminders({
  expired,
  email,
  onSent,
  onAuthError,
}: {
  expired: AdminMember[];
  email: EmailStatus | null;
  onSent: () => void;
  onAuthError: (e: unknown) => void;
}) {
  const today = todayManila();
  const [subject, setSubject] = useState(DEFAULT_REMINDER_SUBJECT);
  const [body, setBody] = useState(DEFAULT_REMINDER_BODY);
  const canEmail = (m: AdminMember) => EMAIL.test(m.email);
  const recent = (m: AdminMember) => !!m.emailed_on && daysSince(m.emailed_on, today) < RECENT_DAYS;
  const typo = (m: AdminMember) => LIKELY_TYPO.test(m.email);
  const defaultPick = () => new Set(expired.filter((m) => canEmail(m) && !recent(m) && !typo(m)).map((m) => m.id));
  const [picked, setPicked] = useState<Set<string>>(defaultPick);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Remember an edited message in this browser.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
      if (saved?.subject && saved?.body) {
        setSubject(saved.subject);
        setBody(saved.body);
      }
    } catch {
      /* no saved draft */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ subject, body }));
    } catch {
      /* storage unavailable */
    }
  }, [subject, body]);

  const chosen = expired.filter((m) => picked.has(m.id));
  const preview = expired.find((m) => m.id === previewId) ?? chosen[0] ?? expired.find(canEmail);
  const filled = useMemo(() => (preview ? { subject: fillTemplate(subject, varsFor(preview)), body: fillTemplate(body, varsFor(preview)) } : null), [preview, subject, body]);
  const unknownTags = [...new Set((subject + body).match(/\{(\w+)\}/g) ?? [])].filter(
    (t) => !REMINDER_PLACEHOLDERS.some((p) => `{${p.key}}` === t)
  );

  if (!email?.ready)
    return (
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Email reminders — set up first</h2>
        <p style={{ margin: 0 }}>Reminders are sent from a Gmail account. It takes about 5 minutes, once:</p>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>Sign in to the Gmail account → <strong>Google Account → Security</strong> → turn on <strong>2-Step Verification</strong>.</li>
          <li>Search for <strong>App passwords</strong> in your Google Account, create one (name it &ldquo;NVBC&rdquo;), and copy the 16-letter password.</li>
          <li>
            Put it in <code>.env.local</code> as <code>GMAIL_APP_PASSWORD</code> (and <code>GMAIL_USER</code> = the Gmail address), then
            restart the app. On Vercel: <strong>Project → Settings → Environment Variables</strong>, add both, and redeploy.
          </li>
        </ol>
        <p className="hint" style={{ margin: 0 }}>Use the app password — never the normal Gmail password.</p>
      </div>
    );

  async function sendTest() {
    if (!preview) return;
    setError("");
    setNotice("Sending a test…");
    try {
      const r = await api<{ to: string }>("/api/admin/members", { action: "email-test", id: preview.id, subject, body });
      setNotice(`Test sent to ${r.to} — check that inbox (and Spam) to see how it looks.`);
    } catch (e) {
      onAuthError(e);
      setNotice("");
      setError(e instanceof Error ? e.message : "Test failed");
    }
  }

  async function sendAll() {
    if (unknownTags.length && !window.confirm(`The message has unknown placeholders (${unknownTags.join(", ")}) that will be sent as typed. Send anyway?`)) return;
    if (!window.confirm(`Email ${chosen.length} expired member${chosen.length === 1 ? "" : "s"} from ${email?.ready ? email.from : ""}? Each gets their own email.`)) return;
    setError("");
    setNotice("");
    setResults(null);
    const all: Outcome[] = [];
    setProgress({ done: 0, total: chosen.length });
    for (let i = 0; i < chosen.length; i += BATCH) {
      try {
        const r = await api<{ outcomes: Outcome[] }>("/api/admin/members", {
          action: "email",
          ids: chosen.slice(i, i + BATCH).map((m) => m.id),
          subject,
          body,
        });
        all.push(...r.outcomes);
        setProgress({ done: Math.min(i + BATCH, chosen.length), total: chosen.length });
        // Stop if Gmail refused the login or the daily limit was hit — the rest would fail too.
        const fatal = r.outcomes.find((o) => !o.ok && /refused the login|sending limit/.test(o.error ?? ""));
        if (fatal) {
          setError(fatal.error ?? "Sending stopped.");
          break;
        }
      } catch (e) {
        onAuthError(e);
        setError(e instanceof Error ? e.message : "Sending failed");
        break;
      }
    }
    setProgress(null);
    setResults(all);
    setPicked(new Set(all.filter((o) => !o.ok).map((o) => o.id))); // leave only failures ticked, to retry
    onSent();
  }

  const sent = results?.filter((o) => o.ok).length ?? 0;
  const failed = results?.filter((o) => !o.ok) ?? [];

  return (
    <div className="card stack">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>Email expired members</h2>
        <span className="muted" style={{ fontSize: 14 }}>From: NVBC &lt;{email.from}&gt;</span>
      </div>

      <div className="email-grid">
        <div className="stack" style={{ gap: 10 }}>
          <div>
            <label htmlFor="em-subj">Subject</label>
            <input id="em-subj" type="text" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label htmlFor="em-body">Message</label>
            <textarea id="em-body" rows={13} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
            <p className="hint" style={{ margin: "4px 0 0" }}>
              Filled in for each member:{" "}
              {REMINDER_PLACEHOLDERS.map((p, i) => (
                <span key={p.key} title={p.hint}>{i ? ", " : ""}<code>{`{${p.key}}`}</code></span>
              ))}
              .{" "}
              <button type="button" className="link-btn" onClick={() => { setSubject(DEFAULT_REMINDER_SUBJECT); setBody(DEFAULT_REMINDER_BODY); }}>
                Reset to the default message
              </button>
            </p>
            {unknownTags.length > 0 && <div className="error" style={{ marginTop: 6 }}>Unknown placeholder: {unknownTags.join(", ")}</div>}
          </div>
        </div>

        <div>
          <label>Preview{preview ? ` — ${preview.full_name}` : ""}</label>
          {filled ? (
            <div className="email-preview">
              <div className="email-preview-subj">{filled.subject}</div>
              <div className="email-preview-body">{filled.body}</div>
            </div>
          ) : (
            <p className="muted">No one to preview.</p>
          )}
          <button type="button" className="btn small secondary" style={{ marginTop: 8 }} disabled={!preview} onClick={sendTest}>
            Send a test to {email.from}
          </button>
        </div>
      </div>

      <div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
          <strong>Send to</strong>
          <button type="button" className="btn small secondary" onClick={() => setPicked(defaultPick())}>
            Tick all not emailed lately
          </button>
          <button type="button" className="btn small secondary" onClick={() => setPicked(new Set())}>Untick all</button>
        </div>
        <div className="table-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
          <table className="list">
            <tbody>
              {expired.map((m) => (
                <tr key={m.id} className={picked.has(m.id) ? undefined : "import-skip"}>
                  <td style={{ width: 32 }}>
                    <input type="checkbox" aria-label={`Email ${m.full_name}`} disabled={!canEmail(m)} checked={picked.has(m.id)}
                      onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n; })} />
                  </td>
                  <td>
                    <button type="button" className="link-btn" style={{ color: "var(--text)", textDecoration: "none", fontSize: 14, padding: 0 }}
                      onClick={() => setPreviewId(m.id)} title="Preview this member's email">
                      {m.full_name}
                    </button>
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {canEmail(m) ? m.email : <span className="muted">No email address</span>}
                    {canEmail(m) && typo(m) && (
                      <div className="badge member-pending" title="Likely a typo — this would bounce. Tick it only if the address really is correct.">
                        Check this address
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 13 }} className="muted">Expired {shortDate(m.expires_on)}</td>
                  <td style={{ fontSize: 13 }}>
                    {m.emailed_on ? <span className={recent(m) ? "badge member-pending" : "muted"}>Emailed {shortDate(m.emailed_on)}</span> : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ margin: "6px 0 0" }}>
          Anyone emailed in the last {RECENT_DAYS} days, and addresses that look mistyped (like &ldquo;gmail.con&rdquo;), start
          unticked. Gmail allows about 500 emails a day. Only email members who
          agreed to be contacted about their membership.
        </p>
      </div>

      {notice && <div className="success">{notice}</div>}
      {error && <div className="error">{error}</div>}
      {results && (
        <div className={failed.length ? "notice" : "success"}>
          <strong>{sent}</strong> reminder{sent === 1 ? "" : "s"} sent.
          {failed.length > 0 && (
            <>
              {" "}{failed.length} not sent (still ticked — fix and send again):
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {failed.map((o) => <li key={o.id}>{o.name}: {o.error}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn" disabled={!!progress || chosen.length === 0} onClick={sendAll}>
          {progress ? `Sending… ${progress.done} of ${progress.total}` : `✉ Send to ${chosen.length} member${chosen.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
