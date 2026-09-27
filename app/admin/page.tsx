"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { formatDateLong, formatHour, formatRange } from "@/lib/format";
import {
  formatPeso,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  paymentLabel,
  bookingStatusLabel,
  RATE_TYPES,
  rateTypeLabel,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
  type RateType,
  type SportPricing,
} from "@/lib/pricing";
import { imageToDataUrl } from "@/lib/image";
import EditBooking from "./EditBooking";
import Overview from "./Overview";
import { api, AuthError, todayManila, type AdminBooking, type Court, type Settings } from "./shared";
import { SPORTS, sportEmoji, sportLabel, type Sport } from "@/lib/sports";

export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"overview" | "bookings" | "courts" | "settings">("overview");
  const [bookingsDate, setBookingsDate] = useState(todayManila);

  useEffect(() => {
    api<{ loggedIn: boolean }>("/api/admin/login").then((r) => setLoggedIn(r.loggedIn)).catch(() => setLoggedIn(false));
  }, []);

  const onAuthError = useCallback((e: unknown) => {
    if (e instanceof AuthError) setLoggedIn(false);
  }, []);

  if (loggedIn === null) return <p className="muted">Loading…</p>;
  if (!loggedIn) return <Login onDone={() => setLoggedIn(true)} />;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1>Staff dashboard</h1>
        <button
          className="btn small secondary"
          onClick={async () => {
            await api("/api/admin/logout", {});
            setLoggedIn(false);
          }}
        >
          Log out
        </button>
      </div>
      <div className="tabs" role="tablist">
        {(["overview", "bookings", "courts", "settings"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <Overview
          onOpenDay={(d) => {
            setBookingsDate(d);
            setTab("bookings");
          }}
          onAuthError={onAuthError}
        />
      )}
      {tab === "bookings" && <BookingsTab initialDate={bookingsDate} onDateChange={setBookingsDate} onAuthError={onAuthError} />}
      {tab === "courts" && <CourtsTab onAuthError={onAuthError} />}
      {tab === "settings" && <SettingsTab onAuthError={onAuthError} />}
    </>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card"
      style={{ maxWidth: 400, margin: "40px auto" }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api("/api/admin/login", { password });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Login failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Staff login</h2>
      <div className="field">
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      <div className="actions">
        <button className="btn block" disabled={busy}>{busy ? "Checking…" : "Log in"}</button>
      </div>
    </form>
  );
}

function BookingsTab({
  initialDate,
  onDateChange,
  onAuthError,
}: {
  initialDate: string;
  onDateChange: (date: string) => void; // remembered while switching tabs
  onAuthError: (e: unknown) => void;
}) {
  const [date, setDateState] = useState(initialDate);
  const setDate = (d: string) => {
    setDateState(d);
    onDateChange(d);
  };
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | PaymentStatus>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, c] = await Promise.all([
        api<{ bookings: AdminBooking[] }>(`/api/admin/bookings?date=${date}`),
        api<{ courts: Court[] }>("/api/admin/courts"),
      ]);
      setBookings(b.bookings);
      setCourts(c.courts);
      setError("");
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [date, onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel(b: AdminBooking) {
    const paidNote = b.payment_status === "paid" ? `\n\nThis booking is PAID (${formatPeso(b.amount)}). Remember to refund it.` : "";
    if (!window.confirm(`Cancel ${b.name}'s booking on ${b.court_name}, ${formatRange(b.start_hour, b.end_hour)}?${paidNote}`)) return;
    try {
      await api("/api/admin/bookings", { action: "cancel", id: b.id });
      load();
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  async function setPayment(b: AdminBooking, status: PaymentStatus) {
    try {
      const r = await api<{ status: BookingStatus }>("/api/admin/bookings", { action: "payment", id: b.id, status });
      // Marking an online payment Paid turns a Pending booking into Confirmed (and back if undone).
      setBookings((list) => list.map((x) => (x.id === b.id ? { ...x, payment_status: status, status: r.status } : x)));
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  const confirmed = bookings.filter((b) => b.status !== "cancelled"); // pending + confirmed
  const pendingCount = bookings.filter((b) => b.status === "pending").length;
  const hoursBooked = confirmed.reduce((s, b) => s + b.end_hour - b.start_hour, 0);
  const billed = confirmed.filter((b) => b.payment_status !== "waived").reduce((s, b) => s + b.amount, 0);
  const collected = bookings.filter((b) => b.payment_status === "paid").reduce((s, b) => s + b.amount, 0);
  const toVerify = bookings.filter((b) => b.payment_status === "for_verification").length;
  const unpaid = confirmed.filter((b) => b.payment_status === "unpaid").reduce((s, b) => s + b.amount, 0);
  const shown = filter === "all" ? bookings : bookings.filter((b) => b.payment_status === filter);

  return (
    <div className="stack">
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label htmlFor="d">Date</label>
          <input id="d" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <button className="btn secondary" onClick={() => setDate(todayManila())}>Today</button>
        <button className="btn" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? "Close" : "+ Add booking / block court"}
        </button>
      </div>

      {showAdd && (
        <AddBooking
          date={date}
          courts={courts}
          onAdded={() => {
            setShowAdd(false);
            load();
          }}
          onAuthError={onAuthError}
        />
      )}

      <p className="muted" style={{ margin: 0 }}>{formatDateLong(date)}</p>
      <div className="stats">
        <div className="stat"><div className="n">{confirmed.length}</div><div className="l">bookings · {hoursBooked} court-hour{hoursBooked === 1 ? "" : "s"}{pendingCount ? ` · ${pendingCount} pending` : ""}</div></div>
        <div className="stat"><div className="n">{formatPeso(billed)}</div><div className="l">billed</div></div>
        <div className="stat"><div className="n">{formatPeso(collected)}</div><div className="l">collected (paid)</div></div>
        <div className="stat"><div className="n">{formatPeso(unpaid)}</div><div className="l">still unpaid</div></div>
        <button type="button" className="stat" style={{ textAlign: "left", cursor: "pointer", borderColor: toVerify ? "#e0a800" : undefined }}
          onClick={() => setFilter(filter === "for_verification" ? "all" : "for_verification")}>
          <div className="n">{toVerify}</div><div className="l">to verify {filter === "for_verification" ? "(showing)" : "→"}</div>
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="flt" style={{ margin: 0 }}>Show</label>
        <select id="flt" value={filter} onChange={(e) => setFilter(e.target.value as "all" | PaymentStatus)} style={{ width: "auto" }}>
          <option value="all">All payments</option>
          {PAYMENT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      <div className="card table-wrap" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 16 }}>Loading…</p>
        ) : shown.length === 0 ? (
          <p className="muted" style={{ padding: 16 }}>No bookings{filter === "all" ? " on this date" : " with this payment status"}.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Time</th>
                <th>Court</th>
                <th>Name / contact</th>
                <th>Rate</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Code</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <Fragment key={b.id}>
                  <tr className={b.status === "cancelled" ? "cancelled" : ""}>
                    <td style={{ whiteSpace: "nowrap" }}>{formatRange(b.start_hour, b.end_hour)}</td>
                    <td>{sportEmoji(b.sport)} {b.court_name}</td>
                    <td>
                      {b.name}
                      <div style={{ fontSize: 13 }}>
                        {b.contact.startsWith("+") || /^\d/.test(b.contact) ? <a href={`tel:${b.contact}`}>{b.contact}</a> : <span className="muted">{b.contact}</span>}
                      </div>
                      {b.notes && <div className="muted" style={{ fontSize: 13 }}>{b.notes}</div>}
                    </td>
                    <td>
                      {rateTypeLabel(b.rate_type)}
                      {b.discount_pct > 0 ? (
                        <div className="muted" style={{ fontSize: 13 }}>−{b.discount_pct}%</div>
                      ) : b.hourly_rate > 0 ? (
                        <div className="muted" style={{ fontSize: 13 }}>{formatPeso(b.hourly_rate)}/hr</div>
                      ) : null}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatPeso(b.amount)}</td>
                    <td style={{ minWidth: 170 }}>
                      <div style={{ fontSize: 13, marginBottom: 4 }}>
                        {paymentLabel(b.payment_method)}
                        {b.payment_ref && (
                          <>
                            {" · "}
                            <span style={{ fontFamily: "ui-monospace, monospace" }}>{b.payment_ref}</span>
                            {b.ref_reused > 0 && (
                              <span className="pay-status unpaid" title={`This reference number is also on ${b.ref_reused} other booking(s)`} style={{ marginLeft: 4 }}>
                                ⚠ used {b.ref_reused + 1}×
                              </span>
                            )}
                          </>
                        )}
                        {b.has_proof && (
                          <>
                            {" · "}
                            <a href={`/api/admin/bookings/proof?id=${b.id}`} target="_blank" rel="noopener noreferrer">
                              📷 Screenshot
                            </a>
                          </>
                        )}
                      </div>
                      <select
                        aria-label="Payment status"
                        className={`pay-status ${b.payment_status}`}
                        value={b.payment_status}
                        onChange={(e) => setPayment(b, e.target.value as PaymentStatus)}
                        style={{ width: "auto", border: 0, fontSize: 13, padding: "4px 8px" }}
                      >
                        {PAYMENT_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </td>
                    <td style={{ fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>{b.code}</td>
                    <td>
                      {b.status !== "cancelled" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                          <span className={`badge ${b.status === "pending" ? "pending" : ""}`}
                            title={b.status === "pending" ? "Waiting for the online payment to be verified — mark it Paid to confirm" : undefined}>
                            {bookingStatusLabel(b.status)}
                          </span>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn small secondary" onClick={() => setEditing(editing === b.id ? null : b.id)}>
                              Edit
                            </button>
                            <button className="btn small secondary" onClick={() => cancel(b)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <span className="badge grey">Cancelled{b.cancelled_by ? ` by ${b.cancelled_by}` : ""}</span>
                      )}
                    </td>
                  </tr>
                  {editing === b.id && (
                    <tr className="edit-row">
                      <td colSpan={8}>
                        <EditBooking
                          booking={b}
                          courts={courts}
                          onClose={() => setEditing(null)}
                          onSaved={() => {
                            setEditing(null);
                            load();
                          }}
                          onAuthError={onAuthError}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AddBooking({
  date,
  courts,
  onAdded,
  onAuthError,
}: {
  date: string;
  courts: Court[];
  onAdded: () => void;
  onAuthError: (e: unknown) => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [start, setStart] = useState(8);
  const [end, setEnd] = useState(10);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [rateType, setRateType] = useState<RateType>("regular");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("unpaid");
  const [noCharge, setNoCharge] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const hourOptions = Array.from({ length: 25 }, (_, h) => h);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length === 0) return setError("Choose at least one court.");
    if (end <= start) return setError("End time must be after start time.");
    setBusy(true);
    setError("");
    const failures: string[] = [];
    for (const courtId of selected) {
      try {
        await api("/api/admin/bookings", {
          action: "create",
          courtId,
          date,
          startHour: start,
          hours: end - start,
          name,
          contact,
          notes,
          rateType,
          paymentMethod,
          paymentStatus,
          noCharge,
        });
      } catch (err) {
        onAuthError(err);
        const cname = courts.find((c) => c.id === courtId)?.name ?? courtId;
        failures.push(`${cname}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    setBusy(false);
    if (failures.length) setError(failures.join(" · "));
    else onAdded();
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Add booking or block courts — {formatDateLong(date)}</h2>
      <p className="muted" style={{ marginTop: -6, fontSize: 14 }}>
        Use this for walk-ins, phone bookings, tournaments or maintenance. Staff bookings ignore the
        player limits and member/coach codes. Blocked slots show as &ldquo;Booked&rdquo; to the public.
      </p>
      <div className="field">
        <label>Courts</label>
        {SPORTS.map((sp) => {
          const list = courts.filter((c) => c.sport === sp.id);
          if (list.length === 0) return null;
          return (
            <div key={sp.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <span style={{ minWidth: 100, fontSize: 14 }}>{sp.emoji} {sp.label}</span>
              {list.map((c) => (
                <label key={c.id} style={{ fontWeight: 400, display: "inline-flex", gap: 6, alignItems: "center", margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={(e) =>
                      setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))
                    }
                  />
                  {c.name}
                  {!c.is_active && <span className="hint">(hidden)</span>}
                </label>
              ))}
              <button type="button" className="btn small secondary"
                onClick={() => setSelected((s) => [...new Set([...s, ...list.map((c) => c.id)])])}>
                All {sp.label.toLowerCase()}
              </button>
            </div>
          );
        })}
      </div>
      <div className="row field">
        <div>
          <label htmlFor="s">From</label>
          <select id="s" value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {hourOptions.slice(0, 24).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="e">Until</label>
          <select id="e" value={end} onChange={(e) => setEnd(Number(e.target.value))}>
            {hourOptions.slice(1).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
          </select>
        </div>
      </div>
      <div className="row field">
        <div>
          <label htmlFor="n">Name / label</label>
          <input id="n" type="text" required minLength={2} maxLength={60} placeholder="e.g. Open Tournament"
            value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="c">Contact <span className="hint">(optional)</span></label>
          <input id="c" type="text" maxLength={60} value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label style={{ fontWeight: 400, display: "inline-flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={noCharge} onChange={(e) => setNoCharge(e.target.checked)} />
          No charge (tournament, maintenance, staff use)
        </label>
      </div>
      {!noCharge && (
        <div className="row field" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label htmlFor="rt">Rate</label>
            <select id="rt" value={rateType} onChange={(e) => setRateType(e.target.value as RateType)}>
              {RATE_TYPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pm">Payment method</label>
            <select id="pm" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ps">Payment status</label>
            <select id="ps" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}>
              {PAYMENT_STATUSES.filter((s) => s.id === "unpaid" || s.id === "paid").map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="no">Notes <span className="hint">(optional)</span></label>
        <input id="no" type="text" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      <div className="actions">
        <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

function CourtsTab({ onAuthError }: { onAuthError: (e: unknown) => void }) {
  const [courts, setCourts] = useState<Court[]>([]);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (body?: unknown) => {
      setBusy(true);
      try {
        const r = await api<{ courts: Court[]; warning?: string }>("/api/admin/courts", body);
        setCourts(r.courts);
        setError("");
        setWarning(r.warning || "");
        return true;
      } catch (e) {
        onAuthError(e);
        setError(e instanceof Error ? e.message : "Failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onAuthError]
  );

  useEffect(() => {
    run();
  }, [run]);

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <p className="muted" style={{ margin: 0 }}>
        Set how many courts of each sport players can book. Lowering the number hides the last courts
        in the list; raising it brings hidden ones back first, then adds new ones. Existing bookings are
        never deleted.
      </p>
      {error && <div className="error">{error}</div>}
      {warning && <div className="notice">{warning}</div>}
      {SPORTS.map((s) => (
        <SportCourts
          key={s.id}
          sport={s.id}
          courts={courts.filter((c) => c.sport === s.id)}
          busy={busy}
          run={run}
        />
      ))}
    </div>
  );
}

function SportCourts({
  sport,
  courts,
  busy,
  run,
}: {
  sport: Sport;
  courts: Court[];
  busy: boolean;
  run: (body?: unknown) => Promise<boolean>;
}) {
  const activeCount = courts.filter((c) => c.is_active).length;
  const [count, setCount] = useState(String(activeCount));
  const [newName, setNewName] = useState("");
  useEffect(() => setCount(String(activeCount)), [activeCount]);
  const n = Number(count);
  const changed = count !== "" && Number.isInteger(n) && n !== activeCount;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>
          {sportEmoji(sport)} {sportLabel(sport)}
        </h2>
        <form
          style={{ display: "flex", gap: 8, alignItems: "center" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (changed) run({ action: "set_count", sport, count: n });
          }}
        >
          <label htmlFor={`count-${sport}`} style={{ margin: 0 }}>Bookable courts</label>
          <button type="button" className="btn small secondary" aria-label="One fewer" disabled={busy || activeCount === 0}
            onClick={() => run({ action: "set_count", sport, count: activeCount - 1 })}>−</button>
          <input id={`count-${sport}`} type="number" min={0} max={30} value={count} style={{ width: 70, textAlign: "center" }}
            onChange={(e) => setCount(e.target.value)} />
          <button type="button" className="btn small secondary" aria-label="One more" disabled={busy}
            onClick={() => run({ action: "set_count", sport, count: activeCount + 1 })}>+</button>
          {changed && <button className="btn small" disabled={busy}>Apply</button>}
        </form>
      </div>

      <div style={{ marginTop: 12 }}>
        {courts.length === 0 && <p className="muted">No {sportLabel(sport).toLowerCase()} courts yet.</p>}
        {courts.map((c) => (
          <CourtRow key={c.id} court={c} onSave={(patch) => run({ action: "update", id: c.id, ...patch })} />
        ))}
      </div>

      <form
        style={{ display: "flex", gap: 8, marginTop: 12 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run({ action: "add", name: newName, sport })) setNewName("");
        }}
      >
        <input type="text" placeholder={`New ${sportLabel(sport).toLowerCase()} court name`} value={newName}
          maxLength={40} required onChange={(e) => setNewName(e.target.value)} />
        <button className="btn secondary" style={{ whiteSpace: "nowrap" }}>Add court</button>
      </form>
    </div>
  );
}

function CourtRow({ court, onSave }: { court: Court; onSave: (p: Partial<Court>) => void }) {
  const [name, setName] = useState(court.name);
  const [order, setOrder] = useState(String(court.sort_order));
  useEffect(() => {
    setName(court.name);
    setOrder(String(court.sort_order));
  }, [court]);
  const dirty = name !== court.name || order !== String(court.sort_order);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap", opacity: court.is_active ? 1 : 0.65 }}>
      <input type="number" aria-label="Order" title="Display order" value={order} style={{ width: 64 }}
        onChange={(e) => setOrder(e.target.value)} />
      <input type="text" aria-label="Court name" value={name} maxLength={40} style={{ flex: 1, minWidth: 140 }}
        onChange={(e) => setName(e.target.value)} />
      {dirty && (
        <button className="btn small" onClick={() => onSave({ name, sort_order: Number(order) })}>Save</button>
      )}
      <select aria-label="Sport" title="Switch this court to another sport" value={court.sport} style={{ width: "auto" }}
        onChange={(e) => onSave({ sport: e.target.value as Sport })}>
        {SPORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <button className="btn small secondary" onClick={() => onSave({ is_active: !court.is_active })}>
        {court.is_active ? "Hide" : "Show"}
      </button>
      {!court.is_active && <span className="badge grey">Hidden</span>}
      {court.upcoming > 0 && <span className="badge" title="Confirmed bookings from today onward">{court.upcoming} upcoming</span>}
    </div>
  );
}

function SettingsTab({ onAuthError }: { onAuthError: (e: unknown) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Settings>("/api/admin/settings").then(setS).catch((e) => {
      onAuthError(e);
      setError(e.message);
    });
  }, [onAuthError]);

  if (!s) return error ? <div className="error">{error}</div> : <p className="muted">Loading…</p>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSaved(false);
    setS({ ...s, [k]: v });
  };
  const toggleMethod = (m: PaymentMethod, on: boolean) =>
    set("payment_methods", on ? [...new Set([...s.payment_methods, m])] : s.payment_methods.filter((x) => x !== m));
  const hourOptions = Array.from({ length: 25 }, (_, h) => h);

  return (
    <form
      style={{ maxWidth: 680 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          setS(await api<Settings>("/api/admin/settings", s));
          setSaved(true);
        } catch (err) {
          onAuthError(err);
          setError(err instanceof Error ? err.message : "Save failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset>
        <legend>Prices</legend>
        <p className="hint" style={{ margin: "0 0 10px" }}>₱ per court per hour. Weekend = Saturday and Sunday.</p>
        {SPORTS.map((sp) => {
          const plan = s.rate_plans[sp.id];
          const setPlan = (next: Partial<SportPricing>) => set("rate_plans", { ...s.rate_plans, [sp.id]: { ...plan, ...next } });
          const types = plan.memberRates ? RATE_TYPES : ([{ id: "regular", label: "Standard" }] as const);
          const days = plan.weekendRates
            ? ([["weekday", "Weekdays"], ["weekend", "Weekends"]] as const)
            : ([["weekday", "Every day"]] as const);
          return (
            <div key={sp.id} className="price-plan">
              <div className="price-plan-head">
                <strong>{sp.emoji} {sp.label}</strong>
                <label>
                  <input type="checkbox" checked={plan.memberRates} onChange={(e) => setPlan({ memberRates: e.target.checked })} />
                  Member &amp; coach prices
                </label>
                <label>
                  <input type="checkbox" checked={plan.weekendRates} onChange={(e) => setPlan({ weekendRates: e.target.checked })} />
                  Separate weekend prices
                </label>
              </div>
              <div className="table-wrap">
                <table className="list price-grid">
                  <thead>
                    <tr>
                      <th></th>
                      {types.map((t) => <th key={t.id}>{t.id === "regular" && plan.memberRates ? "Non-member" : t.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map(([day, dayLabel]) => (
                      <tr key={day}>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{dayLabel}</td>
                        {types.map((t) => (
                          <td key={t.id}>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              required
                              aria-label={`${sp.label} ${dayLabel} ${t.label} price per hour`}
                              value={plan[day][t.id] ?? ""}
                              onChange={(e) =>
                                setPlan({
                                  [day]: { ...plan[day], [t.id]: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) },
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        <div className="row field">
          <div>
            <label htmlFor="mc">Member code <span className="hint">(optional)</span></label>
            <input id="mc" type="text" maxLength={40} autoComplete="off" value={s.member_code}
              onChange={(e) => set("member_code", e.target.value)} placeholder="Leave blank = check at desk" />
          </div>
          <div>
            <label htmlFor="cc">Coach code <span className="hint">(optional)</span></label>
            <input id="cc" type="text" maxLength={40} autoComplete="off" value={s.coach_code}
              onChange={(e) => set("coach_code", e.target.value)} placeholder="Leave blank = check at desk" />
          </div>
        </div>
        <p className="hint" style={{ margin: "8px 0 0" }}>
          If you set a code, players must type it to get the member/coach price — share it only with your members or
          coaches, and change it if it leaks. New prices apply to new bookings only.
        </p>
      </fieldset>

      <fieldset>
        <legend>Payment methods</legend>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {PAYMENT_METHODS.map((m) => (
            <label key={m.id} style={{ fontWeight: 400, display: "inline-flex", gap: 6, alignItems: "center", margin: 0 }}>
              <input type="checkbox" checked={s.payment_methods.includes(m.id)} onChange={(e) => toggleMethod(m.id, e.target.checked)} />
              {m.label}
            </label>
          ))}
        </div>

        {s.payment_methods.includes("gcash") && (
          <div className="row field" style={{ marginTop: 14 }}>
            <div>
              <label htmlFor="gn">GCash number</label>
              <input id="gn" type="text" maxLength={40} value={s.gcash_number} placeholder="09XX XXX XXXX"
                onChange={(e) => set("gcash_number", e.target.value)} />
            </div>
            <div>
              <label htmlFor="gname">GCash account name</label>
              <input id="gname" type="text" maxLength={80} value={s.gcash_name}
                onChange={(e) => set("gcash_name", e.target.value)} />
            </div>
          </div>
        )}

        {s.payment_methods.includes("bpi") && (
          <div className="row field" style={{ marginTop: 14 }}>
            <div>
              <label htmlFor="bn">BPI account number</label>
              <input id="bn" type="text" maxLength={40} value={s.bpi_account_number}
                onChange={(e) => set("bpi_account_number", e.target.value)} />
            </div>
            <div>
              <label htmlFor="bname">BPI account name</label>
              <input id="bname" type="text" maxLength={80} value={s.bpi_account_name}
                onChange={(e) => set("bpi_account_name", e.target.value)} />
            </div>
          </div>
        )}

        {s.payment_methods.includes("qrph") && (
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="qr">QR Ph code <span className="hint">— screenshot or download it from your bank/GCash merchant app</span></label>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              {s.qrph_image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.qrph_image} alt="Current QR Ph code" style={{ width: 140, height: 140, objectFit: "contain", background: "#fff", borderRadius: 8, border: "1px solid var(--border)" }} />
              ) : (
                <div className="muted" style={{ width: 140, height: 140, display: "grid", placeItems: "center", border: "1px dashed var(--border)", borderRadius: 8, fontSize: 13 }}>No QR yet</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                <input id="qr" type="file" accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      set("qrph_image", await imageToDataUrl(f, 700, "That image is too large. Please use a smaller screenshot of the QR code."));
                      setError("");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not read that image.");
                    }
                  }} />
                {s.qrph_image && (
                  <button type="button" className="btn small secondary" onClick={() => set("qrph_image", "")}>Remove QR</button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="pn">Payment note <span className="hint">— shown with the payment instructions (optional)</span></label>
          <textarea id="pn" maxLength={300} value={s.payment_note}
            placeholder="e.g. Please pay within 2 hours of booking or your slot may be released."
            onChange={(e) => set("payment_note", e.target.value)} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Hours &amp; booking rules</legend>
        <div className="row field">
          <div>
            <label htmlFor="open">Opens at</label>
            <select id="open" value={s.open_hour} onChange={(e) => set("open_hour", Number(e.target.value))}>
              {hourOptions.slice(0, 24).map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="close">Closes at</label>
            <select id="close" value={s.close_hour} onChange={(e) => set("close_hour", Number(e.target.value))}>
              {hourOptions.slice(1).map((h) => <option key={h} value={h}>{h === 24 ? "Midnight" : formatHour(h)}</option>)}
            </select>
          </div>
        </div>
        <div className="row field">
          <div>
            <label htmlFor="mpb">Max hours per booking</label>
            <input id="mpb" type="number" min={1} max={12} value={s.max_hours_per_booking}
              onChange={(e) => set("max_hours_per_booking", Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="mpd">Max hours per player per day</label>
            <input id="mpd" type="number" min={1} max={24} value={s.max_hours_per_day}
              onChange={(e) => set("max_hours_per_day", Number(e.target.value))} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="win">How many days ahead players can book</label>
          <input id="win" type="number" min={0} max={90} value={s.booking_window_days}
            onChange={(e) => set("booking_window_days", Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="ann">Announcement <span className="hint">— shown at the top of the booking page (leave blank to hide)</span></label>
          <textarea id="ann" maxLength={300} value={s.announcement}
            placeholder="e.g. Courts 3–4 closed Oct 5 for a tournament."
            onChange={(e) => set("announcement", e.target.value)} />
        </div>
      </fieldset>

      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      {saved && <div className="success" style={{ marginTop: 12 }}>Settings saved.</div>}
      <div className="actions" style={{ position: "sticky", bottom: 0, background: "var(--bg)", padding: "10px 0" }}>
        <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
      </div>
    </form>
  );
}
