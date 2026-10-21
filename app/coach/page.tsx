"use client";

import { todayManila } from "@/app/admin/shared";
import AddToCalendar from "@/components/AddToCalendar";
import CoachProfileForm, {
  type CoachFormValues,
} from "@/components/CoachProfileForm";
import ClientInput from "@/components/ClientInput";
import FullScreenLoader from "@/components/FullScreenLoader";
import {
  availabilityText,
  genderText,
  groupClients,
  initials,
  knownClients,
  isBirthday,
  type AvailabilitySlot,
  type ClientSort,
  type KnownClient,
  type Gender,
} from "@/lib/coach";
import { coachSessionStage, minutesUntilStart } from "@/lib/booking-policy";
import { formatDateLong, formatRange } from "@/lib/format";
import { formatPeso, paymentLabel, type PaymentMethod } from "@/lib/pricing";
import { nowAtFacility } from "@/lib/time";
import {
  currentSubscription,
  isIos,
  isStandalone,
  pushSupported,
  subscribeDevice,
} from "@/lib/push-client";
import {
  setCustomActivities,
  sportEmoji,
  sportLabel,
  type ActivityDef,
} from "@/lib/sports";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Coach = {
  id: string;
  full_name: string;
  nickname: string;
  gender: Gender | "";
  gender_self: string;
  birthday: string | null;
  credentials: string;
  bio: string;
  email: string;
  mobile: string;
  phpa_id: string;
  has_phpa_photo: boolean;
  has_photo: boolean;
  photo_v: number;
  sports: string[];
  rates: string;
  availability: AvailabilitySlot[];
  status: "pending" | "active" | "inactive" | "rejected";
  coach_code: string | null;
  remind_bookings: boolean;
};
type Booking = {
  id: string;
  code: string;
  date: string;
  start_hour: number;
  end_hour: number;
  court_name: string;
  sport: string;
  status: string;
  payment_status: string;
  amount: number;
  kind: "own" | "coaching";
  customer_name: string | null;
  customer_contact: string | null;
  coaching_status: string | null;
  coaching_note: string;
  remind: boolean;
  misuse: boolean;
  group_courts: number;
  payment_method: string;
  phase: string | null;
  no_show: boolean;
  pay_after: boolean; // kept until after the session, paid then
  confirmed_at: string | null;
  arrived_at: string | null;
  total: number; // with a group's other courts
  client_name: string; // their own bookings: who it's with ("" = not set)
};
type Me = {
  coach: Coach;
  qr: string | null;
  bookings: Booking[];
  push: { publicKey: string } | null;
  pushOn: boolean;
  activities: ActivityDef[];
  payment: CoachPayment;
};
// How a coach can pay for a session afterwards (Settings → Payment methods).
type CoachPayment = { desk: boolean; online: PaymentMethod[] };

/** Their own booking, played (or partly), still to pay. */
const toPay = (b: Booking) =>
  b.kind === "own" && b.status !== "cancelled" && !b.no_show && b.total > 0 &&
  (b.payment_status === "unpaid" || b.payment_status === "rejected") &&
  ["over", "overdue"].includes(coachSessionStage(b, nowAtFacility()));

async function call(body: Record<string, unknown>) {
  const res = await fetch("/api/coaches/me", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Something went wrong.");
  return j;
}

/** The Coaches Dashboard: bookings and coaching requests, and the coach's profile with their code. */
export default function CoachDashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [out, setOut] = useState(false);
  const [tab, setTab] = useState<"bookings" | "clients" | "profile">("bookings");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const sub = await currentSubscription().catch(() => null);
      const res = await fetch(
        `/api/coaches/me${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ""}`,
        { cache: "no-store" },
      );
      if (res.status === 401) return setOut(true);
      const j: Me = await res.json();
      setCustomActivities(j.activities ?? []);
      setMe(j);
    } catch {
      setError("Couldn't load your dashboard.");
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(
      () => document.visibilityState === "visible" && load(),
      60_000,
    );
    return () => clearInterval(t);
  }, [load]);

  if (out)
    return (
      <div className="card" style={{ maxWidth: 420, margin: "32px auto" }}>
        <h1 style={{ marginTop: 0 }}>Coaches Dashboard</h1>
        <p>Please log in to see your bookings and profile.</p>
        <Link href="/coach/login" className="btn">
          Log in
        </Link>
      </div>
    );
  if (!me)
    return error ? (
      <div className="error">{error}</div>
    ) : (
      <FullScreenLoader label="Loading your dashboard…" />
    );

  const c = me.coach;
  const name = c.nickname || c.full_name.split(" ")[0];
  const birthday = isBirthday(c.birthday, todayManila());
  const requests = me.bookings.filter(
    (b) =>
      b.kind === "coaching" &&
      b.coaching_status === "requested" &&
      b.status !== "cancelled",
  );
  return (
    <div className="stack coach-dash">
      <div className="coach-dash-head">
        {c.has_photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/coaches/photo?id=${c.id}&v=${c.photo_v}`}
            alt=""
            className="coach-avatar"
          />
        ) : (
          <span className="coach-avatar coach-initials" aria-hidden>
            {initials(name)}
          </span>
        )}
        <div>
          <h1 style={{ margin: 0 }}>Hi, {name}!</h1>
          <span className="muted">Coaches Dashboard</span>
        </div>
        <button
          type="button"
          className="btn small secondary"
          style={{ marginLeft: "auto" }}
          onClick={async () => {
            await fetch("/api/coaches/logout", { method: "POST" });
            window.location.href = "/coach/login";
          }}
        >
          Log out
        </button>
      </div>
      {birthday && (
        <div className="notice coach-birthday">
          🎂 Happy birthday, {name}! Everyone at NVBC wishes you a great year
          ahead — on and off the court.
        </div>
      )}
      {!c.has_photo && (
        <div className="notice">
          📷 Add a profile photo so customers can recognise you when choosing a
          coach.{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => setTab("profile")}
          >
            Add it in your profile
          </button>
        </div>
      )}
      {c.status === "pending" && (
        <div className="notice">
          ⏳ Your account is waiting for NVBC to approve it. Your coach code
          will appear here once it&apos;s approved, and customers will be able
          to ask you for sessions.
        </div>
      )}
      {c.status === "inactive" && (
        <div className="error">
          Your coach account is inactive, so your coach code doesn&apos;t work
          for now. Please contact NVBC.
        </div>
      )}
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "bookings"}
          onClick={() => setTab("bookings")}
        >
          Bookings{requests.length ? ` (${requests.length} new)` : ""}
        </button>
        <button
          role="tab"
          aria-selected={tab === "clients"}
          onClick={() => setTab("clients")}
        >
          Clients
        </button>
        <button
          role="tab"
          aria-selected={tab === "profile"}
          onClick={() => setTab("profile")}
        >
          My coach profile
        </button>
      </div>
      {tab === "bookings" ? (
        <Bookings me={me} requests={requests} reload={load} />
      ) : tab === "clients" ? (
        <Clients me={me} reload={load} />
      ) : (
        <Profile me={me} reload={load} />
      )}
    </div>
  );
}

function Bookings({
  me,
  requests,
  reload,
}: {
  me: Me;
  requests: Booking[];
  reload: () => void;
}) {
  const today = todayManila();
  const clients = knownClients(me.bookings, today);
  const live = me.bookings.filter(
    (b) =>
      !(
        b.kind === "coaching" &&
        b.coaching_status === "requested" &&
        b.status !== "cancelled"
      ),
  );
  const unpaid = live.filter(toPay).sort((a, b) => a.date.localeCompare(b.date) || a.start_hour - b.start_hour);
  const upcoming = live
    .filter(
      (b) =>
        !toPay(b) &&
        b.date >= today &&
        b.status !== "cancelled" &&
        b.coaching_status !== "declined" &&
        b.coaching_status !== "cancelled",
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.start_hour - b.start_hour,
    );
  const past = live.filter((b) => !upcoming.includes(b));
  return (
    <div className="stack">
      <PushToggle me={me} reload={reload} />
      {requests.length > 0 && (
        <section className="stack">
          <h2 style={{ margin: 0 }}>🎓 Coaching requests</h2>
          {requests.map((b) => (
            <RequestCard key={b.id} b={b} reload={reload} />
          ))}
        </section>
      )}
      {unpaid.length > 0 && (
        <section className="stack">
          <h2 style={{ margin: 0 }}>💳 To pay</h2>
          {unpaid.map((b) => (
            <BookingCard key={b.id} b={b} reload={reload} payment={me.payment} clients={clients} upcoming />
          ))}
        </section>
      )}
      <section className="stack">
        <h2 style={{ margin: 0 }}>Upcoming</h2>
        {upcoming.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            Nothing coming up. Book a court with your coach code on the{" "}
            <Link href="/">booking page</Link>.
          </p>
        )}
        {upcoming.map((b) => (
          <BookingCard key={b.id} b={b} reload={reload} payment={me.payment} clients={clients} upcoming />
        ))}
      </section>
      {past.length > 0 && (
        <details className="bk-gone">
          <summary>Past and cancelled ({past.length})</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {past.map((b) => (
              <BookingCard key={b.id} b={b} reload={reload} clients={clients} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

const statusText = (b: Booking) =>
  b.status === "cancelled"
    ? "Cancelled"
    : b.kind === "coaching"
      ? ({
          accepted: "Session accepted",
          declined: "You declined",
          cancelled: "Cancelled",
          requested: "Requested",
        }[b.coaching_status ?? ""] ?? "")
      : b.status === "confirmed"
        ? "Confirmed"
        : b.payment_status === "for_verification"
          ? "Payment sent"
          : b.pay_after
            ? "Pay after your session"
            : b.status === "reserved"
              ? "Reserved — pay cash at the desk"
              : "Pending payment";

function BookingCard({
  b,
  reload,
  upcoming,
  payment,
  clients,
}: {
  b: Booking;
  reload: () => void;
  upcoming?: boolean;
  payment?: CoachPayment;
  clients: KnownClient[];
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={`card coach-bk${b.status === "cancelled" ? " gone" : ""}`}>
      <div className="coach-bk-top">
        <strong>
          {formatDateLong(b.date)} · {formatRange(b.start_hour, b.end_hour)}
        </strong>
        <span
          className={`badge ${b.status === "cancelled" ? "grey" : b.kind === "coaching" ? "" : b.status === "confirmed" ? "" : "pending"}`}
        >
          {statusText(b)}
        </span>
      </div>
      <div className="muted">
        {sportEmoji(b.sport)} {b.court_name}
        {b.group_courts
          ? ` + ${b.group_courts} more court${b.group_courts > 1 ? "s" : ""}`
          : ""}{" "}
        ·{" "}
        {b.kind === "own"
          ? `Your booking · ${formatPeso(b.amount)}`
          : `Coaching ${b.customer_name ?? "a customer"}`}
        {b.customer_contact && ` · ${b.customer_contact}`} ·{" "}
        <span className="mono">{b.code}</span>
      </div>
      {b.kind === "own" && b.status !== "cancelled" && <ClientEdit b={b} reload={reload} clients={clients} />}
      {b.misuse && (
        <div className="rejected-note">
          ⚠ NVBC flagged this booking: your coach code was used by someone else.
        </div>
      )}
      {upcoming && b.kind === "own" && b.status !== "cancelled" && payment && (
        <OwnBookingActions b={b} payment={payment} reload={reload} />
      )}
      {upcoming && !["over", "overdue"].includes(coachSessionStage(b, nowAtFacility())) && (
        <>
          <label className="check-row">
            <input
              type="checkbox"
              checked={b.remind}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                try {
                  await call({
                    action: "remind",
                    bookingId: b.id,
                    on: e.target.checked,
                  });
                  reload();
                } finally {
                  setBusy(false);
                }
              }}
            />
            <span>Remind me 1 hour before (notification and email)</span>
          </label>
          <div className="folds" style={{ margin: 0 }}>
            <AddToCalendar
              code={b.code}
              sport={b.sport}
              courts={b.court_name}
              date={b.date}
              startHour={b.start_hour}
              endHour={b.end_hour}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The coach's own booking: still coming? (keep it / can't make it), "I'm here" from 30 minutes
 * before, and once it's over, paying for it (cash at the desk, confirmed by staff, or online).
 */
function OwnBookingActions({ b, payment, reload }: { b: Booking; payment: CoachPayment; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stage = coachSessionStage(b, nowAtFacility());
  const unpaid = b.total > 0 && (b.payment_status === "unpaid" || b.payment_status === "rejected");
  const run = async (action: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError("");
    try {
      await call({ action, bookingId: b.id });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  const cancel = () =>
    run("cancel", `Cancel your booking (${formatRange(b.start_hour, b.end_hour)}, ${b.court_name})? The court opens up for others.`);

  if (b.no_show) return null;
  if (stage === "over" || stage === "overdue") {
    if (!unpaid)
      return b.payment_status === "for_verification" ? (
        <p className="hint" style={{ margin: 0 }}>Payment sent — the front desk will confirm it. Thanks!</p>
      ) : null;
    return (
      <div className="coach-status coach-pay">
        <div>
          <strong>Please pay {formatPeso(b.total)}</strong> for this session
          {payment.desk && payment.online.length
            ? ` — at the front desk, or online (${payment.online.map(paymentLabel).join(", ")}).`
            : payment.desk ? " at the front desk." : ` online (${payment.online.map(paymentLabel).join(", ")}).`}
        </div>
        <div className="card-actions" style={{ marginTop: 0 }}>
          {payment.desk && (
            <button type="button" className="btn small" disabled={busy}
              onClick={() => run("paid-desk", `Did you pay ${formatPeso(b.total)} in cash at the front desk? The desk will confirm it.`)}>
              ✓ I paid at the desk
            </button>
          )}
          {payment.online.length > 0 && (
            <a className={`btn small${payment.desk ? " secondary" : ""}`} href={`/my-booking#${encodeURIComponent(b.code)}`}>
              Pay online
            </a>
          )}
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    );
  }
  return (
    <div className="coach-status">
      {b.pay_after && unpaid && (
        <p className="coach-status-note">
          💳 <strong>Pay after your session.</strong> This booking is kept for you (it won&apos;t be released). You&apos;ll be
          reminded when it ends.
        </p>
      )}
      <div className="card-actions" style={{ marginTop: 0, alignItems: "center" }}>
        {stage === "arriving" && !b.arrived_at && (
          <button type="button" className="btn small" disabled={busy} onClick={() => run("arrived")}>📍 I&apos;m here</button>
        )}
        {b.arrived_at ? (
          <span className="badge">📍 Checked in</span>
        ) : b.confirmed_at ? (
          <span className="badge">✓ You&apos;re coming</span>
        ) : stage === "before" ? (
          <button type="button" className="btn small" disabled={busy} onClick={() => run("confirm")}>✓ Yes, I&apos;m coming</button>
        ) : null}
        {!b.arrived_at && b.phase === null && minutesUntilStart(b.date, b.start_hour, nowAtFacility()) > 0 && (
          <button type="button" className="btn small secondary danger-text" disabled={busy} onClick={cancel}>Can&apos;t make it</button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

/** Who one of the coach's own bookings is with: shown, and set or changed in place. */
function ClientEdit({ b, reload, clients }: { b: Booking; reload: () => void; clients: KnownClient[] }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(b.client_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!editing)
    return (
      <div className="coach-client">
        👤 {b.client_name ? <strong>{b.client_name}</strong> : <span className="muted">No client set</span>}{" "}
        <button type="button" className="link-btn" onClick={() => { setValue(b.client_name); setEditing(true); }}>
          {b.client_name ? "Change" : "Add client"}
        </button>
      </div>
    );
  return (
    <form
      className="coach-client-edit"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await call({ action: "client", bookingId: b.id, client: value });
          setEditing(false);
          reload();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't save.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <ClientInput value={value} onChange={setValue} clients={clients} autoFocus placeholder="Client's name" label="Client's name" />
      <button className="btn small" disabled={busy}>Save</button>
      <button type="button" className="btn small secondary" onClick={() => setEditing(false)}>Cancel</button>
      {error && <div className="error">{error}</div>}
    </form>
  );
}

/** The Clients tab: the coach's bookings grouped by client, sortable and searchable. */
function Clients({ me, reload }: { me: Me; reload: () => void }) {
  const [sort, setSort] = useState<ClientSort>("recent");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const today = todayManila();
  const all = groupClients(me.bookings, today, sort);
  const clients = knownClients(me.bookings, today);
  const query = q.trim().toLowerCase();
  const list = query ? all.filter((c) => c.name.toLowerCase().includes(query) || c.contact.includes(query)) : all;
  const named = all.filter((c) => c.key).length;
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Your bookings grouped by client: the client you add to your own bookings, and customers who requested coaching with you.
      </p>
      <div className="client-toolbar">
        <input type="search" placeholder="Search clients" aria-label="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Sort clients" value={sort} onChange={(e) => setSort(e.target.value as ClientSort)}>
          <option value="recent">Next / most recent</option>
          <option value="name">Name (A–Z)</option>
          <option value="sessions">Most sessions</option>
        </select>
      </div>
      {named === 0 && (
        <div className="notice info">
          No clients yet. Add a client to a booking with <strong>Add client</strong> on the Bookings tab, or type it in the
          Client box when you book with your coach code.
        </div>
      )}
      {list.length === 0 && named > 0 && <p className="muted">No clients match “{q}”.</p>}
      {list.map((c) => {
        const isOpen = open === c.key;
        return (
          <div key={c.key || "-"} className={`card client-card${c.key ? "" : " no-client"}`}>
            <button type="button" className="client-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.key)}>
              <span>
                <strong>{c.name}</strong>
                {c.contact && <span className="muted"> · {c.contact}</span>}
                <small>
                  {c.bookings.length} session{c.bookings.length === 1 ? "" : "s"}
                  {c.next ? ` · next ${formatDateLong(c.next)}` : c.last ? ` · last ${formatDateLong(c.last)}` : ""}
                  {c.unpaid ? ` · ⚠ ${c.unpaid} not paid` : ""}
                </small>
              </span>
              <span aria-hidden="true">{isOpen ? "▴" : "▾"}</span>
            </button>
            {isOpen && (
              <ul className="client-sessions">
                {c.bookings.map((b) => {
                  const full = me.bookings.find((x) => x.id === b.id)!;
                  return (
                    <li key={b.id}>
                      <div>
                        <strong>{formatDateLong(b.date)}</strong> · {formatRange(b.start_hour, b.end_hour)}
                        <div className="muted">
                          {sportEmoji(full.sport)} {b.court_name} · {b.kind === "own" ? `${formatPeso(b.total)} · ${statusText(full)}` : `Coaching · ${statusText(full)}`}
                        </div>
                      </div>
                      {b.kind === "own" && <ClientEdit b={full} reload={reload} clients={clients} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RequestCard({ b, reload }: { b: Booking; reload: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const answer = async (accept: boolean) => {
    setBusy(true);
    setError("");
    try {
      await call({ action: "respond", bookingId: b.id, accept, note });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card coach-bk request">
      <div className="coach-bk-top">
        <strong>{b.customer_name}</strong>
        <span className="badge pending">New request</span>
      </div>
      <div>
        {formatDateLong(b.date)} · {formatRange(b.start_hour, b.end_hour)} ·{" "}
        {sportEmoji(b.sport)} {sportLabel(b.sport)} · {b.court_name}
      </div>
      <div className="muted">
        Contact: {b.customer_contact} · booking{" "}
        <span className="mono">{b.code}</span>
      </div>
      <input
        placeholder="Message to the customer (optional)"
        maxLength={300}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <div className="error">{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => answer(true)}
        >
          ✓ Accept
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => answer(false)}
        >
          Decline
        </button>
      </div>
    </div>
  );
}

function PushToggle({ me, reload }: { me: Me; reload: () => void }) {
  const [msg, setMsg] = useState("");
  if (!me.push) return null;
  if (
    typeof window !== "undefined" &&
    (!window.isSecureContext || !pushSupported())
  )
    return isIos() && !isStandalone() ? (
      <p className="hint" style={{ margin: 0 }}>
        On iPhone/iPad, add NVBC to your Home Screen to get notifications.
      </p>
    ) : null;
  return (
    <div className="coach-push">
      {me.pushOn ? (
        <span>🔔 Notifications are on for this device.</span>
      ) : (
        <button
          type="button"
          className="btn small secondary"
          onClick={async () => {
            try {
              if ((await Notification.requestPermission()) !== "granted")
                return setMsg("Notifications are blocked for this site.");
              const sub = await subscribeDevice(me.push!.publicKey);
              await call({ action: "push-on", subscription: sub.toJSON() });
              reload();
            } catch (e) {
              setMsg(
                e instanceof Error
                  ? e.message
                  : "Couldn't turn on notifications.",
              );
            }
          }}
        >
          🔔 Turn on notifications
        </button>
      )}
      <span className="hint">
        New coaching requests, bookings made with your code, and reminders.
      </span>
      {msg && <span className="hint">{msg}</span>}
    </div>
  );
}

function Profile({ me, reload }: { me: Me; reload: () => void }) {
  const c = me.coach;
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<CoachFormValues>({
    fullName: c.full_name,
    nickname: c.nickname,
    gender: c.gender,
    genderSelf: c.gender_self,
    birthday: c.birthday ?? "",
    email: c.email,
    mobile: c.mobile,
    phpaId: c.phpa_id,
    sports: c.sports,
    rates: c.rates,
    availability: c.availability,
    credentials: c.credentials,
    bio: c.bio,
  });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await call({ action: "profile", ...values });
      setEditing(false);
      setMsg("Profile saved.");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  if (editing)
    return (
      <form onSubmit={save} className="stack">
        <div className="card">
          <CoachProfileForm
            values={values}
            onChange={setValues}
            photoUrl={c.has_photo ? `/api/coaches/photo?id=${c.id}` : null}
            idPhotoUrl={
              c.has_phpa_photo ? `/api/coaches/photo?id=${c.id}&kind=id` : null
            }
          />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button
            type="button"
            className="btn secondary"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
          <button className="btn" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    );

  return (
    <div className="stack">
      {msg && <div className="success">{msg}</div>}
      <div className={`coach-card${c.status === "inactive" ? " inactive" : ""}`}>
        <div className="coach-card-top">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {c.has_photo ? (
            <img
              src={`/api/coaches/photo?id=${c.id}&v=${c.photo_v}`}
              alt=""
              className="coach-photo"
            />
          ) : (
            <button
              type="button"
              className="coach-photo coach-initials"
              title="Add a profile photo"
              onClick={() => {
                setMsg("");
                setEditing(true);
              }}
            >
              {initials(c.nickname || c.full_name)}
              <small>+ photo</small>
            </button>
          )}
          <div>
            <div className="coach-card-label">NVBC Coach{c.status === "inactive" && " · Inactive"}</div>
            <div className="coach-card-name">{c.nickname || c.full_name}</div>
            <div className="coach-card-sub">
              {c.sports
                .map((s) => `${sportEmoji(s)} ${sportLabel(s)}`)
                .join(" · ")}
            </div>
            <div className="coach-card-sub coach-card-id">
              <span className="mono">PHPA ID </span>
              {c.phpa_id ? (
                <>
                  {c.phpa_id}
                  {c.has_phpa_photo && " · ID photo on file"}
                </>
              ) : (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setMsg("");
                    setEditing(true);
                  }}
                >
                  not added — add it
                </button>
              )}
            </div>
          </div>
        </div>
        {me.qr && c.coach_code ? (
          <div className="coach-card-code">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={me.qr} alt={`QR code for coach code ${c.coach_code}`} />
            <div className="mono coach-code">{c.coach_code}</div>
            <p>
              Your coach code — type it when booking at the Coach rate. Keep it
              to yourself.
            </p>
          </div>
        ) : (
          <p className="coach-card-sub">
            Your coach code appears here once NVBC approves your account.
          </p>
        )}
      </div>
      <div className="card">
        <dl className="member-details">
          <div>
            <dt>Legal name</dt>
            <dd>{c.full_name}</dd>
          </div>
          <div>
            <dt>Gender</dt>
            <dd>{c.gender ? genderText(c.gender, c.gender_self) : "—"}</dd>
          </div>
          <div>
            <dt>Birthday</dt>
            <dd>{c.birthday ? formatDateLong(c.birthday) : "—"}</dd>
          </div>
          <div>
            <dt>Mobile</dt>
            <dd>{c.mobile}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{c.email}</dd>
          </div>
          <div>
            <dt>Available</dt>
            <dd>{availabilityText(c.availability)}</dd>
          </div>
          <div>
            <dt>Rates</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{c.rates}</dd>
          </div>
          <div>
            <dt>Credentials</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{c.credentials || "—"}</dd>
          </div>
          <div>
            <dt>Bio</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{c.bio || "—"}</dd>
          </div>
        </dl>
        <div className="actions" style={{ justifyContent: "flex-start" }}>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setMsg("");
              setEditing(true);
            }}
          >
            ✎ Edit profile
          </button>
        </div>
      </div>
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setMsg("");
          try {
            await call({
              action: "password",
              current: pw.current,
              next: pw.next,
            });
            setPw({ current: "", next: "" });
            setMsg("Password changed. Your other devices are logged out.");
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Couldn't change your password.",
            );
          }
        }}
      >
        <h2 style={{ margin: 0 }}>Change password</h2>
        <div className="row">
          <input
            type="password"
            aria-label="Current password"
            placeholder="Current password"
            required
            autoComplete="current-password"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
          />
          <input
            type="password"
            aria-label="New password"
            placeholder="New password (8+ characters)"
            required
            minLength={8}
            autoComplete="new-password"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <div>
          <button className="btn small secondary">Change password</button>
        </div>
      </form>
    </div>
  );
}
