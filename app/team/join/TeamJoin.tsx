"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import PasswordInput from "@/components/PasswordInput";
import StaffRolePicker from "@/components/StaffRolePicker";
import { MIN_PASSWORD, SIGNUP_ROLES, validateSignup, type StaffRole } from "@/lib/staff";

// What each role means, for the person signing up.
const HINTS: Partial<Record<StaffRole, string>> = {
  staff: "NVBC front desk and day-to-day work.",
  scholar: "An NVBC Scholar on duty at the front desk.",
  stringer: "You string customers' rackets.",
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

/** The sign-up form behind a registration link. The token is after "#", so it never reaches server logs. */
export default function TeamJoin() {
  const [token, setToken] = useState("");
  const [roles, setRoles] = useState<StaffRole[] | null>(null);
  const [gone, setGone] = useState("");
  const [f, setF] = useState({
    firstName: "", lastName: "", birthdate: "", mobile: "", email: "", username: "", password: "",
    role: "" as StaffRole | "", stringer: false,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    const t = window.location.hash.slice(1);
    setToken(t);
    if (!t) return setGone("This page needs the full registration link. Please open the link NVBC sent you.");
    fetch(`/api/team/join?token=${encodeURIComponent(t)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return setGone(j.error || "This registration link doesn't work any more.");
        const allowed = (j.roles as string[]).filter((x): x is StaffRole => (SIGNUP_ROLES as readonly string[]).includes(x));
        setRoles(allowed);
        if (allowed.length === 1) set({ role: allowed[0] });
      })
      .catch(() => setGone("Couldn't open the link. Please check your connection and try again."));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const check = validateSignup(f, today(), roles ?? []);
    if (typeof check === "string") return setError(check);
    setBusy(true);
    try {
      const res = await fetch("/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...f }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setError(j.error || "Couldn't create your account. Please try again.");
      setDone(j.name || f.firstName);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (gone)
    return (
      <div className="card" style={{ maxWidth: 520, margin: "24px auto" }}>
        <h1 style={{ marginTop: 0 }}>Join the NVBC team</h1>
        <p>{gone}</p>
        <p className="muted" style={{ marginBottom: 0 }}>Already have an account? <Link href="/admin">Log in</Link>.</p>
      </div>
    );
  if (!roles) return <FullScreenLoader />;
  if (done)
    return (
      <div className="card stack" style={{ maxWidth: 520, margin: "24px auto" }}>
        <h1 style={{ margin: 0 }}>Thanks, {done}!</h1>
        <p style={{ margin: 0 }}>
          Your account is waiting for approval by NVBC&apos;s management. Once it&apos;s approved, log in at{" "}
          <Link href="/admin">the staff page</Link> with your username <strong>{f.username.trim().toLowerCase()}</strong> and the password you chose.
        </p>
      </div>
    );

  return (
    <form onSubmit={submit} className="card stack" style={{ maxWidth: 560, margin: "0 auto", gap: 14 }}>
      <div>
        <h1 style={{ margin: 0 }}>Join the NVBC team</h1>
        <p className="muted" style={{ margin: "6px 0 0" }}>Create your login. NVBC&apos;s management approves it before you can use it.</p>
      </div>
      <div className="row">
        <div><label htmlFor="tj-first">First name</label><input id="tj-first" required maxLength={40} autoComplete="given-name" value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} /></div>
        <div><label htmlFor="tj-last">Last name</label><input id="tj-last" required maxLength={40} autoComplete="family-name" value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} /></div>
      </div>
      <div className="row">
        <div><label htmlFor="tj-bd">Birthday</label><input id="tj-bd" type="date" required autoComplete="bday" value={f.birthdate} onChange={(e) => set({ birthdate: e.target.value })} /></div>
        <div><label htmlFor="tj-mob">Mobile</label><input id="tj-mob" type="tel" inputMode="tel" required maxLength={20} autoComplete="tel" placeholder="0917 123 4567" value={f.mobile} onChange={(e) => set({ mobile: e.target.value })} /></div>
      </div>
      <div><label htmlFor="tj-em">Email</label><input id="tj-em" type="email" required maxLength={120} autoComplete="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></div>
      <div className="row">
        <div>
          <label htmlFor="tj-user">Username</label>
          <input id="tj-user" required minLength={3} maxLength={30} autoCapitalize="none" spellCheck={false} autoComplete="username"
            pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,29}" title="3–30 letters, numbers, dots, dashes or underscores"
            value={f.username} onChange={(e) => set({ username: e.target.value })} />
        </div>
        <div>
          <label htmlFor="tj-pw">Password <span className="hint">{MIN_PASSWORD}+ characters</span></label>
          <PasswordInput id="tj-pw" required minLength={MIN_PASSWORD} maxLength={200} autoComplete="new-password" value={f.password} onChange={(e) => set({ password: e.target.value })} />
        </div>
      </div>
      <div>
        <label>Role</label>
        <StaffRolePicker roles={roles} role={f.role} stringer={f.stringer} hints={HINTS}
          stringerLabel="I also string rackets" stringerHint="" deskHint="" onChange={(role, stringer) => set({ role, stringer })} />
      </div>
      {error && <div className="error">{error}</div>}
      <div className="actions staff-form-actions">
        <span className="muted" style={{ marginRight: "auto", fontSize: 14 }}>Already have an account? <Link href="/admin">Log in</Link></span>
        <button className="btn" disabled={busy}>{busy ? "Creating your account…" : "Create my account"}</button>
      </div>
    </form>
  );
}
