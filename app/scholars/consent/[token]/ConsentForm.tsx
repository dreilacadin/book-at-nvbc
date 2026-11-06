"use client";

import { useEffect, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import { GUARDIAN_CONSENTS, RESULTS_LABEL, type PhotoConsent } from "@/lib/scholar";
import type { ConsentView } from "@/lib/scholars";
import { PhotoQuestion, ScholarHero } from "../../ScholarForm";

export default function ConsentForm({ token }: { token: string }) {
  const [view, setView] = useState<ConsentView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [f, setF] = useState({ guardianName: "", relationship: "", guardianMobile: "", guardianNotes: "", signature: "" });
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const [photoConsent, setPhotoConsent] = useState<PhotoConsent | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/scholars/consent/${token}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (r.ok) setView(j);
        else setLoadError(j.error || "This link isn't valid.");
      })
      .catch(() => setLoadError("Network error. Please check your connection and reload this page."));
  }, [token]);

  const field = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/scholars/consent/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, consents, photoConsent }),
      });
      const json = await res.json();
      if (!res.ok) return setError(json.error || "Could not send your consent. Please try again.");
      setView((v) => (v ? { ...v, signed: true } : v));
      window.scrollTo(0, 0);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError)
    return (
      <ScholarHero pill="Parent or Guardian Consent">
        <h1>This link <em>didn&apos;t work.</em></h1>
        <p>{loadError}</p>
      </ScholarHero>
    );
  if (!view) return <FullScreenLoader />;

  if (view.signed || !view.consentRequired)
    return (
      <ScholarHero pill="Parent or Guardian Consent">
        <h1>{view.signed ? <>Thank <em>you!</em></> : <>No consent <em>needed.</em></>}</h1>
        <p>{view.signed
          ? `We received your consent for ${view.applicantName}. NVBC management will announce the tryout results on ${RESULTS_LABEL}.`
          : `${view.applicantName} is 18 or older, so this application doesn't need a parent's or guardian's consent.`}</p>
      </ScholarHero>
    );

  return (
    <>
      <ScholarHero pill="Parent or Guardian Consent">
        <h1>Your consent for <em>{view.applicantName}.</em></h1>
        <p>{view.applicantName} is applying to be an NVBC Scholar. Scholars receive free open play, tournament support and free training. In return, they help care for our facility and serve as NVBC ambassadors.</p>
      </ScholarHero>

      <div className="card scholar-summary">
        <div><span className="muted">Applicant</span><strong>{view.applicantName}</strong></div>
        <div><span className="muted">Sport</span><strong>{view.sport}</strong></div>
        <div><span className="muted">{view.batch}</span><strong>{view.batchWhen}</strong></div>
      </div>

      <form className="card member-form" onSubmit={submit}>
        <fieldset>
          <legend>About you</legend>
          <div className="field">
            <label htmlFor="g-name">Your full name</label>
            <input id="g-name" type="text" required minLength={4} maxLength={80} autoComplete="name" placeholder="First and last name" {...field("guardianName")} />
          </div>
          <div className="row field">
            <div>
              <label htmlFor="g-rel">Relationship to applicant</label>
              <input id="g-rel" type="text" required maxLength={40} placeholder="For example, mother" {...field("relationship")} />
            </div>
            <div>
              <label htmlFor="g-mobile">Your mobile number</label>
              <input id="g-mobile" type="tel" required maxLength={20} autoComplete="tel" placeholder="09XX XXX XXXX" {...field("guardianMobile")} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="g-notes">Anything about your child&apos;s health we should know? <span className="hint">(optional)</span></label>
            <textarea id="g-notes" maxLength={500} {...field("guardianNotes")} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Consent</legend>
          <p className="hint" style={{ marginTop: 0 }}>Please read and tick each item. NVBC may call you to confirm.</p>
          {GUARDIAN_CONSENTS.map((c) => (
            <label key={c.id} className="check consent scholar-check">
              <input type="checkbox" required checked={!!consents[c.id]} onChange={(e) => setConsents({ ...consents, [c.id]: e.target.checked })} />
              <span><strong>{c.title}.</strong> {c.text}</span>
            </label>
          ))}
          <PhotoQuestion who="my child" value={photoConsent} onChange={setPhotoConsent} />
        </fieldset>

        <fieldset>
          <legend>Signature</legend>
          <div className="field">
            <label htmlFor="g-sign">Type your full name to sign</label>
            <input id="g-sign" type="text" required maxLength={80} autoComplete="off" {...field("signature")} />
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            By typing your name, you confirm that you are this applicant&apos;s parent or legal guardian and that you agree to the above.
            You may withdraw this consent at any time by telling NVBC management. If you don&apos;t agree, you don&apos;t need to do anything.
            Questions? Email hello@nvbc.app or ask at the NVBC front desk.
          </p>
        </fieldset>

        {error && <div className="error" style={{ marginTop: 14 }} role="alert">{error}</div>}
        <div className="actions">
          <button className="btn block" disabled={busy}>{busy ? "Sending…" : "Give my consent"}</button>
        </div>
      </form>
    </>
  );
}
