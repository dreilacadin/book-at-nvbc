"use client";

import { useEffect, useState } from "react";
import { Fold } from "./BookingSummary";

/** The booking's view-only link, ready to send: made when this shows, with Share… (phones) and Copy link. */
export function ShareLinkBox({ code, summary }: { code: string; summary: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    let gone = false;
    fetch("/api/bookings/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then(async (res) => {
        const j = await res.json();
        if (gone) return;
        if (res.ok) setUrl(window.location.origin + j.path);
        else setError(j.error || "Couldn't make the link. Please try again.");
      })
      .catch(() => {
        if (!gone) setError("Network error. Please try again.");
      });
    return () => {
      gone = true;
    };
  }, [code]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn't copy it. Press and hold the link to copy it.");
    }
  }

  return (
    <>
      {url ? (
        <>
          <input className="share-url" readOnly aria-label="Link to share" value={url} onFocus={(e) => e.target.select()} />
          <div className="cal-buttons" style={{ marginTop: 8 }}>
            {canShare && (
              <button type="button" className="btn small" onClick={() => navigator.share({ title: "NVBC court booking", text: summary, url }).catch(() => {})}>
                Share…
              </button>
            )}
            <button type="button" className={`btn small${canShare ? " secondary" : ""}`} onClick={copy}>
              {copied ? "✓ Copied" : "Copy link"}
            </button>
          </div>
        </>
      ) : !error && <p className="hint" style={{ margin: 0 }}>Making the link…</p>}
      {error && <p className="error" style={{ margin: "8px 0 0" }}>{error}</p>}
    </>
  );
}

/**
 * For customers (booking confirmation, My booking): a view-only link to send to the people playing.
 * The booking code is the key to the booking (it can change or cancel it), so this link is separate
 * and shows only when and where.
 */
export default function ShareBooking({ code, summary }: { code: string; summary: string }) {
  const [opened, setOpened] = useState(false); // the link is made the first time this is opened
  return (
    <Fold icon="🔗" title="Share this booking" onToggle={(open) => { if (open) setOpened(true); }}>
      <p style={{ margin: "0 0 8px" }}>
        Send this link to the people playing with you. They&apos;ll see the date, time and court, and it stays up to date if you
        move the booking. They can&apos;t change, cancel or pay for it.
      </p>
      {opened && <ShareLinkBox code={code} summary={summary} />}
      <p className="hint" style={{ margin: "8px 0 0" }}>
        Keep your booking code and QR code to yourself: anyone who has them can change or cancel the booking.
      </p>
    </Fold>
  );
}
