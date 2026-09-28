"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PaymentDetails, ProofFields, usePaymentInfo } from "@/components/PaymentPanel";
import { memberTypeLabel, type MemberType } from "@/lib/membership";
import { formatPeso, paymentLabel, type PaymentMethod, type PaymentStatus } from "@/lib/pricing";
import { loadMembership, saveMembership } from "@/lib/saved-membership";

type View = {
  state: "pending" | "active" | "expired" | "rejected";
  memberType: MemberType;
  fullName: string;
  fee: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentRef: string;
  hasProof: boolean;
  memberCode: string | null;
  memberSince: string | null;
  startsOn: string | null;
  expiresOn: string | null;
  qr: string | null;
  appliedOn: string;
};

const niceDate = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function MembershipStatus({ token }: { token: string }) {
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/membership/${token}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) return setError(json.error || "Could not load your membership.");
      setV(json);
      setError("");
      // Keep this link on the device so the member can find their QR again.
      if (!loadMembership() || loadMembership()?.token === token)
        saveMembership({ token, name: json.fullName, appliedOn: json.appliedOn, memberCode: json.memberCode ?? undefined });
    } catch {
      setError("Network error. Please check your connection.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // While pending, check every 20 seconds so the page turns into the welcome page once approved.
  useEffect(() => {
    if (v?.state !== "pending") return;
    const t = setInterval(() => document.visibilityState === "visible" && load(), 20_000);
    return () => clearInterval(t);
  }, [v?.state, load]);

  if (!v) return error ? <div className="error">{error}</div> : <p className="muted">Loading…</p>;

  const firstName = v.fullName.split(" ")[0];

  if (v.state === "active" || v.state === "expired")
    return (
      <div className="member-page">
        {v.state === "active" ? (
          <div className="welcome">
            <div className="welcome-emoji" aria-hidden="true">🎉</div>
            <h1>Welcome to NVBC, {firstName}!</h1>
            <p className="lead" style={{ margin: 0 }}>
              You&apos;re now an official <strong>NVBC Member</strong>. Thank you for joining — see you on court!
            </p>
          </div>
        ) : (
          <div className="notice" style={{ marginBottom: 16 }}>
            Your membership expired on <strong>{v.expiresOn && niceDate(v.expiresOn)}</strong>. Renew it at the front
            desk — you&apos;ll keep the same member code.
          </div>
        )}

        <div className={`member-card${v.state === "expired" ? " expired" : ""}`}>
          <div className="member-card-head">
            <span className="logo-ball" aria-hidden="true" />
            <div>
              <strong>NVBC Member</strong>
              <small>NV Badminton Center</small>
            </div>
            <span className="member-type">{memberTypeLabel(v.memberType)}</span>
          </div>
          <div className="member-name">{v.fullName}</div>
          {v.qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="member-qr" src={v.qr} alt={`QR code for member code ${v.memberCode}`} />
          )}
          <div className="member-code-label">Member code</div>
          <div className="member-code">{v.memberCode}</div>
          <dl className="member-dates">
            <div>
              <dt>Member since</dt>
              <dd>{v.memberSince && niceDate(v.memberSince)}</dd>
            </div>
            <div>
              <dt>{v.state === "expired" ? "Expired" : "Expires"}</dt>
              <dd>{v.expiresOn && niceDate(v.expiresOn)}</dd>
            </div>
          </dl>
          {v.state === "expired" && <div className="member-expired-tag">Expired</div>}
        </div>

        <p className="muted member-tip">
          📱 Take a screenshot of this card and keep it on your phone. Show the QR code at the front desk — staff scan it
          to check your membership. You can also come back to this page anytime: it&apos;s saved on this device, and you
          can bookmark it.
        </p>
        {v.qr && (
          <div className="actions" style={{ justifyContent: "center" }}>
            <a className="btn secondary" href={v.qr} download={`NVBC-member-${v.memberCode}.png`}>Save QR image</a>
          </div>
        )}
      </div>
    );

  if (v.state === "rejected")
    return (
      <div className="member-page">
        <h1>Membership application</h1>
        <div className="card">
          <p style={{ marginTop: 0 }}>
            Sorry, {firstName} — your application couldn&apos;t be approved. Please visit or message the front desk if you
            have questions, or <Link href="/membership">apply again</Link>.
          </p>
        </div>
      </div>
    );

  return <Pending v={v} token={token} onUpdated={load} />;
}

function Pending({ v, token, onUpdated }: { v: View; token: string; onUpdated: () => void }) {
  const { info } = usePaymentInfo();
  const [method, setMethod] = useState<PaymentMethod>(v.paymentMethod);
  const [reference, setReference] = useState(v.paymentRef);
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const paid = v.paymentStatus === "paid" || v.paymentStatus === "waived";
  const sent = v.paymentStatus === "for_verification";
  const methods = info?.methods ?? ["cash"];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reference.trim() && !proof && !v.hasProof)
      return setError("Enter the reference number or upload a screenshot of your receipt.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/membership/${token}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, reference, proof }),
      });
      const json = await res.json();
      if (!res.ok) return setError(json.error || "Could not save your payment details.");
      setProof("");
      onUpdated();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="member-page">
      <h1>Application received ✓</h1>
      <p className="lead">
        Thanks, {v.fullName.split(" ")[0]}! Your <strong>{memberTypeLabel(v.memberType)}</strong> membership is{" "}
        <strong>pending confirmation</strong>. It becomes active once you&apos;ve paid and the front desk approves it —
        this page will then show your member QR code.
      </p>

      <ol className="member-steps">
        <li className="done">Apply online</li>
        <li className={paid ? "done" : "current"}>
          Pay {formatPeso(v.fee)}
          {sent && <small> — sent, being checked</small>}
          {paid && <small> — received</small>}
        </li>
        <li className={paid ? "current" : ""}>Staff approval</li>
      </ol>

      {!paid && (
        <div className="pay-box">
          <div className="pay-row">
            <span>Membership fee</span>
            <strong style={{ fontSize: 22 }}>{formatPeso(v.fee)}</strong>
          </div>
          <div className="method-pills" role="radiogroup" aria-label="Payment method">
            {methods.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}>
                {paymentLabel(m)}
              </button>
            ))}
          </div>
          {method === "cash" ? (
            <p style={{ margin: "10px 0 0" }}>
              Pay <strong>{formatPeso(v.fee)}</strong> in cash at the front desk and give your name
              {v.memberType === "student" ? " — bring your school ID" : ""}. Staff will approve your membership there.
            </p>
          ) : (
            <>
              {info && <PaymentDetails info={info} method={method} amount={v.fee} />}
              <p className="muted" style={{ fontSize: 14, margin: "10px 0" }}>
                Put your name in the message if your app allows. After paying, enter the reference number or upload a
                screenshot of the receipt so staff can confirm it.
              </p>
              {sent && (
                <div className="success" style={{ marginBottom: 10 }}>
                  Payment details received. Staff will check them shortly — you can correct them below if needed.
                </div>
              )}
              <form onSubmit={submit}>
                <ProofFields reference={reference} onReference={setReference} proof={proof} onProof={setProof} hasProof={v.hasProof} />
                <button className="btn" disabled={busy} style={{ marginTop: 10 }}>
                  {busy ? "Sending…" : sent ? "Update" : "I've paid"}
                </button>
              </form>
            </>
          )}
          {info?.note && <p className="muted" style={{ fontSize: 14, margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{info.note}</p>}
          {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
        </div>
      )}

      {paid && (
        <div className="success">Payment received — the front desk will approve your membership shortly.</div>
      )}

      <p className="hint" style={{ marginTop: 16 }}>
        This page is saved on this device. You can also bookmark it — it&apos;s your private link to your membership.
      </p>
    </div>
  );
}
