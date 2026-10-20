"use client";

import { useState } from "react";
import { GENDERS, MEMBER_TYPES, type MemberType } from "@/lib/membership";
import { formatPeso, PAYMENT_METHODS, type PaymentMethod } from "@/lib/pricing";
import { api } from "./shared";

export type MemberFees = { student: number; adult: number };

type Added = { id: string; token: string; fullName: string; status: "active" | "pending"; memberCode: string | null; expiresOn: string | null };

const niceDate = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const EMPTY = {
  fullName: "",
  memberType: "adult" as MemberType,
  gender: "",
  email: "",
  mobile: "",
  birthdate: "",
  address: "",
  school: "",
  studentId: "",
  emergencyName: "",
  emergencyMobile: "",
  staffNotes: "",
  paymentStatus: "paid" as "paid" | "waived" | "unpaid",
  paymentMethod: "cash" as PaymentMethod,
};

/** Staff: sign someone up at the front desk. Paid or no charge → approved right away with a member code. */
export default function AddMember({
  fees,
  onAdded,
  onClose,
  onAuthError,
}: {
  fees: MemberFees | null;
  onAdded: () => void;
  onClose: () => void;
  onAuthError: (e: unknown) => void;
}) {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<Added | null>(null);
  const [copied, setCopied] = useState(false);

  const field = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }),
  });
  const fee = fees ? fees[f.memberType] : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setAdded(await api<Added>("/api/admin/members", { action: "add", ...f }));
      onAdded();
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Couldn't add the member");
    } finally {
      setBusy(false);
    }
  }

  if (added) {
    const link = `${location.origin}/membership/${added.token}`;
    return (
      <div className="card stack" style={{ gap: 12 }}>
        <div className="success">
          {added.status === "active" ? (
            <>
              <strong>{added.fullName}</strong> is now a member: <strong>{added.memberCode}</strong>, valid until{" "}
              {niceDate(added.expiresOn!)}.
            </>
          ) : (
            <>
              <strong>{added.fullName}</strong> was added as a pending application. Once they pay, mark the fee Paid and
              tap Approve to give them a member code.
            </>
          )}
        </div>
        <div>
          <label htmlFor="am-link">Their member page (shows their QR code — send it to them)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="am-link" type="text" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn secondary" onClick={async () => {
              try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select and copy by hand */ }
            }}>{copied ? "Copied ✓" : "Copy"}</button>
          </div>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn" onClick={() => { setF(EMPTY); setAdded(null); setCopied(false); }}>Add another member</button>
        </div>
      </div>
    );
  }

  return (
    <form className="card edit-member stack" onSubmit={save} style={{ gap: 12 }}>
      <h3 style={{ margin: 0 }}>Add a member</h3>
      <div className="row" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
        <div>
          <label htmlFor="am-name">Full name</label>
          <input id="am-name" type="text" required minLength={4} maxLength={80} autoComplete="off" {...field("fullName")} />
        </div>
        <div>
          <label htmlFor="am-type">Type</label>
          <select id="am-type" {...field("memberType")}>
            {MEMBER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="am-gender">Gender</label>
          <select id="am-gender" {...field("gender")}>
            <option value="">—</option>
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>
      <div className="row" style={{ gridTemplateColumns: "1.4fr 1fr 1fr" }}>
        <div>
          <label htmlFor="am-email">Email</label>
          <input id="am-email" type="email" maxLength={120} autoComplete="off" {...field("email")} />
        </div>
        <div>
          <label htmlFor="am-mobile">Mobile</label>
          <input id="am-mobile" type="tel" maxLength={20} autoComplete="off" {...field("mobile")} />
        </div>
        <div>
          <label htmlFor="am-bday">Birthdate</label>
          <input id="am-bday" type="date" required {...field("birthdate")} />
        </div>
      </div>
      <div>
        <label htmlFor="am-address">Address</label>
        <input id="am-address" type="text" maxLength={200} autoComplete="off" {...field("address")} />
      </div>
      {f.memberType === "student" && (
        <div className="row">
          <div>
            <label htmlFor="am-school">School</label>
            <input id="am-school" type="text" maxLength={120} {...field("school")} />
          </div>
          <div>
            <label htmlFor="am-sid">Student ID</label>
            <input id="am-sid" type="text" maxLength={40} {...field("studentId")} />
          </div>
        </div>
      )}
      <div className="row">
        <div>
          <label htmlFor="am-ename">Emergency contact</label>
          <input id="am-ename" type="text" maxLength={80} autoComplete="off" {...field("emergencyName")} />
        </div>
        <div>
          <label htmlFor="am-emobile">Emergency number</label>
          <input id="am-emobile" type="tel" maxLength={20} autoComplete="off" {...field("emergencyMobile")} />
        </div>
      </div>
      <div className="row">
        <div>
          <label htmlFor="am-paid">Membership fee{fee !== null ? ` (${formatPeso(fee)})` : ""}</label>
          <select id="am-paid" {...field("paymentStatus")}>
            <option value="paid">Paid now</option>
            <option value="waived">No charge</option>
            <option value="unpaid">Not paid yet</option>
          </select>
        </div>
        {f.paymentStatus === "paid" && (
          <div>
            <label htmlFor="am-method">Paid by</label>
            <select id="am-method" {...field("paymentMethod")}>
              {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        )}
      </div>
      <div>
        <label htmlFor="am-notes">Staff notes</label>
        <textarea id="am-notes" rows={2} maxLength={2000} {...field("staffNotes")} />
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {f.paymentStatus === "unpaid"
          ? "They'll be added as a pending application. Approve them from the list once they've paid."
          : "They'll be approved right away with a new member code, valid for a year from today."}
        {" "}A mobile number or email is needed; the other details can be filled in later with ✎ Edit details.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy}>
          {busy ? "Adding…" : f.paymentStatus === "unpaid" ? "Add application" : "Add member"}
        </button>
      </div>
    </form>
  );
}
