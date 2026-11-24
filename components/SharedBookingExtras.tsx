"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Fold } from "./BookingSummary";
import { loadCodes, saveCode } from "@/lib/saved-codes";

/**
 * The view-only link as a QR code: staff scan it at the front desk to find the booking, and the
 * people playing can scan it to open this page. It isn't the booking code, so it can't change anything.
 */
export function SharedBookingQr({ token }: { token: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}/b/${token}`, { errorCorrectionLevel: "M", margin: 2, width: 280 })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [token]);
  if (!src) return null;
  return (
    <div className="booking-qr">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="QR code for this booking" />
      <p className="hint" style={{ margin: 0 }}>Show this at the front desk to find the booking, or let someone scan it to open this page.</p>
    </div>
  );
}

/** Asks whether one of `codes` holds the booking behind the link: its code, null if none does. */
async function ownerCode(token: string, codes: string[]): Promise<string | null> {
  const res = await fetch("/api/bookings/share/owner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, codes }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.ok) return j.code;
  if (res.status === 404) return null;
  throw new Error(j.error || "Something went wrong. Please try again.");
}

/**
 * The person who made the booking (its code is saved on this phone, or they type it) can manage it
 * from the shared link: it opens My booking. Everyone else sees that the page is view-only.
 */
export function SharedBookingOwner({ token, active, label, date }: {
  token: string;
  active: boolean; // not cancelled or finished: can still be changed, paid or cancelled
  label: string; // to remember the code on this phone, as booking does
  date: string;
}) {
  const [owner, setOwner] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const codes = loadCodes().map((c) => c.code);
    if (!codes.length) return;
    let gone = false;
    ownerCode(token, codes)
      .then((c) => { if (!gone) setOwner(c); })
      .catch(() => {}); // they can still type their code
    return () => { gone = true; };
  }, [token]);

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (!typed.trim()) return;
    setBusy(true);
    setError("");
    try {
      const c = await ownerCode(token, [typed]);
      if (!c) setError("That booking code isn't for this booking.");
      else {
        saveCode({ code: c, label, date });
        window.location.href = `/my-booking#${c}`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (owner)
    return (
      <>
        <div className="shared-owner">
          <div>
            <strong>✓ You made this booking</strong>
            <div className="hint">{active ? "Change the time or court, pay, or cancel it in My booking." : "See all its details in My booking."}</div>
          </div>
          <a className="btn" href={`/my-booking#${owner}`}>{active ? "✎ Manage booking" : "Open in My booking"}</a>
        </div>
        <p className="hint" style={{ margin: 0 }}>Anyone else with this link only sees when and where, and can&apos;t change it.</p>
      </>
    );
  return (
    <>
      {active && (
        <div className="folds">
          <Fold icon="🔑" title="Did you make this booking?">
            <form className="shared-claim" onSubmit={claim}>
              <label htmlFor="shared-code">Enter your booking code to change, pay for or cancel it.</label>
              <div className="lookup-bar">
                <input id="shared-code" type="text" autoComplete="off" spellCheck={false} placeholder="NV-XXXXXX"
                  value={typed} onChange={(e) => setTyped(e.target.value)} />
                <button className="btn" disabled={busy || !typed.trim()}>{busy ? "Checking…" : "Manage"}</button>
              </div>
              {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
              <p className="hint" style={{ margin: 0 }}>You got it when you booked. It&apos;s also in My booking on the phone you booked with, and in our emails about the booking.</p>
            </form>
          </Fold>
        </div>
      )}
      <p className="hint" style={{ margin: 0 }}>
        This page always shows the latest time and court. It&apos;s view-only: only the person who booked can change, cancel or pay for it.
      </p>
    </>
  );
}
