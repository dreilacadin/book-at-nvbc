"use client";

import { useState } from "react";
import { GENDERS, MEMBER_TYPES, type MemberType } from "@/lib/membership";
import { api, type AdminMember } from "./shared";

/** Staff form to correct a member's details (and, once approved, their membership dates). */
export default function EditMember({
  m,
  onSaved,
  onClose,
  onAuthError,
}: {
  m: AdminMember;
  onSaved: (updated: AdminMember) => void;
  onClose: () => void;
  onAuthError: (e: unknown) => void;
}) {
  const approved = m.status === "active" || m.status === "forfeited";
  const [f, setF] = useState({
    fullName: m.full_name,
    email: m.email,
    mobile: m.mobile,
    address: m.address,
    birthdate: m.birthdate ?? "",
    gender: m.gender,
    memberType: m.member_type as MemberType,
    school: m.school,
    studentId: m.student_id,
    emergencyName: m.emergency_name,
    emergencyMobile: m.emergency_mobile,
    staffNotes: m.staff_notes,
    memberSince: m.member_since ?? "",
    startsOn: m.starts_on ?? "",
    expiresOn: m.expires_on ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const field = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }),
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSaved(await api<AdminMember>("/api/admin/members", { action: "update", id: m.id, ...f }));
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="edit-member stack" onSubmit={save} style={{ gap: 12 }}>
      <h3 style={{ margin: 0 }}>Edit {m.full_name}{m.member_code ? ` · ${m.member_code}` : ""}</h3>
      <div className="row" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
        <div>
          <label htmlFor="em-name">Full name</label>
          <input id="em-name" type="text" required minLength={2} maxLength={80} {...field("fullName")} />
        </div>
        <div>
          <label htmlFor="em-type">Type</label>
          <select id="em-type" {...field("memberType")}>
            {MEMBER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="em-gender">Gender</label>
          <select id="em-gender" {...field("gender")}>
            <option value="">—</option>
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>
      <div className="row" style={{ gridTemplateColumns: "1.4fr 1fr 1fr" }}>
        <div>
          <label htmlFor="em-email">Email</label>
          <input id="em-email" type="email" maxLength={120} {...field("email")} />
        </div>
        <div>
          <label htmlFor="em-mobile">Mobile</label>
          <input id="em-mobile" type="tel" maxLength={20} {...field("mobile")} />
        </div>
        <div>
          <label htmlFor="em-bday">Birthdate</label>
          <input id="em-bday" type="date" {...field("birthdate")} />
        </div>
      </div>
      <div>
        <label htmlFor="em-address">Address</label>
        <input id="em-address" type="text" maxLength={200} {...field("address")} />
      </div>
      {f.memberType === "student" && (
        <div className="row">
          <div>
            <label htmlFor="em-school">School</label>
            <input id="em-school" type="text" maxLength={120} {...field("school")} />
          </div>
          <div>
            <label htmlFor="em-sid">Student ID</label>
            <input id="em-sid" type="text" maxLength={40} {...field("studentId")} />
          </div>
        </div>
      )}
      <div className="row">
        <div>
          <label htmlFor="em-ename">Emergency contact</label>
          <input id="em-ename" type="text" maxLength={80} {...field("emergencyName")} />
        </div>
        <div>
          <label htmlFor="em-emobile">Emergency number</label>
          <input id="em-emobile" type="tel" maxLength={20} {...field("emergencyMobile")} />
        </div>
      </div>
      {approved && (
        <div className="row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label htmlFor="em-since">Member since</label>
            <input id="em-since" type="date" {...field("memberSince")} />
          </div>
          <div>
            <label htmlFor="em-start">Current year starts</label>
            <input id="em-start" type="date" required {...field("startsOn")} />
          </div>
          <div>
            <label htmlFor="em-exp">Expires</label>
            <input id="em-exp" type="date" required {...field("expiresOn")} />
          </div>
        </div>
      )}
      <div>
        <label htmlFor="em-notes">Staff notes</label>
        <textarea id="em-notes" rows={3} maxLength={2000} {...field("staffNotes")} />
      </div>
      <p className="hint" style={{ margin: 0 }}>
        The member code and the member&apos;s private link don&apos;t change.
        {approved && " Changing the expiry date clears the “reminded” note."}
      </p>
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}
