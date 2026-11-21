"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import PasswordInput from "@/components/PasswordInput";
import StaffRolePicker from "@/components/StaffRolePicker";
import { confirmDialog, copyDialog, promptDialog } from "@/components/Dialogs";
import { ageOn } from "@/lib/membership";
import { INVITE_DAYS, inviteState, roleName, ROLE_LABEL, SIGNUP_ROLES, STAFF_ROLES, type StaffRole } from "@/lib/staff";
import ActivityLog from "./ActivityLog";
import { api, todayManila } from "./shared";

type StaffUser = {
  id: number;
  username: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  created_by: string;
  role: StaffRole;
  is_stringer: boolean;
  first_name: string;
  last_name: string;
  birthdate: string | null;
  mobile: string;
  email: string;
  pending: boolean;
  invite_id: number | null;
  invite_label: string | null;
  approved_by: string | null;
  approved_at: string | null;
};
type Me = { id: number | null; username: string; name: string; role: "owner" | "manager" | "staff" };
type Invite = {
  id: number; token: string; label: string; roles: string[]; created_by: string; created_at: string;
  expires_at: string | null; revoked_at: string | null; revoked_by: string | null; signups: number;
};
type View = "team" | "links" | "log";
type Filter = "all" | StaffRole | "disabled";

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "Never";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
const birthday = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const inviteLink = (token: string) => `${window.location.origin}/team/join#${token}`;
const ROLE_PLURAL: Record<StaffRole, string> = { manager: "Managers", staff: "Staff", scholar: "Scholars", stringer: "Stringers" };
const rolesText = (roles: string[]) => roles.map((r) => ROLE_PLURAL[r as StaffRole] ?? r).join(", ");

/** First and last name for the form: the saved ones, or the display name split at its last space (older accounts). */
function splitName(u: StaffUser) {
  if (u.first_name || u.last_name) return { firstName: u.first_name, lastName: u.last_name };
  const i = u.display_name.lastIndexOf(" ");
  return i > 0 ? { firstName: u.display_name.slice(0, i), lastName: u.display_name.slice(i + 1) } : { firstName: u.display_name, lastName: "" };
}

/** Staff accounts: each person logs in with their own username and password. */
export default function StaffTab({ onAuthError, onOpenBooking }: { onAuthError: (e: unknown) => void; onOpenBooking: (code: string) => void }) {
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<View>("team");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<StaffUser | "new" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ users: StaffUser[]; me: Me; invites: Invite[] }>("/api/admin/users");
      setUsers(r.users);
      setMe(r.me);
      setInvites(r.invites);
      // Keep the open account's window up to date.
      setOpen((o) => (o && o !== "new" ? r.users.find((u) => u.id === o.id) ?? null : o));
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [onAuthError]);
  useEffect(() => { load(); }, [load]);

  /** Sends one change; returns true when it worked. */
  const act = useCallback(async (body: Record<string, unknown>, done?: string) => {
    setError("");
    setNotice("");
    try {
      await api("/api/admin/users", body);
      if (done) setNotice(done);
      await load();
      return true;
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Failed");
      return false;
    }
  }, [load, onAuthError]);

  const manage = me?.role === "owner" || me?.role === "manager";
  const team = useMemo(() => (users ?? []).filter((u) => !u.pending), [users]);
  const pending = useMemo(() => (users ?? []).filter((u) => u.pending), [users]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: team.length, manager: 0, staff: 0, scholar: 0, stringer: 0, disabled: 0 };
    for (const u of team) {
      if (!u.is_active) c.disabled++;
      else {
        c[u.role]++;
        if (u.role === "scholar" && u.is_stringer) c.stringer++; // Scholars who string count as Stringers too
      }
    }
    return c;
  }, [team]);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const digits = q.replace(/\D/g, "");
    return team.filter((u) => {
      if (filter === "disabled" ? u.is_active : filter !== "all" && (!u.is_active || (u.role !== filter && !(filter === "stringer" && u.is_stringer)))) return false;
      const hay = `${u.display_name} ${u.username} ${u.email} ${ROLE_LABEL[u.role]}`.toLowerCase();
      return words.every((w) => hay.includes(w)) || (digits.length >= 4 && u.mobile.replace(/\D/g, "").includes(digits));
    });
  }, [team, q, filter]);
  const activeLinks = invites.filter((i) => inviteState(i) === "active").length;

  if (!users) return error ? <div className="error">{error}</div> : <FullScreenLoader label="Loading staff…" />;

  return (
    <div className="stack" style={{ maxWidth: 880 }}>
      {manage && (
        <div className="segmented staff-views" role="radiogroup" aria-label="Show">
          <button type="button" role="radio" aria-checked={view === "team"} onClick={() => setView("team")}>
            Team<small>{team.length}{pending.length ? ` · ${pending.length} new` : ""}</small>
          </button>
          <button type="button" role="radio" aria-checked={view === "links"} onClick={() => setView("links")}>
            Registration links<small>{activeLinks} active</small>
          </button>
          <button type="button" role="radio" aria-checked={view === "log"} onClick={() => setView("log")}>
            Activity log<small>who did what</small>
          </button>
        </div>
      )}
      {notice && <div className="success">{notice}</div>}
      {error && <div className="error">{error}</div>}

      {view === "team" && (
        <>
          {manage && pending.length > 0 && (
            <section className="card stack staff-pending">
              <h3 style={{ margin: 0 }}>Waiting for approval <span className="badge member-pending">{pending.length}</span></h3>
              <p className="hint" style={{ margin: 0 }}>They signed up with a registration link and can log in once approved.</p>
              {pending.map((u) => <PendingRow key={u.id} u={u} act={act} />)}
            </section>
          )}

          <div className="voucher-toolbar">
            <input type="search" aria-label="Search staff" placeholder="🔍 Name, username, mobile or email" value={q} onChange={(e) => setQ(e.target.value)} />
            {manage && <button type="button" className="btn" onClick={() => setOpen("new")}>+ Add account</button>}
          </div>
          <div className="staff-filters" role="radiogroup" aria-label="Role">
            {(["all", ...STAFF_ROLES, "disabled"] as Filter[]).filter((f) => f === "all" || counts[f] > 0).map((f) => (
              <button key={f} type="button" role="radio" className="chip" aria-checked={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "Everyone" : f === "disabled" ? "Disabled" : ROLE_PLURAL[f]} <span className="muted">{counts[f]}</span>
              </button>
            ))}
          </div>

          <div className="card staff-list" style={{ padding: 0 }}>
            {team.length === 0 && <p className="muted staff-empty">No staff accounts yet. Add the first one, or send a registration link.</p>}
            {team.length > 0 && shown.length === 0 && <p className="muted staff-empty">No one matches. Try another name, or choose Everyone.</p>}
            {shown.map((u) => (
              <div key={u.id} className={`staff-row${u.is_active ? "" : " disabled"}`}>
                <div className="staff-who">
                  <strong>{u.display_name}</strong>
                  <span className={`badge ${u.role === "manager" ? "" : "grey"}`}>{roleName(u.role, u.is_stringer)}</span>
                  {u.id === me?.id && <span className="badge">You</span>}
                  {!u.is_active && <span className="badge member-expired">Disabled</span>}
                  <div className="staff-meta">
                    <span className="mono">{u.username}</span>
                    {u.mobile && <a href={`tel:${u.mobile}`}>{u.mobile}</a>}
                    {u.email && <span>{u.email}</span>}
                  </div>
                </div>
                <div className="staff-last">
                  <span className="hint">Last login</span>
                  <span>{when(u.last_login_at)}</span>
                </div>
                <div className="staff-actions">
                  {manage ? (
                    <button type="button" className="btn small secondary" onClick={() => setOpen(u)}>Manage</button>
                  ) : u.id === me?.id ? (
                    <ChangePassword u={u} self act={act} />
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <p className="hint" style={{ margin: 0 }}>
            Everyone gets their own login. Logged-in staff also see full names on the <strong>Book a court</strong> page and can open, confirm,
            edit or cancel bookings right from the grid. Disabling or deleting an account logs that person out at once.
            {me?.id === null && <> You&apos;re logged in as the <strong>owner</strong> (the recovery login using the ADMIN_PASSWORD setting), which always works, even if every account is disabled.</>}
          </p>
        </>
      )}

      {view === "links" && manage && <InvitesView invites={invites} act={act} />}
      {view === "log" && manage && <ActivityLog onOpenBooking={onOpenBooking} onAuthError={onAuthError} />}

      {open && (
        <AccountModal
          u={open === "new" ? null : open}
          self={open !== "new" && open.id === me?.id}
          act={act}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

type Act = (body: Record<string, unknown>, done?: string) => Promise<boolean>;

function ChangePassword({ u, self, act }: { u: StaffUser; self: boolean; act: Act }) {
  return (
    <button type="button" className="btn small secondary" onClick={async () => {
      const pw = await promptDialog(
        self ? "Your new password (at least 8 characters):"
          : `New password for ${u.display_name} (at least 8 characters). They'll be logged out and must use the new password.`,
        { title: self ? "Change my password" : "Reset password", password: true, required: true, confirmLabel: "Save password" }
      );
      if (pw) await act({ action: "password", id: u.id, password: pw }, `Password changed for ${u.display_name}.`);
    }}>
      {self ? "Change my password" : "Reset password"}
    </button>
  );
}

/** A sign-up from a registration link: its details, Approve (as the role they chose) or Decline. */
function PendingRow({ u, act }: { u: StaffUser; act: Act }) {
  const role = roleName(u.role, u.is_stringer);
  return (
    <div className="staff-pending-row">
      <div>
        <strong>{u.display_name}</strong> <span className="badge grey">{role}</span>
        <div className="staff-meta">
          <span className="mono">{u.username}</span>
          {u.mobile && <a href={`tel:${u.mobile}`}>{u.mobile}</a>}
          {u.email && <span>{u.email}</span>}
          {u.birthdate && <span>Born {birthday(u.birthdate)} ({ageOn(u.birthdate, todayManila())})</span>}
        </div>
        <div className="hint">Signed up {when(u.created_at)}{u.invite_label ? ` · link “${u.invite_label}”` : ""}</div>
      </div>
      <div className="staff-actions">
        <button type="button" className="btn small" onClick={async () =>
          (await confirmDialog(`Approve ${u.display_name} as ${role}? They can log in straight away. You can change their role later under Manage.`, { confirmLabel: "Approve" })) &&
          act({ action: "approve", id: u.id }, `${u.display_name} is approved and can log in.`)}>Approve</button>
        <button type="button" className="btn small secondary danger-text" onClick={async () =>
          (await confirmDialog(`Decline ${u.display_name}'s sign-up? Their account is removed.`, { confirmLabel: "Decline", danger: true })) &&
          act({ action: "decline", id: u.id }, `${u.display_name}'s sign-up was declined.`)}>Decline</button>
      </div>
    </div>
  );
}

/** Add an account (u = null), or see and change one: details, role, password, disable, delete. */
function AccountModal({ u, self, act, onClose }: { u: StaffUser | null; self: boolean; act: Act; onClose: () => void }) {
  const [f, setF] = useState(() => ({
    ...(u ? splitName(u) : { firstName: "", lastName: "" }),
    birthdate: u?.birthdate ?? "",
    mobile: u?.mobile ?? "",
    email: u?.email ?? "",
    username: "",
    password: "",
    role: (u?.role ?? "staff") as StaffRole,
    stringer: u?.is_stringer ?? false,
  }));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const details = { firstName: f.firstName, lastName: f.lastName, birthdate: f.birthdate, mobile: f.mobile, email: f.email };
    const ok = u
      ? await act({ action: "update", id: u.id, ...details, ...(self ? {} : { role: f.role, stringer: f.stringer }) }, `${f.firstName} ${f.lastName}: saved.`)
      : await act({ action: "create", ...details, username: f.username, password: f.password, role: f.role, stringer: f.stringer },
        `Account created for ${f.firstName}. Share the username and password with them privately.`);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="card modal staff-account" role="dialog" aria-modal="true" aria-label={u ? u.display_name : "Add an account"}
        onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="staff-account-head">
          <h2 style={{ margin: 0 }}>{u ? u.display_name : "Add an account"}</h2>
          {u && (
            <p className="hint" style={{ margin: "4px 0 0" }}>
              <span className="mono">{u.username}</span> ·{" "}
              {u.invite_id ? `signed up with ${u.invite_label ? `the link “${u.invite_label}”` : "a registration link"}` : `added by ${u.created_by || "—"}`}, {day(u.created_at)}
              {u.approved_by ? ` · approved by ${u.approved_by}` : ""} · last login {when(u.last_login_at)}
            </p>
          )}
        </div>

        <div className="row">
          <div><label htmlFor="sa-first">First name</label><input id="sa-first" required maxLength={40} autoComplete="off" value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} /></div>
          <div><label htmlFor="sa-last">Last name</label><input id="sa-last" required maxLength={40} autoComplete="off" value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} /></div>
        </div>
        <div className="row">
          <div><label htmlFor="sa-bd">Birthday <span className="hint">optional</span></label><input id="sa-bd" type="date" value={f.birthdate} onChange={(e) => set({ birthdate: e.target.value })} /></div>
          <div><label htmlFor="sa-mob">Mobile <span className="hint">optional</span></label><input id="sa-mob" type="tel" inputMode="tel" maxLength={20} placeholder="0917 123 4567" value={f.mobile} onChange={(e) => set({ mobile: e.target.value })} /></div>
        </div>
        <div><label htmlFor="sa-em">Email <span className="hint">optional</span></label><input id="sa-em" type="email" maxLength={120} value={f.email} onChange={(e) => set({ email: e.target.value })} /></div>

        {!u && (
          <div className="row">
            <div>
              <label htmlFor="sa-user">Username</label>
              <input id="sa-user" required minLength={3} maxLength={30} autoCapitalize="none" spellCheck={false} autoComplete="off"
                pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,29}" title="3–30 letters, numbers, dots, dashes or underscores"
                value={f.username} onChange={(e) => set({ username: e.target.value })} />
            </div>
            <div>
              <label htmlFor="sa-pw">Password <span className="hint">8+ characters</span></label>
              <PasswordInput id="sa-pw" required minLength={8} maxLength={200} autoComplete="new-password" value={f.password} onChange={(e) => set({ password: e.target.value })} />
            </div>
          </div>
        )}

        <div>
          <label>Role {self && <span className="hint">· you can&apos;t change your own</span>}</label>
          <StaffRolePicker roles={STAFF_ROLES} role={f.role} stringer={f.stringer} disabled={self} onChange={(role, stringer) => set({ role, stringer })} />
        </div>

        <div className="actions staff-form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Close</button>
          <button className="btn" disabled={busy}>{busy ? "Saving…" : u ? "Save changes" : "Add account"}</button>
        </div>

        {u && (
          <div className="staff-account-more">
            <ChangePassword u={u} self={self} act={act} />
            {!self && (
              <button type="button" className="btn small secondary" onClick={() => act({ action: "update", id: u.id, active: !u.is_active },
                u.is_active ? `${u.display_name} is disabled and logged out.` : `${u.display_name} can log in again.`)}>
                {u.is_active ? "Disable" : "Enable"}
              </button>
            )}
            {!self && (
              <button type="button" className="btn small secondary danger-text" onClick={async () => {
                if (!(await confirmDialog(`Delete ${u.display_name}'s account (${u.username})? They'll be logged out.`, { confirmLabel: "Delete", danger: true }))) return;
                if (await act({ action: "delete", id: u.id }, "Account deleted.")) onClose();
              }}>Delete</button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

/** Registration links: make one (who it's for, how long it works), copy it, turn it off. */
function InvitesView({ invites, act }: { invites: Invite[]; act: Act }) {
  const [label, setLabel] = useState("");
  const [roles, setRoles] = useState<string[]>([...SIGNUP_ROLES]);
  const [days, setDays] = useState<number | null>(7);
  const [copied, setCopied] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function copy(i: Invite) {
    const link = inviteLink(i.token);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(i.id);
      setTimeout(() => setCopied((c) => (c === i.id ? null : c)), 1500);
    } catch {
      void copyDialog("Copy the registration link:", link);
    }
  }

  return (
    <div className="stack">
      <form className="card stack" style={{ gap: 12 }} onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await act({ action: "invite", label, roles, days }, "Link created. Copy it below and send it to the people joining.")) setLabel("");
        setBusy(false);
      }}>
        <h3 style={{ margin: 0 }}>New registration link</h3>
        <p className="hint" style={{ margin: 0 }}>
          New staff, Scholars and Stringers fill in their details and choose a username and password. Their account waits for you
          to approve it (under Team), so a forwarded link can&apos;t let anyone in by itself. Turn a link off any time.
        </p>
        <div className="row">
          <div>
            <label htmlFor="inv-label">Name <span className="hint">optional, for you</span></label>
            <input id="inv-label" maxLength={60} placeholder="e.g. Scholars, November batch" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <label htmlFor="inv-days">Works for</label>
            <select id="inv-days" value={days ?? ""} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)}>
              {INVITE_DAYS.map((d) => <option key={d ?? "never"} value={d ?? ""}>{d === null ? "Until I turn it off" : d === 1 ? "1 day" : `${d} days`}</option>)}
            </select>
          </div>
        </div>
        <fieldset className="staff-link-roles">
          <legend>For</legend>
          {SIGNUP_ROLES.map((r) => (
            <label key={r} className="check-row">
              <input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />
              <span>{ROLE_PLURAL[r]}</span>
            </label>
          ))}
        </fieldset>
        <div className="actions start staff-form-actions">
          <button className="btn" disabled={busy || roles.length === 0}>{busy ? "Creating…" : "Create link"}</button>
        </div>
      </form>

      <div className="card staff-list" style={{ padding: 0 }}>
        {invites.length === 0 && <p className="muted staff-empty">No registration links yet.</p>}
        {invites.map((i) => {
          const state = inviteState(i);
          return (
            <div key={i.id} className={`staff-row${state === "active" ? "" : " disabled"}`}>
              <div className="staff-who">
                <strong>{i.label || "Registration link"}</strong>
                <span className={`badge ${state === "active" ? "member-active" : "grey"}`}>{state === "active" ? "Active" : state === "expired" ? "Expired" : "Turned off"}</span>
                <div className="staff-meta">
                  <span>For {rolesText(i.roles)}</span>
                  <span>{i.signups} sign-up{i.signups === 1 ? "" : "s"}</span>
                </div>
                <div className="hint">
                  Made by {i.created_by || "—"}, {day(i.created_at)} ·{" "}
                  {state === "off" ? `turned off by ${i.revoked_by ?? "—"}, ${day(i.revoked_at!)}`
                    : i.expires_at ? `${state === "expired" ? "expired" : "works until"} ${when(i.expires_at)}` : "no end date"}
                </div>
              </div>
              <div className="staff-actions">
                {state === "active" && (
                  <>
                    <button type="button" className="btn small" onClick={() => copy(i)}>{copied === i.id ? "✓ Copied" : "Copy link"}</button>
                    <button type="button" className="btn small secondary danger-text" onClick={async () =>
                      (await confirmDialog(`Turn off “${i.label || "this link"}”? It stops working at once. Accounts already made with it stay.`, { confirmLabel: "Turn off", danger: true })) &&
                      act({ action: "invite-off", id: i.id }, "Link turned off.")}>Turn off</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
