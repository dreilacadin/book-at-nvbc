"use client";

import { todayManila } from "@/app/admin/shared";
import AddToCalendar from "@/components/AddToCalendar";
import CoachProfileForm, {
  type CoachFormValues,
} from "@/components/CoachProfileForm";
import FullScreenLoader from "@/components/FullScreenLoader";
import {
  availabilityText,
  genderText,
  initials,
  isBirthday,
  type AvailabilitySlot,
  type Gender,
} from "@/lib/coach";
import { formatDateLong, formatRange } from "@/lib/format";
import { formatPeso } from "@/lib/pricing";
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
};
type Me = {
  coach: Coach;
  qr: string | null;
  bookings: Booking[];
  push: { publicKey: string } | null;
  pushOn: boolean;
  activities: ActivityDef[];
};

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
  const [tab, setTab] = useState<"bookings" | "profile">("bookings");
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
          aria-selected={tab === "profile"}
          onClick={() => setTab("profile")}
        >
          My coach profile
        </button>
      </div>
      {tab === "bookings" ? (
        <Bookings me={me} requests={requests} reload={load} />
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
  const live = me.bookings.filter(
    (b) =>
      !(
        b.kind === "coaching" &&
        b.coaching_status === "requested" &&
        b.status !== "cancelled"
      ),
  );
  const upcoming = live
    .filter(
      (b) =>
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
      <section className="stack">
        <h2 style={{ margin: 0 }}>Upcoming</h2>
        {upcoming.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            Nothing coming up. Book a court with your coach code on the{" "}
            <Link href="/">booking page</Link>.
          </p>
        )}
        {upcoming.map((b) => (
          <BookingCard key={b.id} b={b} reload={reload} upcoming />
        ))}
      </section>
      {past.length > 0 && (
        <details className="bk-gone">
          <summary>Past and cancelled ({past.length})</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {past.map((b) => (
              <BookingCard key={b.id} b={b} reload={reload} />
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
        : b.status === "reserved"
          ? "Reserved — pay cash at the desk"
          : "Pending payment";

function BookingCard({
  b,
  reload,
  upcoming,
}: {
  b: Booking;
  reload: () => void;
  upcoming?: boolean;
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
      {b.misuse && (
        <div className="rejected-note">
          ⚠ NVBC flagged this booking: your coach code was used by someone else.
        </div>
      )}
      {upcoming && (
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
