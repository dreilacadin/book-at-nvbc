"use client";

import { useState } from "react";
import { forgetVoucher, loadVoucher } from "@/lib/saved-voucher";
import { voucherPath, type BookingVoucherInfo } from "@/lib/voucher";
import VoucherOnBooking from "./VoucherOnBooking";

/**
 * My booking: the voucher on the booking (what it took off), or — before it's paid and before it
 * starts — a box to add one. Filled in from the voucher page when the customer came from there.
 */
export default function BookingVoucher({
  code,
  voucher,
  amountLeft,
  canAdd,
  onAdded,
}: {
  code: string;
  voucher: BookingVoucherInfo | null;
  amountLeft: number;
  canAdd: boolean; // unpaid, not started, not cancelled
  onAdded: () => void;
}) {
  const [input, setInput] = useState(() => (typeof window === "undefined" ? "" : loadVoucher()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (voucher) return <VoucherOnBooking v={voucher} href={voucherPath(voucher.code)} amountLeft={amountLeft} />;
  if (!canAdd) return null;

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/bookings/voucher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, voucher: input }),
      });
      const j = await res.json();
      if (!res.ok) return setError(j.error || "Couldn't add that voucher.");
      forgetVoucher();
      onAdded();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="field voucher-field" open={!!input}>
      <summary>🎟 Have a voucher?</summary>
      <div className="voucher-entry">
        <input aria-label="Voucher code" placeholder="VCH-XXXX-XXXX" value={input} autoCapitalize="characters" autoComplete="off"
          spellCheck={false} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }} />
        <button type="button" className="btn secondary" disabled={busy || !input.trim()} onClick={apply}>
          {busy ? "Adding…" : "Add voucher"}
        </button>
      </div>
      {error && <p className="error" style={{ margin: "6px 0 0" }}>{error}</p>}
      <p className="hint" style={{ margin: "6px 0 0" }}>Add it before you pay; it&apos;s taken off what you owe. One voucher per booking.</p>
    </details>
  );
}
