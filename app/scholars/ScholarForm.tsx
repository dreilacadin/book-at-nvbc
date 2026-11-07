"use client";

import { useEffect, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import {
  ADULT_CONSENTS,
  APPLICANT_COMMITMENTS,
  DUTY_DAYS,
  DUTY_TIMES,
  MIN_DUTY_DAYS,
  needsGuardianConsent,
  openBatches,
  RESULTS_LABEL,
  SCHOLAR_SPORTS,
  slotId,
  type PhotoConsent,
} from "@/lib/scholar";

// So the applicant can get back to their consent link on this phone. Only the secret link and a
// first name are kept: never their details.
const SAVED_KEY = "nvbc_scholar_application";
type Saved = { token: string; name: string; consentRequired: boolean };

function loadSaved(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "null");
    return s && typeof s.token === "string" ? s : null;
  } catch {
    return null;
  }
}
function save(s: Saved | null) {
  try {
    if (s) localStorage.setItem(SAVED_KEY, JSON.stringify(s));
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    // Private browsing: the confirmation still shows now, it just won't be there later.
  }
}

const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

export function ScholarHero({ pill, children }: { pill: string; children: React.ReactNode }) {
  return (
    <div className="scholar-hero">
      <span className="scholar-pill">{pill}</span>
      {children}
    </div>
  );
}

export default function ScholarForm() {
  const [batches] = useState(() => openBatches(Date.now()));
  const [checking, setChecking] = useState(true);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [f, setF] = useState({
    fullName: "", birthdate: "", mobile: "", facebookName: "", address: "", school: "", yearLevel: "",
    yearsPlaying: "", experience: "", whyFit: "", initiative: "", emergencyName: "", emergencyMobile: "", medical: "",
    website: "", // honeypot
  });
  const [sport, setSport] = useState("");
  const [batch, setBatch] = useState("");
  const [availability, setAvailability] = useState<string[]>([]);
  const [commitments, setCommitments] = useState<Record<string, boolean>>({});
  const [adultConsents, setAdultConsents] = useState<Record<string, boolean>>({});
  const [photoConsent, setPhotoConsent] = useState<PhotoConsent | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // localStorage is only readable in the browser, after the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(loadSaved());
    setChecking(false);
  }, []);

  const field = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }),
  });

  const today = manilaToday();
  const isMinor = f.birthdate ? f.birthdate < today && needsGuardianConsent(f.birthdate, today) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!sport) return setError("Please choose your sport.");
    if (!batch) return setError("Please choose your tryout batch.");
    if (new Set(availability.map((s) => s.split("-")[0])).size < MIN_DUTY_DAYS)
      return setError(`Please mark when you are free on at least ${MIN_DUTY_DAYS} days.`);
    setBusy(true);
    try {
      const res = await fetch("/api/scholars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, sport, batch, availability, commitments, adultConsents, photoConsent }),
      });
      const json = await res.json();
      if (!res.ok) return setError(json.error || "Could not send your application. Please try again.");
      const done: Saved = { token: json.token, name: f.fullName.trim().split(/\s+/)[0], consentRequired: json.consentRequired };
      save(done);
      setSaved(done);
      window.scrollTo(0, 0);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (checking) return <FullScreenLoader />;
  if (saved) return <Received saved={saved} onAnother={() => { save(null); setSaved(null); }} />;

  if (batches.length === 0)
    return (
      <ScholarHero pill="Scholar Tryouts">
        <h1>Applications are <em>closed.</em></h1>
        <p>Thank you to everyone who applied! NVBC management will announce the results on {RESULTS_LABEL}.</p>
      </ScholarHero>
    );

  return (
    <>
      <ScholarHero pill="Scholar Tryouts">
        <h1>Become an <em>NVBC Scholar.</em></h1>
        <p>We&apos;re looking for 2 badminton and 2 pickleball student-athletes who want to make NVBC feel like home for every player. Results: {RESULTS_LABEL}.</p>
      </ScholarHero>

      <form className="card member-form" onSubmit={submit}>
        <fieldset>
          <legend>About you</legend>
          <div className="field">
            <label htmlFor="s-name">Full name</label>
            <input id="s-name" type="text" required minLength={4} maxLength={80} autoComplete="name" placeholder="First and last name" {...field("fullName")} />
          </div>
          <div className="row field">
            <div>
              <label htmlFor="s-bday">Date of birth</label>
              <input id="s-bday" type="date" required max={today} autoComplete="bday" {...field("birthdate")} />
            </div>
            <div>
              <label htmlFor="s-mobile">Mobile number</label>
              <input id="s-mobile" type="tel" required maxLength={20} autoComplete="tel" placeholder="09XX XXX XXXX" {...field("mobile")} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="s-fb">Facebook name</label>
            <input id="s-fb" type="text" required maxLength={80} {...field("facebookName")} />
          </div>
          <div className="field">
            <label htmlFor="s-address">Home address in Nueva Vizcaya</label>
            <input id="s-address" type="text" required minLength={8} maxLength={200} autoComplete="street-address" placeholder="Barangay and town" {...field("address")} />
          </div>
          <div className="row field">
            <div>
              <label htmlFor="s-school">School</label>
              <input id="s-school" type="text" required maxLength={120} {...field("school")} />
            </div>
            <div>
              <label htmlFor="s-year">Course or strand, and year level</label>
              <input id="s-year" type="text" required maxLength={80} {...field("yearLevel")} />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Your tryout</legend>
          <div className="field">
            <label id="s-sport-label">Sport</label>
            <div className="segmented member-types" role="radiogroup" aria-labelledby="s-sport-label">
              {SCHOLAR_SPORTS.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={sport === s.id} onClick={() => setSport(s.id)}>{s.label}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label id="s-batch-label">Batch</label>
            <div className={`segmented ${batches.length > 1 ? "member-types" : "scholar-one"}`} role="radiogroup" aria-labelledby="s-batch-label">
              {batches.map((b) => (
                <button key={b.id} type="button" role="radio" aria-checked={batch === b.id} onClick={() => setBatch(b.id)}>
                  {b.label}<small>{b.when}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="s-years">How long have you been playing?</label>
            <input id="s-years" type="text" required maxLength={40} placeholder="For example, 2 years" {...field("yearsPlaying")} />
          </div>
          <div className="field">
            <label htmlFor="s-exp">Tournaments or teams you&apos;ve played in <span className="hint">(optional)</span></label>
            <textarea id="s-exp" maxLength={500} {...field("experience")} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Your availability</legend>
          <p className="hint" style={{ marginTop: 0 }}>Scholars serve at least 2 to 3 duty days a week. When are you usually free?</p>
          <div className="scholar-grid" role="group" aria-label="When you are usually free">
            <span />
            {DUTY_DAYS.map((d) => <b key={d}>{d}</b>)}
            {DUTY_TIMES.map((t) => (
              <div className="scholar-grid-row" key={t}>
                <span>{t}</span>
                {DUTY_DAYS.map((d) => {
                  const id = slotId(d, t);
                  return (
                    <label key={id} aria-label={`${d} ${t}`}>
                      <input type="checkbox" checked={availability.includes(id)}
                        onChange={(e) => setAvailability((a) => (e.target.checked ? [...a, id] : a.filter((x) => x !== id)))} />
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Why you</legend>
          <div className="field">
            <label htmlFor="s-why">Why would you be a good fit for the NVBC Scholars team?</label>
            <textarea id="s-why" required minLength={20} maxLength={1500} rows={4} {...field("whyFit")} />
          </div>
          <div className="field">
            <label htmlFor="s-init">Tell us about a time you helped out or solved a problem without being asked.</label>
            <textarea id="s-init" required minLength={20} maxLength={1500} rows={4} {...field("initiative")} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Emergency and health</legend>
          <div className="row field">
            <div>
              <label htmlFor="s-ename">Emergency contact</label>
              <input id="s-ename" type="text" required maxLength={80} {...field("emergencyName")} />
            </div>
            <div>
              <label htmlFor="s-emobile">Their mobile number</label>
              <input id="s-emobile" type="tel" required maxLength={20} placeholder="09XX XXX XXXX" {...field("emergencyMobile")} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="s-med">Medical conditions, allergies, injuries or medicines we should know about</label>
            <textarea id="s-med" required maxLength={500} placeholder='Write "None" if none' {...field("medical")} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Your commitment</legend>
          {APPLICANT_COMMITMENTS.map((c) => (
            <label key={c.id} className="check consent scholar-check">
              <input type="checkbox" required checked={!!commitments[c.id]} onChange={(e) => setCommitments({ ...commitments, [c.id]: e.target.checked })} />
              <span>{c.text}</span>
            </label>
          ))}
        </fieldset>

        {isMinor === true && (
          <div className="notice info" style={{ marginBottom: 14 }}>
            <strong>You&apos;re under 18,</strong> so your parent or guardian also needs to give consent. After you send this, you&apos;ll get a link to send them.
          </div>
        )}

        {isMinor === false && (
          <fieldset>
            <legend>Your consent</legend>
            {ADULT_CONSENTS.map((c) => (
              <label key={c.id} className="check consent scholar-check">
                <input type="checkbox" required checked={!!adultConsents[c.id]} onChange={(e) => setAdultConsents({ ...adultConsents, [c.id]: e.target.checked })} />
                <span>{c.text}</span>
              </label>
            ))}
            <PhotoQuestion who="me" value={photoConsent} onChange={setPhotoConsent} />
          </fieldset>
        )}

        {/* Honeypot: hidden from people, often filled in by spam bots. */}
        <div className="hp" aria-hidden="true">
          <label htmlFor="s-website">Website</label>
          <input id="s-website" type="text" tabIndex={-1} autoComplete="off" {...field("website")} />
        </div>

        {error && <div className="error" style={{ marginTop: 14 }} role="alert">{error}</div>}
        <div className="actions">
          <button className="btn block" disabled={busy}>{busy ? "Sending…" : "Send my application"}</button>
        </div>
      </form>
    </>
  );
}

export function PhotoQuestion({ who, value, onChange }: { who: "me" | "my child"; value: PhotoConsent | ""; onChange: (v: PhotoConsent) => void }) {
  return (
    <div className="field" style={{ marginTop: 14 }} role="radiogroup" aria-labelledby="s-photo-label">
      <label id="s-photo-label">Photos and videos <span className="hint">(your choice won&apos;t affect the application)</span></label>
      <label className="check consent scholar-check">
        <input type="radio" name="photo" required checked={value === "yes"} onChange={() => onChange("yes")} />
        <span><strong>Yes,</strong> NVBC may feature {who} in photos and videos on its pages and promotional materials.</span>
      </label>
      <label className="check consent scholar-check">
        <input type="radio" name="photo" required checked={value === "no"} onChange={() => onChange("no")} />
        <span><strong>No,</strong> please do not feature {who}.</span>
      </label>
    </div>
  );
}

function Received({ saved, onAnother }: { saved: Saved; onAnother: () => void }) {
  const [signed, setSigned] = useState<boolean | null>(saved.consentRequired ? null : false);
  const [copied, setCopied] = useState(false);
  const [gone, setGone] = useState(false);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/scholars/consent/${saved.token}`;

  useEffect(() => {
    fetch(`/api/scholars/consent/${saved.token}`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 404) return setGone(true); // removed by NVBC
        const v = await r.json();
        setSigned(r.ok ? v.signed : false);
      })
      .catch(() => setSigned(false));
  }, [saved.token]);

  useEffect(() => {
    if (gone) onAnother();
  }, [gone, onAnother]);

  const message = `Hi! I'm applying to be an NVBC Scholar. As I'm under 18, NVBC needs your consent. Please read and complete this page: ${link}`;
  async function share() {
    try {
      if (navigator.share) return await navigator.share({ text: message });
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      // The person closed the share sheet, or the browser refused: the link is still on screen.
    }
  }

  if (signed === null) return <FullScreenLoader />;
  const waiting = saved.consentRequired && !signed;
  return (
    <>
      <ScholarHero pill={waiting ? "One more step" : "Application received"}>
        <h1>{waiting ? <>Almost there, <em>{saved.name}!</em></> : <>Thank you, <em>{saved.name}!</em></>}</h1>
        <p>{waiting
          ? "We got your application. Your parent or guardian now needs to give their consent."
          : `We got your application. Please come to your tryout batch on time. NVBC management will announce the results on ${RESULTS_LABEL}.`}</p>
      </ScholarHero>
      {waiting && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Send this link to your parent or guardian</h2>
          <p className="muted">They need to complete it themselves <strong>before your tryout</strong>. Results: {RESULTS_LABEL}.</p>
          <input type="text" readOnly value={link} aria-label="Consent link" onFocus={(e) => e.target.select()} />
          <div className="actions">
            <button className="btn block" type="button" onClick={share}>{copied ? "Copied! Paste it in Messenger" : "Send or copy the link"}</button>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>Keep this page handy: it will show here once they have signed. Prefer paper? Ask the NVBC front desk for a printed consent form.</p>
        </div>
      )}
      <p style={{ textAlign: "center" }}>
        <button className="btn secondary small" type="button" onClick={onAnother}>Someone else on this phone is applying</button>
      </p>
    </>
  );
}
