"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GENDERS, MEMBER_TYPES, type MemberType } from "@/lib/membership";
import { formatPeso } from "@/lib/pricing";
import { loadMembership, saveMembership, type SavedMembership } from "@/lib/saved-membership";
import { SPORTS } from "@/lib/sports";

export default function MembershipForm() {
  const router = useRouter();
  const [fees, setFees] = useState<Record<MemberType, number> | null>(null);
  const [saved, setSaved] = useState<SavedMembership | null>(null);
  const [memberType, setMemberType] = useState<MemberType>("adult");
  const [f, setF] = useState({
    fullName: "",
    email: "",
    mobile: "",
    birthdate: "",
    gender: "",
    address: "",
    school: "",
    studentId: "",
    emergencyName: "",
    emergencyMobile: "",
    website: "", // honeypot
  });
  const [sports, setSports] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSaved(loadMembership());
    fetch("/api/membership", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setFees(j.fees))
      .catch(() => {});
  }, []);

  const field = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, memberType, sports, consent }),
      });
      const json = await res.json();
      if (!res.ok) return setError(json.error || "Could not send your application. Please try again.");
      saveMembership({ token: json.token, name: f.fullName.trim(), appliedOn: new Date().toISOString().slice(0, 10) });
      router.push(`/membership/${json.token}`);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <h1>Become an NVBC Member</h1>
      <p className="lead">
        Members book courts at the member rate. Fill in the form, pay the yearly fee, and once the front desk
        approves it you&apos;ll get your personal member QR code. Membership is valid for 365 days.
      </p>

      {saved && (
        <div className="notice" style={{ marginBottom: 16 }}>
          You applied on this device{saved.name ? ` as ${saved.name}` : ""}.{" "}
          <Link href={`/membership/${saved.token}`}><strong>View your membership →</strong></Link>
        </div>
      )}

      <form className="card member-form" onSubmit={submit}>
        <fieldset>
          <legend>Membership</legend>
          <div className="segmented member-types" role="radiogroup" aria-label="Membership type">
            {MEMBER_TYPES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={memberType === t.id} onClick={() => setMemberType(t.id)}>
                {t.label}
                {fees && <small>{formatPeso(fees[t.id])} / year</small>}
              </button>
            ))}
          </div>
          {memberType === "student" && (
            <p className="hint" style={{ margin: "8px 0 0" }}>Bring your school ID when you pay — staff check it before approving.</p>
          )}
        </fieldset>

        <fieldset>
          <legend>About you</legend>
          <div className="field">
            <label htmlFor="m-name">Full name</label>
            <input id="m-name" type="text" required minLength={4} maxLength={80} autoComplete="name"
              placeholder="First and last name" {...field("fullName")} />
          </div>
          <div className="row field">
            <div>
              <label htmlFor="m-bday">Birthdate</label>
              <input id="m-bday" type="date" required max={today} autoComplete="bday" {...field("birthdate")} />
            </div>
            <div>
              <label htmlFor="m-gender">Gender <span className="hint">(optional)</span></label>
              <select id="m-gender" {...field("gender")}>
                <option value="">—</option>
                {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          {memberType === "student" && (
            <div className="row field">
              <div>
                <label htmlFor="m-school">School</label>
                <input id="m-school" type="text" required maxLength={120} {...field("school")} />
              </div>
              <div>
                <label htmlFor="m-sid">Student ID no.</label>
                <input id="m-sid" type="text" required maxLength={40} {...field("studentId")} />
              </div>
            </div>
          )}
          <div className="field">
            <label>Sports you play <span className="hint">(optional)</span></label>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {SPORTS.map((sp) => (
                <label key={sp.id} className="check">
                  <input type="checkbox" checked={sports.includes(sp.id)}
                    onChange={(e) => setSports((s) => (e.target.checked ? [...s, sp.id] : s.filter((x) => x !== sp.id)))} />
                  {sp.emoji} {sp.label}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Contact details</legend>
          <div className="row field">
            <div>
              <label htmlFor="m-email">Email</label>
              <input id="m-email" type="email" required maxLength={120} autoComplete="email" {...field("email")} />
            </div>
            <div>
              <label htmlFor="m-mobile">Mobile number</label>
              <input id="m-mobile" type="tel" required maxLength={20} autoComplete="tel" placeholder="09XX XXX XXXX" {...field("mobile")} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="m-address">Home address</label>
            <textarea id="m-address" required minLength={8} maxLength={200} autoComplete="street-address"
              placeholder="House no., street, barangay, city" {...field("address")} />
          </div>
        </fieldset>

        <fieldset>
          <legend>Emergency contact</legend>
          <div className="row">
            <div>
              <label htmlFor="m-ename">Name</label>
              <input id="m-ename" type="text" required maxLength={80} {...field("emergencyName")} />
            </div>
            <div>
              <label htmlFor="m-emobile">Mobile number</label>
              <input id="m-emobile" type="tel" required maxLength={20} placeholder="09XX XXX XXXX" {...field("emergencyMobile")} />
            </div>
          </div>
        </fieldset>

        {/* Honeypot: hidden from people, often filled in by spam bots. */}
        <div className="hp" aria-hidden="true">
          <label htmlFor="m-website">Website</label>
          <input id="m-website" type="text" tabIndex={-1} autoComplete="off" {...field("website")} />
        </div>

        <label className="check consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
          <span>
            I agree that NVBC may keep these details to manage my membership and contact me about it, and I will follow
            the club&apos;s rules. My details are only seen by NVBC staff.
          </span>
        </label>

        {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
        <div className="actions">
          <button className="btn" disabled={busy}>
            {busy ? "Sending…" : `Apply${fees ? ` · ${formatPeso(fees[memberType])}` : ""}`}
          </button>
        </div>
      </form>
    </>
  );
}
