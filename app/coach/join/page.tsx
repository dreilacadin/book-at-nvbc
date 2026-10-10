"use client";

import CoachProfileForm, {
  type CoachFormValues,
} from "@/components/CoachProfileForm";
import FullScreenLoader from "@/components/FullScreenLoader";
import { setCustomActivities } from "@/lib/sports";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Coaches sign up with NVBC's shared link (/coach/join?key=…); NVBC approves them before their code works. */
export default function CoachJoinPage() {
  const [key, setKey] = useState<string | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [values, setValues] = useState<CoachFormValues>({
    fullName: "",
    nickname: "",
    gender: "",
    genderSelf: "",
    birthday: "",
    email: "",
    mobile: "",
    phpaId: "",
    sports: [],
    rates: "",
    availability: [],
    credentials: "",
    bio: "",
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("key") ?? "";
    setKey(k);
    fetch(`/api/coaches/signup?key=${encodeURIComponent(k)}`)
      .then((r) => r.json())
      .then((j) => {
        setCustomActivities(j.activities ?? []);
        setValid(!!j.valid);
      })
      .catch(() => setValid(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8)
      return setError("Choose a password of at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      const res = await fetch("/api/coaches/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, ...values, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setError(j.error || "Couldn't create your account.");
      window.location.href = "/coach";
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (valid === null) return <FullScreenLoader />;
  if (!valid)
    return (
      <div className="card" style={{ maxWidth: 520 }}>
        <h1>Coach sign-up</h1>
        <p>
          This sign-up link isn&apos;t valid any more. Please ask NVBC for the
          current link.
        </p>
        <p>
          Already have an account? <Link href="/coach/login">Log in</Link>.
        </p>
      </div>
    );

  return (
    <form onSubmit={submit} style={{ maxWidth: 760 }} className="stack">
      <div>
        <h1>Become an NVBC coach</h1>
        <p className="lead">
          Create your coach account. Once NVBC approves it, you&apos;ll get your
          own <strong>coach code</strong> — use it to book courts at the coach
          rate — and customers can ask you for coaching sessions.
        </p>
      </div>
      <div className="card">
        <CoachProfileForm values={values} onChange={setValues} />
      </div>
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Your password</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="pw">
              Password <span className="hint">(at least 8 characters)</span>
            </label>
            <input
              id="pw"
              type="password"
              required
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="pw2">Type it again</label>
            <input
              id="pw2"
              type="password"
              required
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="actions">
        <span className="muted" style={{ marginRight: "auto", fontSize: 14 }}>
          Already have an account? <Link href="/coach/login">Log in</Link>
        </span>
        <button className="btn" disabled={busy}>
          {busy ? "Creating your account…" : "Create my coach account"}
        </button>
      </div>
    </form>
  );
}
