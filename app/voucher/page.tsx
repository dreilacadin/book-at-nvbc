"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import VoucherCard, { VoucherTerms } from "@/components/VoucherCard";
import { formatDateLong } from "@/lib/format";
import { saveVoucher } from "@/lib/saved-voucher";
import {
  normalizeVoucherCode,
  ONDECK_HOST,
  ONDECK_URL,
  onDeckSessionName,
  voucherLeftLabel,
  voucherPath,
  type Voucher,
  type VoucherState,
} from "@/lib/voucher";

type PublicVoucher = Omit<Voucher, "issuedTo"> & { state: VoucherState };

/** What the voucher's QR code opens (/voucher#VCH-XXXX-XXXX): is it good, what's left, its terms, and book with it. */
export default function VoucherPage() {
  const [input, setInput] = useState("");
  const [voucher, setVoucher] = useState<PublicVoucher | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const check = useCallback(async (raw: string) => {
    const code = normalizeVoucherCode(raw);
    if (!code) return setError("Voucher codes look like VCH-ABCD-2345. Please check the code.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/vouchers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const j = await res.json();
      if (!res.ok) {
        setVoucher(null);
        return setError(j.error || "Couldn't check that voucher.");
      }
      setVoucher(j);
      setInput(code);
      if (window.location.hash.slice(1) !== code) window.history.replaceState(null, "", voucherPath(code));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const fromLink = decodeURIComponent(window.location.hash.slice(1));
    if (fromLink) check(fromLink);
  }, [check]);

  const usable = voucher && (voucher.state === "ready" || voucher.state === "not_yet");
  const banner: Record<VoucherState, { tone: string; text: string }> | null = voucher && {
    ready: { tone: "success", text: `✓ Ready to use · ${voucherLeftLabel(voucher)}` },
    not_yet: {
      tone: "notice",
      text: voucher.kind === "ondeck_session"
        ? `Valid for sessions from ${voucher.validFrom ? formatDateLong(voucher.validFrom) : "a later date"}.`
        : `Valid for bookings from ${voucher.validFrom ? formatDateLong(voucher.validFrom) : "a later date"} · you can book now for then.`,
    },
    paused: { tone: "notice", text: "This voucher is paused for now. Please ask the front desk." },
    used_up: { tone: "notice", text: "This voucher has been fully used." },
    expired: { tone: "error", text: `This voucher expired on ${voucher.expiresOn ? formatDateLong(voucher.expiresOn) : "an earlier date"}.` },
    void: { tone: "error", text: "This voucher is no longer valid. If you think that's a mistake, please contact the front desk." },
    redeemed: { tone: "notice", text: "This voucher has been redeemed." },
  };

  return (
    <div className="stack" style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ margin: 0 }}>🎟 Voucher</h1>
      <form className="lookup-bar" onSubmit={(e) => { e.preventDefault(); check(input); }}>
        <input aria-label="Voucher code" placeholder="VCH-XXXX-XXXX" value={input} onChange={(e) => setInput(e.target.value)}
          autoCapitalize="characters" autoComplete="off" spellCheck={false} />
        <button className="btn" disabled={busy}>{busy ? "Checking…" : "Check"}</button>
      </form>
      {error && <div className="error">{error}</div>}
      {voucher && banner && (
        <>
          <VoucherCard v={voucher} state={voucher.state} />
          <div className={banner[voucher.state].tone}>{banner[voucher.state].text}</div>
          {usable && voucher.kind === "ondeck_session" && (
            <div className="card stack">
              <strong>How to use it</strong>
              <p style={{ margin: 0 }}>
                This voucher is for a free <strong>{onDeckSessionName(voucher.sports[0])}</strong> at NVBC On Deck. Show it, or this
                page, to the On Deck staff when you sign up for the session — they&apos;ll scan or type the code. It can&apos;t be used
                to book a court.
              </p>
              <div className="actions" style={{ margin: 0 }}>
                <a href={ONDECK_URL} className="btn" target="_blank" rel="noopener">Open NVBC On Deck ({ONDECK_HOST})</a>
              </div>
            </div>
          )}
          {usable && voucher.kind !== "ondeck_session" && (
            <div className="card stack">
              <strong>How to use it</strong>
              <p style={{ margin: 0 }}>
                Book a court as usual — the voucher is filled in for you and taken off the price before you pay. You can also
                show this voucher at the front desk.
              </p>
              <div className="actions" style={{ margin: 0 }}>
                <button type="button" className="btn" onClick={() => { saveVoucher(voucher.code); window.location.href = "/"; }}>
                  Book a court with this voucher
                </button>
                <Link href="/my-booking" className="btn secondary" onClick={() => saveVoucher(voucher.code)}>
                  Already booked? Add it to your booking
                </Link>
              </div>
            </div>
          )}
          <VoucherTerms v={voucher} />
        </>
      )}
      {!voucher && !error && !busy && (
        <p className="muted">Enter the code printed on your voucher, or scan its QR code with your phone camera.</p>
      )}
    </div>
  );
}
