"use client";

import { useCallback, useEffect, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import { api } from "./shared";

type StaffUser = {
  id: number;
  username: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  created_by: string;
};
type Me = { id: number | null; username: string; name: string };

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "Never";

/** Staff accounts: each person logs in with their own username and password. */
export default function StaffTab({ onAuthError }: { onAuthError: (e: unknown) => void }) {
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ name: "", username: "", password: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ users: StaffUser[]; me: Me }>("/api/admin/users");
      setUsers(r.users);
      setMe(r.me);
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(body: Record<string, unknown>, done?: string) {
    setError("");
    setNotice("");
    try {
      await api("/api/admin/users", body);
      if (done) setNotice(done);
      load();
      return true;
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Failed");
      return false;
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (await act({ action: "create", ...form }, `Account created for ${form.name}. Share the username and password with them privately.`))
      setForm({ name: "", username: "", password: "" });
    setBusy(false);
  }

  function resetPassword(u: StaffUser) {
    const pw = window.prompt(
      u.id === me?.id
        ? "Your new password (at least 8 characters):"
        : `New password for ${u.display_name} (at least 8 characters). They'll be logged out and must use the new password.`
    );
    if (pw) act({ action: "password", id: u.id, password: pw }, `Password changed for ${u.display_name}.`);
  }

  if (!users) return error ? <div className="error">{error}</div> : <FullScreenLoader label="Loading staff…" />;

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <p className="muted" style={{ margin: 0 }}>
        Everyone on the team gets their own login. Logged-in staff also see full names on the <strong>Book a court</strong> page
        and can open, confirm, edit or cancel bookings right from the grid. Disabling or deleting an account logs that person
        out immediately.
      </p>
      {notice && <div className="success">{notice}</div>}
      {error && <div className="error">{error}</div>}

      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="list">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Last login</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={4} className="muted">No staff accounts yet — add the first one below.</td></tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className={u.is_active ? undefined : "import-skip"}>
                <td>
                  <strong>{u.display_name}</strong>
                  {u.id === me?.id && <span className="badge" style={{ marginLeft: 6 }}>You</span>}
                  {!u.is_active && <span className="badge grey" style={{ marginLeft: 6 }}>Disabled</span>}
                  <div className="muted" style={{ fontSize: 12 }}>Added by {u.created_by || "—"} · {when(u.created_at)}</div>
                </td>
                <td style={{ fontFamily: "ui-monospace, monospace" }}>{u.username}</td>
                <td style={{ fontSize: 13 }}>{when(u.last_login_at)}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="btn small secondary" onClick={() => {
                      const name = window.prompt("Name:", u.display_name);
                      if (name && name.trim() !== u.display_name) act({ action: "update", id: u.id, name }, "Name updated.");
                    }}>Rename</button>
                    <button className="btn small secondary" onClick={() => resetPassword(u)}>
                      {u.id === me?.id ? "Change my password" : "Reset password"}
                    </button>
                    {u.id !== me?.id && (
                      <button className="btn small secondary" onClick={() => act({ action: "update", id: u.id, active: !u.is_active },
                        u.is_active ? `${u.display_name} is disabled and logged out.` : `${u.display_name} can log in again.`)}>
                        {u.is_active ? "Disable" : "Enable"}
                      </button>
                    )}
                    {u.id !== me?.id && (
                      <button className="btn small secondary danger-text" onClick={() =>
                        window.confirm(`Delete ${u.display_name}'s account (${u.username})? They'll be logged out.`) &&
                        act({ action: "delete", id: u.id }, "Account deleted.")}>
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="card stack" onSubmit={create} style={{ gap: 12 }}>
        <h2 style={{ margin: 0 }}>Add a staff account</h2>
        <div className="row" style={{ gridTemplateColumns: "1.3fr 1fr 1fr" }}>
          <div>
            <label htmlFor="st-name">Name</label>
            <input id="st-name" type="text" required minLength={2} maxLength={60} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="st-user">Username</label>
            <input id="st-user" type="text" required minLength={3} maxLength={30} autoCapitalize="none" spellCheck={false}
              pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,29}" title="3–30 letters, numbers, dots, dashes or underscores"
              value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div>
            <label htmlFor="st-pw">Password</label>
            <input id="st-pw" type="text" required minLength={8} maxLength={200} autoComplete="new-password" spellCheck={false}
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          At least 8 characters. Share it with them privately — they can change it themselves under Staff.
        </p>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="btn" disabled={busy}>{busy ? "Adding…" : "Add account"}</button>
        </div>
      </form>

      {me?.id === null && (
        <p className="hint" style={{ margin: 0 }}>
          You&apos;re logged in as the <strong>owner</strong> (the recovery login using the ADMIN_PASSWORD setting). It always
          works, even if every staff account is disabled.
        </p>
      )}
    </div>
  );
}
