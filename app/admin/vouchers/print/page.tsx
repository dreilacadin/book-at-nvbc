"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import VoucherCard, { VoucherTerms } from "@/components/VoucherCard";
import { voucherStateLabel } from "@/lib/voucher";
import { api, AuthError } from "../../shared";
import type { AdminVoucher } from "@/lib/vouchers";

/**
 * Staff: vouchers ready to print (/admin/vouchers/print?ids=…). A4, two per page, each card with
 * its terms below a cut line. Vouchers that can't be used are stamped (Void, Expired, …).
 */
export default function PrintVouchers() {
  const [vouchers, setVouchers] = useState<AdminVoucher[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const ids = new URLSearchParams(window.location.search).get("ids") ?? "";
    if (!ids) return setError("No vouchers chosen. Open a voucher in Admin → Vouchers and tap Print.");
    api<{ vouchers: AdminVoucher[] }>(`/api/admin/vouchers?ids=${encodeURIComponent(ids)}`)
      .then((r) => (r.vouchers.length ? setVouchers(r.vouchers) : setError("Those vouchers weren't found.")))
      .catch((e) => setError(e instanceof AuthError ? "Please log in to the staff dashboard first." : e.message));
  }, []);

  if (error)
    return (
      <div className="stack" style={{ maxWidth: 520 }}>
        <div className="error">{error}</div>
        <Link href="/admin" className="btn secondary">Back to the staff dashboard</Link>
      </div>
    );
  if (!vouchers) return <FullScreenLoader label="Getting the vouchers ready…" />;

  const notReady = vouchers.filter((v) => v.state !== "ready" && v.state !== "not_yet");
  return (
    <div className="stack">
      <style>{`@page { size: A4 portrait; margin: 9mm 10mm; }`}</style>
      <div className="card no-print stack" style={{ maxWidth: 760 }}>
        <h1 style={{ margin: 0 }}>Print {vouchers.length === 1 ? "voucher" : `${vouchers.length} vouchers`}</h1>
        <p className="muted" style={{ margin: 0 }}>
          Prints on A4, two per page. In the print window, turn on <strong>Background graphics</strong> (Chrome: More
          settings) so the dark card prints, and keep the scale at 100%. Cut along the card&apos;s edge; fold or staple the
          terms behind it.
        </p>
        {notReady.length > 0 && (
          <div className="notice">
            ⚠ {notReady.length === vouchers.length ? "These vouchers" : `${notReady.length} of these vouchers`} can&apos;t be used
            ({[...new Set(notReady.map((v) => voucherStateLabel(v.state).toLowerCase()))].join(", ")}), so they print with a
            stamp across them.
          </div>
        )}
        <div className="actions" style={{ margin: 0 }}>
          <button type="button" className="btn" onClick={() => window.print()}>🖨 Print</button>
          <button type="button" className="btn secondary" onClick={() => window.close()}>Close</button>
        </div>
      </div>
      <div className="voucher-sheet">
        {vouchers.map((v) => (
          <div key={v.id} className="voucher-print-item">
            <VoucherCard v={v} state={v.state} print />
            <VoucherTerms v={v} compact />
          </div>
        ))}
      </div>
    </div>
  );
}
