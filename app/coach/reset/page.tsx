"use client";

import { useState } from "react";

export default function CoachResetPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form className="card" style={{ maxWidth: 420, margin: "32px auto" }} onSubmit={async (e) => {
      e.preventDefault();
      if (password !== confirm) return setError("The two passwords don't match.");
      setBusy(true);
      setError("");
      try {
        const token = new URLSearchParams(window.location.search).get("token") ?? "";
        const res = await fetch("/api/coaches/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return setError(j.error || "Couldn't set your password.");
        window.location.href = "/coach";
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setBusy(false);
      }
    }}>
      <h1 style={{ marginTop: 0 }}>Set a new password</h1>
      <div className="field">
        <label htmlFor="np">New password <span className="hint">(at least 8 characters)</span></label>
        <input id="np" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="np2">Type it again</label>
        <input id="np2" type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <div className="error">{error}</div>}
      <div className="actions"><button className="btn block" disabled={busy}>{busy ? "Saving…" : "Save and log in"}</button></div>
    </form>
  );
}
