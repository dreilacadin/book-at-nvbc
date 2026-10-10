"use client";

import Link from "next/link";
import { useState } from "react";

export default function CoachLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form className="card" style={{ maxWidth: 420, margin: "32px auto" }} onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setError("");
      try {
        const res = await fetch("/api/coaches/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return setError(j.error || "Couldn't log in.");
        window.location.href = "/coach";
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setBusy(false);
      }
    }}>
      <h1 style={{ marginTop: 0 }}>Coach login</h1>
      <div className="field">
        <label htmlFor="ce">Email</label>
        <input id="ce" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cp">Password</label>
        <input id="cp" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <div className="error">{error}</div>}
      <div className="actions"><button className="btn block" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button></div>
      <p className="hint" style={{ marginBottom: 0 }}>
        Forgot your password? Ask NVBC staff for a reset link. New coach? Ask NVBC for the sign-up link. Staff log in at{" "}
        <Link href="/admin">/admin</Link>.
      </p>
    </form>
  );
}
