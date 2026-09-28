"use client";

import { useMemo, useState } from "react";
import {
  detectDateOrder,
  guessMapping,
  IMPORT_FIELDS,
  parseDelimited,
  toImportRecord,
  type DateOrder,
  type ImportField,
  type ImportRecord,
  type Mapping,
} from "@/lib/member-import";
import { MEMBER_TYPES, MEMBERSHIP_DAYS, memberTypeLabel, type MemberType } from "@/lib/membership";
import { api, todayManila } from "./shared";

type Outcome =
  | { row: number; result: "imported"; fullName: string; memberCode: string; token: string; email: string; mobile: string; expiresOn: string }
  | { row: number; result: "ready"; warning?: string } // warning: same name, no birthday to compare
  | { row: number; result: "ask"; reason: string } // looks like a duplicate: staff choose Skip or Import anyway
  | { row: number; result: "duplicate"; reason: string }
  | { row: number; result: "error"; reason: string };

const niceDate = (d: string | null) =>
  d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

/** Staff: bring existing members in from a spreadsheet (e.g. Google Forms responses). */
export default function ImportMembers({ onDone, onAuthError }: { onDone: () => void; onAuthError: (e: unknown) => void }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [paste, setPaste] = useState("");
  const [map, setMap] = useState<Mapping>({});
  const [dateOrder, setDateOrder] = useState<DateOrder>("mdy");
  const [defaultType, setDefaultType] = useState<MemberType>("adult");
  const [defaultStart, setDefaultStart] = useState(todayManila());
  const [check, setCheck] = useState<Outcome[] | null>(null); // dry-run results
  const [unticked, setUnticked] = useState<Set<number>>(new Set()); // rows staff chose to skip
  const [view, setView] = useState<"all" | "approve" | "skip" | "decide">("all");
  const [decisions, setDecisions] = useState<Map<number, "import" | "skip">>(new Map()); // for possible duplicates
  const [done, setDone] = useState<Outcome[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function load(text: string, name: string) {
    const parsed = parseDelimited(text);
    if (parsed.length < 2) return setError("That doesn't look like a sheet with a header row and at least one member.");
    const m = guessMapping(parsed[0]);
    const dateCols = (["birthdate", "startsOn", "expiresOn"] as ImportField[]).map((f) => m[f]).filter((i) => i !== undefined) as number[];
    setDateOrder(detectDateOrder(parsed.slice(1).flatMap((r) => dateCols.map((i) => r[i] ?? ""))));
    setRows(parsed);
    setMap(m);
    setFileName(name);
    setCheck(null);
    setUnticked(new Set());
    setView("all");
    setError("");
  }

  const headers = rows?.[0] ?? [];
  const parsed = useMemo(() => {
    if (!rows) return [];
    const opt = { dateOrder, defaultType, defaultStart, days: MEMBERSHIP_DAYS };
    return rows.slice(1).map((cells, i) => toImportRecord(cells, i + 2, map, opt));
  }, [rows, map, dateOrder, defaultType, defaultStart]);
  const good = parsed.filter((r): r is ImportRecord => !("error" in r));
  const bad = parsed.filter((r): r is { row: number; error: string } => "error" in r);
  const hasName = map.fullName !== undefined || (map.firstName !== undefined && map.lastName !== undefined);

  // Checklist: after the check, every "Ready" row starts ticked; untick anyone you don't want to approve.
  // Possible duplicates (same name, no birthday to compare) start unticked — tick them if they're new.
  const readyRows = new Set((check ?? []).filter((o) => o.result === "ready").map((o) => o.row));
  const warnings = new Map(
    (check ?? []).flatMap((o) => (o.result === "ready" && o.warning ? [[o.row, o.warning] as const] : []))
  );
  const ticked = (row: number) => readyRows.has(row) && !unticked.has(row);
  // Possible duplicates (2+ of name, contact number, birthday match): staff must choose for each.
  const asks = new Map((check ?? []).flatMap((o) => (o.result === "ask" ? [[o.row, o.reason] as const] : [])));
  const decide = (row: number, d: "import" | "skip") => setDecisions((m) => new Map(m).set(row, d));
  const undecided = [...asks.keys()].filter((row) => !decisions.has(row));
  const toApprove = good.filter((r) => ticked(r.row) || (asks.has(r.row) && decisions.get(r.row) === "import"));
  const willImport = (row: number) => ticked(row) || decisions.get(row) === "import";
  const toggle = (row: number, on: boolean) =>
    setUnticked((u) => {
      const next = new Set(u);
      if (on) next.delete(row);
      else next.add(row);
      return next;
    });

  const setField = (f: ImportField, v: string) => {
    setMap((m) => {
      const next = { ...m };
      if (v === "") delete next[f];
      else next[f] = Number(v);
      return next;
    });
    setCheck(null);
  };

  async function run(dryRun: boolean) {
    setBusy(true);
    setError("");
    try {
      const records = dryRun ? good : toApprove;
      const r = await api<{ outcomes: Outcome[] }>("/api/admin/members", { action: "import", dryRun, records });
      if (dryRun) {
        setCheck(r.outcomes);
        setUnticked(new Set(r.outcomes.filter((o) => o.result === "ready" && o.warning).map((o) => o.row)));
        setDecisions(new Map());
        if (r.outcomes.some((o) => o.result === "ask")) setView("decide");
      } else {
        setDone(r.outcomes);
        onDone();
      }
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  // ---- Step 4: results ----
  if (done) {
    const imported = done.filter((o): o is Extract<Outcome, { result: "imported" }> => o.result === "imported");
    const expiredCount = imported.filter((o) => o.expiresOn <= todayManila()).length;
    // Rows with problems, duplicates and rows you unticked never reached the import; list them all.
    const skipped = [
      ...(done.filter((o) => o.result !== "imported") as Extract<Outcome, { reason: string }>[]),
      ...(check ?? []).filter((o): o is Extract<Outcome, { reason: string }> => o.result === "duplicate" || o.result === "error"),
      ...bad.map((b) => ({ row: b.row, result: "error" as const, reason: b.error })),
      ...[...unticked].filter((row) => readyRows.has(row)).map((row) => ({ row, result: "duplicate" as const, reason: "Skipped by you (unticked)" })),
      ...[...asks].filter(([row]) => decisions.get(row) === "skip")
        .map(([row, why]) => ({ row, result: "duplicate" as const, reason: `Skipped by you — ${why}` })),
    ]
      .filter((o, i, all) => all.findIndex((x) => x.row === o.row) === i)
      .sort((x, y) => x.row - y.row);
    const download = () => {
      const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : /^[=+\-@]/.test(v) ? `'${v}` : v);
      const lines = [
        ["Name", "Email", "Mobile", "Member code", "Expires", "Member page (QR code)"],
        ...imported.map((o) => [o.fullName, o.email, o.mobile, o.memberCode, o.expiresOn, `${location.origin}/membership/${o.token}`]),
      ].map((r) => r.map(esc).join(","));
      const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nvbc-imported-members-${todayManila()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    return (
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Import finished</h2>
        <div className="success">
          <strong>{imported.length}</strong> member{imported.length === 1 ? "" : "s"} imported and approved, each with a new member code.
          {skipped.length > 0 && ` ${skipped.length} row${skipped.length === 1 ? " was" : "s were"} skipped.`}
        </div>
        {expiredCount > 0 && (
          <div className="notice">
            {expiredCount} of them had already expired and are kept as <strong>Expired</strong>. Find them under
            Members → &ldquo;Expired — remind to renew or forfeit&rdquo;; their bookings are flagged so staff can ask on their
            next visit.
          </div>
        )}
        {imported.length > 0 && (
          <div>
            <p style={{ marginTop: 0 }}>
              Imported members don&apos;t have their QR code yet. Download the list and send each member their own link
              (by text or email) — opening it shows their member card with the QR code, and saves it on their phone.
            </p>
            <button className="btn" onClick={download}>⬇ Download member codes &amp; links (CSV)</button>
            <p className="hint">Each link is private to that member — send it only to them.</p>
          </div>
        )}
        {skipped.length > 0 && <OutcomeTable outcomes={skipped} />}
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="btn secondary" onClick={() => { setDone(null); setRows(null); setPaste(""); setCheck(null); setUnticked(new Set()); }}>
            Import another file
          </button>
        </div>
      </div>
    );
  }

  // ---- Step 1: load ----
  if (!rows)
    return (
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Import existing members</h2>
        <ol className="hint" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
          <li>Open your Google Form → <strong>Responses</strong> → the green <strong>Sheets</strong> icon (or open your members sheet).</li>
          <li>In Sheets: <strong>File → Download → Comma-separated values (.csv)</strong>, then choose that file below.</li>
          <li>Or select all the cells in the sheet (including the header row), copy, and paste them below.</li>
        </ol>
        <div>
          <label htmlFor="imp-file">CSV file</label>
          <input id="imp-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) load(await f.text(), f.name);
            }} />
        </div>
        <div>
          <label htmlFor="imp-paste">…or paste the cells</label>
          <textarea id="imp-paste" rows={5} placeholder="Timestamp	Email Address	Full Name	…" value={paste}
            onChange={(e) => setPaste(e.target.value)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }} />
          <button type="button" className="btn small secondary" style={{ marginTop: 8 }} disabled={!paste.trim()}
            onClick={() => load(paste, "pasted cells")}>
            Use pasted cells
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    );

  // ---- Steps 2 & 3: match columns, check, import ----
  const counts = check && {
    approve: toApprove.length,
    yours: readyRows.size - toApprove.length - [...warnings.keys()].filter((row) => !ticked(row)).length,
    toCheck: [...warnings.keys()].filter((row) => !ticked(row)).length,
    dup: check.filter((o) => o.result === "duplicate").length,
    err: check.filter((o) => o.result === "error").length + bad.length,
  };
  const shownRows = parsed.filter((r) =>
    view === "all" ? true : view === "decide" ? asks.has(r.row) : (view === "approve") === willImport(r.row)
  );
  const sample = rows.slice(1, 4);

  return (
    <div className="card stack">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>Import existing members</h2>
        <span className="muted">{fileName} · {rows.length - 1} row{rows.length === 2 ? "" : "s"}</span>
      </div>

      <div>
        <h3 style={{ margin: "0 0 4px" }}>1. Match the columns</h3>
        <p className="hint" style={{ margin: "0 0 8px" }}>
          We guessed from your headers — check them. Leave a field on &ldquo;—&rdquo; if your sheet doesn&apos;t have it.
        </p>
        <div className="table-wrap">
          <table className="list import-map">
            <thead>
              <tr>
                <th>Field</th>
                <th>Column in your sheet</th>
                <th>Example</th>
              </tr>
            </thead>
            <tbody>
              {IMPORT_FIELDS.map((f) => (
                <tr key={f.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {f.label}
                    {"required" in f && f.required && <span className="hint"> (required)</span>}
                  </td>
                  <td>
                    <select aria-label={`Column for ${f.label}`} value={map[f.id] ?? ""} onChange={(e) => setField(f.id, e.target.value)}>
                      <option value="">—</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </td>
                  <td className="muted import-example">
                    {map[f.id] !== undefined ? sample.map((r) => r[map[f.id]!]).filter(Boolean).slice(0, 2).join(" · ") : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <div>
          <label htmlFor="imp-order">Dates are written</label>
          <select id="imp-order" value={dateOrder} onChange={(e) => { setDateOrder(e.target.value as DateOrder); setCheck(null); }}>
            <option value="mdy">Month/Day/Year (9/28/2025)</option>
            <option value="dmy">Day/Month/Year (28/9/2025)</option>
          </select>
        </div>
        <div>
          <label htmlFor="imp-type">Type when not given</label>
          <select id="imp-type" value={defaultType} onChange={(e) => { setDefaultType(e.target.value as MemberType); setCheck(null); }}>
            {MEMBER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="imp-start">Start date when not given</label>
          <input id="imp-start" type="date" value={defaultStart} onChange={(e) => { if (e.target.value) { setDefaultStart(e.target.value); setCheck(null); } }} />
        </div>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Each member is valid for {MEMBERSHIP_DAYS} days from their start date, unless you match an expiry column. Members whose
        year has already ended are imported as expired — renew them when they pay.
      </p>

      <div>
        <h3 style={{ margin: "0 0 4px" }}>2. Check and choose who to approve</h3>
        <p className="hint" style={{ margin: "0 0 8px" }}>
          {check
            ? "Ticked members are approved and imported. Untick anyone you want to skip — you can import them later."
            : "Press Check below: each row is checked against the members already in the system."}{" "}
          Rows that share two or more of <em>name, contact number and birthday</em> with a member (or an earlier row)
          look like duplicates — you&apos;ll be asked to <strong>Skip</strong> or <strong>Import anyway</strong>. People
          sharing an email are fine. Rows with no birthday whose name is already taken start unticked.
        </p>
        {check && (
          <div className="checklist-bar">
            <div className="segmented" role="radiogroup" aria-label="Show">
              {([
                ...(asks.size ? [["decide", `Needs your decision (${undecided.length}/${asks.size})`] as const] : []),
                ["all", "All rows"] as const,
                ["approve", `To approve (${counts!.approve})`] as const,
                ["skip", `To skip (${parsed.length - counts!.approve})`] as const,
              ]).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>{label}</button>
              ))}
            </div>
            <button type="button" className="btn small secondary" onClick={() => setUnticked(new Set(warnings.keys()))}
              title="Ticks every ready row except possible duplicates">
              Tick all ready
            </button>
            <button type="button" className="btn small secondary" onClick={() => setUnticked(new Set(readyRows))}>Untick all</button>
          </div>
        )}
        {!hasName ? (
          <div className="error">Match the Full name column (or First and Last name) first.</div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    {check && (
                      <th style={{ width: 36 }}>
                        <input type="checkbox" aria-label="Approve all ready members"
                          checked={readyRows.size > 0 && toApprove.length === readyRows.size}
                          ref={(el) => { if (el) el.indeterminate = toApprove.length > 0 && toApprove.length < readyRows.size; }}
                          onChange={(e) => setUnticked(e.target.checked ? new Set() : new Set(readyRows))} />
                      </th>
                    )}
                    <th>Row</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Contact</th>
                    <th>Birthdate</th>
                    <th>Valid</th>
                    <th>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRows.slice(0, 300).map((r) => {
                    const o = check?.find((x) => x.row === r.row);
                    const box = check && (
                      <td>
                        <input type="checkbox" aria-label={`Approve row ${r.row}`} checked={willImport(r.row)}
                          disabled={!readyRows.has(r.row)} onChange={(e) => toggle(r.row, e.target.checked)} />
                      </td>
                    );
                    return "error" in r ? (
                      <tr key={r.row} className="import-skip">
                        {box}
                        <td>{r.row}</td>
                        <td colSpan={5} className="muted">{rows[r.row - 1]?.filter(Boolean).slice(0, 3).join(" · ")}</td>
                        <td><span className="badge member-expired">{r.error}</span></td>
                      </tr>
                    ) : (
                      <tr key={r.row} className={check && !willImport(r.row) && !(asks.has(r.row) && !decisions.has(r.row)) ? "import-skip" : undefined}
                        onClick={(e) => readyRows.has(r.row) && (e.target as HTMLElement).tagName !== "INPUT" && toggle(r.row, !ticked(r.row))}
                        style={readyRows.has(r.row) ? { cursor: "pointer" } : undefined}>
                        {box}
                        <td>{r.row}</td>
                        <td>{r.fullName}</td>
                        <td>{memberTypeLabel(r.memberType)}</td>
                        <td style={{ fontSize: 13 }}>{[r.mobile, r.email].filter(Boolean).join(" · ") || "—"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{niceDate(r.birthdate)}</td>
                        <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                          {niceDate(r.startsOn)} – {niceDate(r.expiresOn)}
                          {r.expiresOn <= todayManila() && <span className="badge member-expired" style={{ marginLeft: 4 }}>expired</span>}
                        </td>
                        <td>
                          {!o ? <span className="muted">—</span>
                            : o.result === "ask" ? (
                              <div className={`dup-ask${decisions.has(r.row) ? "" : " undecided"}`}>
                                <div>⚠ Looks like a duplicate: {o.reason}. Import this row?</div>
                                <div className="segmented" role="radiogroup" aria-label={`Row ${r.row}: import or skip`}>
                                  <button type="button" role="radio" aria-checked={decisions.get(r.row) === "skip"} onClick={() => decide(r.row, "skip")}>
                                    Skip
                                  </button>
                                  <button type="button" role="radio" aria-checked={decisions.get(r.row) === "import"} onClick={() => decide(r.row, "import")}>
                                    Import anyway
                                  </button>
                                </div>
                              </div>
                            )
                            : o.result === "ready" && o.warning ? (
                              <span className={`badge ${ticked(r.row) ? "member-active" : "member-pending"}`} title={o.warning}>
                                {ticked(r.row) ? "✓ Approve — " : "Possible duplicate: "}
                                {o.warning}
                              </span>
                            )
                            : o.result === "ready" ? (ticked(r.row)
                              ? <span className="badge member-active">✓ Approve</span>
                              : <span className="badge member-rejected">Skipped by you</span>)
                            : o.result === "duplicate" ? <span className="badge member-rejected" title={o.reason}>Skip: {o.reason}</span>
                            : o.result === "error" ? <span className="badge member-expired">{o.reason}</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {shownRows.length === 0 && <p className="muted">No rows here.</p>}
            {shownRows.length > 300 && (
              <p className="hint">Showing the first 300 of {shownRows.length} rows. Use the filter above or &ldquo;Untick all&rdquo; to handle the rest.</p>
            )}
          </>
        )}
      </div>

      {counts && (
        <div className={counts.approve ? "success" : "notice"}>
          <strong>✓ {counts.approve}</strong> to approve
          {counts.yours > 0 && ` · ${counts.yours} skipped by you`}
          {undecided.length > 0 && ` · ${undecided.length} possible duplicate${undecided.length === 1 ? "" : "s"} need${undecided.length === 1 ? "s" : ""} your decision`}
          {counts.toCheck > 0 && ` · ${counts.toCheck} unticked (same name, no birthday to compare)`}
          {counts.dup > 0 && ` · ${counts.dup} already members or repeated (same name and birthday)`}
          {counts.err > 0 && ` · ${counts.err} with problems (fix them in the sheet and import again)`}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn secondary" onClick={() => { setRows(null); setCheck(null); }}>Choose another file</button>
        {!check ? (
          <button className="btn" disabled={busy || !hasName || good.length === 0} onClick={() => run(true)}>
            {busy ? "Checking…" : `Check ${good.length} member${good.length === 1 ? "" : "s"}`}
          </button>
        ) : (
          <button className="btn" disabled={busy || !counts?.approve || undecided.length > 0}
            title={undecided.length ? "Choose Skip or Import anyway for each possible duplicate first" : undefined}
            onClick={() => window.confirm(`Approve and import ${counts!.approve} ticked member${counts!.approve === 1 ? "" : "s"} as paid NVBC members?`) && run(false)}>
            {busy ? "Importing…"
              : undecided.length ? `Decide on ${undecided.length} possible duplicate${undecided.length === 1 ? "" : "s"} first`
              : `Approve & import ${counts?.approve ?? 0} member${counts?.approve === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}

function OutcomeTable({ outcomes }: { outcomes: Extract<Outcome, { reason: string }>[] }) {
  return (
    <div className="table-wrap">
      <table className="list">
        <thead>
          <tr>
            <th>Row</th>
            <th>Skipped because</th>
          </tr>
        </thead>
        <tbody>
          {outcomes.map((o) => (
            <tr key={o.row}>
              <td>{o.row}</td>
              <td>{o.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
