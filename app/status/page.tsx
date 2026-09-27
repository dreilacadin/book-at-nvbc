import type { Metadata } from "next";
import { runHealthChecks } from "@/lib/health";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Setup status — NVBC Courts", robots: { index: false } };

// Open /status on your deployed site to see which part of the setup is failing and how to fix it.
export default async function StatusPage() {
  const { ok, checks } = await runHealthChecks();
  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Setup status</h1>
      <p className="lead">
        {ok
          ? "Everything is connected. The booking site is ready."
          : "Something in the setup needs fixing. Follow the steps in red, then reload this page."}
      </p>
      <div className="card" style={{ padding: 0 }}>
        {checks.map((c) => (
          <div key={c.name} style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <span aria-hidden="true" style={{ fontSize: 18 }}>{c.ok ? (c.warn ? "⚠️" : "✅") : "❌"}</span>
              <strong>{c.name}</strong>
            </div>
            <p style={{ margin: "4px 0 0 30px" }} className={c.ok ? "muted" : undefined}>{c.detail}</p>
            {c.fix && (
              <p className={c.ok ? "notice" : "error"} style={{ margin: "8px 0 0 30px" }}>
                <strong>Fix: </strong>
                {c.fix}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>Checked {new Date().toISOString()} · also available as JSON at /api/health</p>
    </div>
  );
}
