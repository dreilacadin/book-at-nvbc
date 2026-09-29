"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { formatDateLong, formatHour, formatRange, halfHours } from "@/lib/format";
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
import { payByLabel } from "@/components/BookingPolicy";
import { AdminBookingCard } from "./BookingLookup";
import BookingsTab from "./BookingsTab";
import Notifications from "./Notifications";
import StaffTab from "./StaffTab";
import MembersTab from "./MembersTab";
import Overview from "./Overview";
import ReservedTimes from "./ReservedTimes";
import { api, AuthError, todayManila, type AdminBooking, type Court, type Settings } from "./shared";
import { SPORTS, sportEmoji, sportLabel, type Sport } from "@/lib/sports";
import FullScreenLoader from "@/components/FullScreenLoader";

const shortDate = (d: string | null) =>
  d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";

export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [me, setMe] = useState<{ name: string; id: number | null } | null>(null);
  const [tab, setTab] = useState<"overview" | "bookings" | "members" | "courts" | "staff" | "settings">("overview");
  const [bookingsDate, setBookingsDate] = useState(todayManila);
  // A booking opened from a notification (or /admin?booking=NV-…), shown in a pop-up card.
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [openBooking, setOpenBooking] = useState<AdminBooking | null>(null);

  // Links from push notifications: /admin?booking=NV-XXXXXX or /admin?tab=members
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const code = q.get("booking");
    if (code) setOpenCode(code);
    if (q.get("tab") === "members") setTab("members");
    if (code || q.get("tab")) window.history.replaceState(null, "", "/admin");
  }, []);

  const reloadOpenBooking = useCallback(async () => {
    if (!openCode) return setOpenBooking(null);
    try {
      setOpenBooking(await api<AdminBooking>(`/api/admin/bookings?code=${encodeURIComponent(openCode)}`));
    } catch (e) {
      if (e instanceof AuthError) setLoggedIn(false);
      setOpenCode(null);
      setOpenBooking(null);
    }
  }, [openCode]);
  useEffect(() => {
    if (loggedIn) reloadOpenBooking();
  }, [loggedIn, reloadOpenBooking]);

  useEffect(() => {
    api<{ loggedIn: boolean; name?: string; id?: number | null }>("/api/admin/login")
      .then((r) => {
        setLoggedIn(r.loggedIn);
        setMe(r.loggedIn ? { name: r.name ?? "", id: r.id ?? null } : null);
      })
      .catch(() => setLoggedIn(false));
  }, [loggedIn]);

  const onAuthError = useCallback((e: unknown) => {
    if (e instanceof AuthError) setLoggedIn(false);
  }, []);

  if (loggedIn === null) return <FullScreenLoader />;
  if (!loggedIn) return <Login onDone={() => setLoggedIn(true)} />;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1>Staff dashboard</h1>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {me && <span className="muted" style={{ fontSize: 14 }}>Logged in as <strong>{me.name}</strong></span>}
        <Notifications onOpenBooking={setOpenCode} onOpenMembers={() => setTab("members")} onAuthError={onAuthError} />
        <button
          className="btn small secondary"
          onClick={async () => {
            await api("/api/admin/logout", {});
            setLoggedIn(false);
          }}
        >
          Log out
        </button>
        </span>
      </div>
      <div className="tabs" role="tablist">
        {(["overview", "bookings", "members", "courts", "staff", "settings"] as const).map((t) => (
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
      {tab === "members" && <MembersTab onAuthError={onAuthError} />}
      {tab === "courts" && <CourtsTab onAuthError={onAuthError} />}
      {tab === "staff" && <StaffTab onAuthError={onAuthError} />}
      {openCode && openBooking && (
        <div className="backdrop" onClick={() => setOpenCode(null)}>
          <div className="card modal staff-modal" role="dialog" aria-modal="true" aria-label={`Booking ${openBooking.code}`}
            onClick={(e) => e.stopPropagation()}>
            <AdminBookingCard key={openBooking.id + openBooking.status + openBooking.payment_status + (openBooking.phase ?? "")}
              b={openBooking} onAuthError={onAuthError} onChanged={reloadOpenBooking}
              onOpenDate={(d) => { setOpenCode(null); setBookingsDate(d); setTab("bookings"); }} />
            <div className="actions">
              <button type="button" className="btn" onClick={() => setOpenCode(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {tab === "settings" && <SettingsTab onAuthError={onAuthError} />}
    </>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
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
          await api("/api/admin/login", { username, password });
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
        <label htmlFor="un">Username</label>
        <input id="un" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username}
          onChange={(e) => setUsername(e.target.value)} />
      </div>
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
      <ReservedTimes courts={courts} onAuthError={onAuthError} />
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
  const [notes, setNotes] = useState(court.notes);
  const [editingNote, setEditingNote] = useState(false);
  useEffect(() => {
    setName(court.name);
    setOrder(String(court.sort_order));
    setNotes(court.notes);
  }, [court]);
  const dirty = name !== court.name || order !== String(court.sort_order);
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", opacity: court.is_active ? 1 : 0.65 }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
      {!editingNote && (
        <button className="btn small secondary" onClick={() => setEditingNote(true)}>{court.notes ? "✎ Note" : "+ Note"}</button>
      )}
    </div>
    {court.notes && !editingNote && <div className="court-note" style={{ marginTop: 6 }}>ⓘ {court.notes}</div>}
    {editingNote && (
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        <input type="text" aria-label={`Note for ${court.name}`} maxLength={300} value={notes} style={{ flex: 1, minWidth: 220 }}
          placeholder="e.g. If it rains, this outdoor court may be moved to an indoor court." onChange={(e) => setNotes(e.target.value)} />
        <button className="btn small" onClick={() => { onSave({ notes: notes.trim() }); setEditingNote(false); }}>Save note</button>
        {court.notes && (
          <button className="btn small secondary" onClick={() => { onSave({ notes: "" }); setEditingNote(false); }}>Remove</button>
        )}
        <button className="btn small secondary" onClick={() => { setNotes(court.notes); setEditingNote(false); }}>Cancel</button>
      </div>
    )}
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

  if (!s) return error ? <div className="error">{error}</div> : <FullScreenLoader label="Loading settings…" />;

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
          // Only the rates switched on get a price column; with neither, it's one "Standard" price.
          const types = RATE_TYPES.filter((t) => t.id === "regular" || (t.id === "member" ? plan.memberRates : plan.coachRates));
          const regularLabel = types.length === 1 ? "Standard" : plan.memberRates ? "Non-member" : "Regular";
          const days = plan.weekendRates
            ? ([["weekday", "Weekdays"], ["weekend", "Weekends"]] as const)
            : ([["weekday", "Every day"]] as const);
          return (
            <div key={sp.id} className="price-plan">
              <div className="price-plan-head">
                <strong>{sp.emoji} {sp.label}</strong>
                <label>
                  <input type="checkbox" checked={plan.memberRates} onChange={(e) => setPlan({ memberRates: e.target.checked })} />
                  Member price
                </label>
                <label>
                  <input type="checkbox" checked={plan.coachRates} onChange={(e) => setPlan({ coachRates: e.target.checked })} />
                  Coach price
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
                      {types.map((t) => <th key={t.id}>{t.id === "regular" ? regularLabel : t.label}</th>)}
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
            <label htmlFor="cc">Coach code <span className="hint">(optional)</span></label>
            <input id="cc" type="text" maxLength={40} autoComplete="off" value={s.coach_code}
              onChange={(e) => set("coach_code", e.target.value)} placeholder="Leave blank = check at desk" />
          </div>
        </div>
        <p className="hint" style={{ margin: "8px 0 0" }}>
          The member price needs the player&apos;s own active member code (from Members). If you set a coach code, players
          must type it to get the coach price — share it only with your coaches. New prices apply to new bookings only.
        </p>
      </fieldset>

      <fieldset>
        <legend>Membership fees</legend>
        <div className="row">
          <div>
            <label htmlFor="mf-s">Student — ₱ per year</label>
            <input id="mf-s" type="number" min={0} step="0.01" required value={s.membership_fee_student}
              onChange={(e) => set("membership_fee_student", e.target.value === "" ? ("" as unknown as number) : Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="mf-a">Adult — ₱ per year</label>
            <input id="mf-a" type="number" min={0} step="0.01" required value={s.membership_fee_adult}
              onChange={(e) => set("membership_fee_adult", e.target.value === "" ? ("" as unknown as number) : Number(e.target.value))} />
          </div>
        </div>
        <p className="hint" style={{ margin: "8px 0 0" }}>New fees apply to new applications. Memberships last 365 days.</p>
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
