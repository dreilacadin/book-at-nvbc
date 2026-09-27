"use client";

import { useEffect, useState } from "react";
import {
  formatPeso,
  paymentLabel,
  paymentStatusLabel,
  type PaymentInfo,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/pricing";

/**
 * Shows how to pay for a booking and lets the player send their reference number.
 * Used on the booking confirmation and on the My booking page.
 */
export default function PaymentPanel({
  code,
  amount,
  method: initialMethod,
  status: initialStatus,
  reference: initialRef = "",
  onUpdated,
}: {
  code: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  reference?: string;
  onUpdated?: (p: { paymentMethod: PaymentMethod; paymentStatus: PaymentStatus; paymentRef: string }) => void;
}) {
  const [info, setInfo] = useState<PaymentInfo | null>(null);
  const [method, setMethod] = useState<PaymentMethod>(initialMethod);
  const [status, setStatus] = useState<PaymentStatus>(initialStatus);
  const [reference, setReference] = useState(initialRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetch("/api/payment-info", { cache: "no-store" })
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setError("Could not load payment details."));
  }, []);

  if (status === "paid" || status === "waived" || status === "refunded") {
    return (
      <div className="pay-box">
        <div className="pay-row">
          <span>Payment</span>
          <span className={`badge ${status === "paid" ? "" : "grey"}`}>{paymentStatusLabel(status)}</span>
        </div>
        {status === "paid" && <p className="muted" style={{ margin: "6px 0 0" }}>Thank you — see you on court!</p>}
      </div>
    );
  }

  const eMethods = (info?.methods ?? []).filter((m) => m !== "cash");
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value.replace(/\s/g, ""));
      setCopied(label);
    } catch {
      /* clipboard blocked */
    }
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/bookings/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, method, reference }),
      });
      const json = await res.json();
      if (!res.ok) return setError(json.error || "Could not save your reference number.");
      setStatus(json.paymentStatus);
      onUpdated?.(json);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pay-box">
      <div className="pay-row">
        <span>Amount to pay</span>
        <strong style={{ fontSize: 22 }}>{formatPeso(amount)}</strong>
      </div>

      {info && eMethods.length > 0 && (
        <div className="method-pills" role="radiogroup" aria-label="Payment method">
          {(info.methods.includes("cash") ? (["cash", ...eMethods] as PaymentMethod[]) : eMethods).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              onClick={() => setMethod(m)}
            >
              {paymentLabel(m)}
            </button>
          ))}
        </div>
      )}

      {method === "cash" && (
        <p style={{ margin: "10px 0 0" }}>
          Pay <strong>{formatPeso(amount)}</strong> in cash at the front desk before you play. Just tell staff your
          booking code <strong>{code}</strong>.
        </p>
      )}

      {info && method === "gcash" && (
        <div className="pay-detail">
          <p style={{ margin: 0 }}>Send <strong>{formatPeso(amount)}</strong> via GCash to:</p>
          <div className="acct">
            <div>
              <strong>{info.gcashNumber}</strong>
              {info.gcashName && <div className="muted">{info.gcashName}</div>}
            </div>
            <button type="button" className="btn small secondary" onClick={() => copy("gcash", info.gcashNumber)}>
              {copied === "gcash" ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {info && method === "bpi" && (
        <div className="pay-detail">
          <p style={{ margin: 0 }}>Transfer <strong>{formatPeso(amount)}</strong> to our BPI account:</p>
          <div className="acct">
            <div>
              <strong>{info.bpiAccountNumber}</strong>
              {info.bpiAccountName && <div className="muted">{info.bpiAccountName}</div>}
            </div>
            <button type="button" className="btn small secondary" onClick={() => copy("bpi", info.bpiAccountNumber)}>
              {copied === "bpi" ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {info && method === "qrph" && info.qrphImage && (
        <div className="pay-detail" style={{ textAlign: "center" }}>
          <p style={{ margin: 0, textAlign: "left" }}>
            Scan with GCash, Maya or any bank app and pay <strong>{formatPeso(amount)}</strong>:
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={info.qrphImage} alt="NVBC QR Ph payment code" className="qr" />
          <div>
            <a href={info.qrphImage} download="NVBC-QRPh.png" className="btn small secondary">Save QR image</a>
          </div>
        </div>
      )}

      {method !== "cash" && (
        <>
          <p className="muted" style={{ fontSize: 14, margin: "10px 0 0" }}>
            Put <strong>{code}</strong> in the message/notes if your app allows. After paying, enter the reference
            number below so staff can confirm it.
          </p>
          {status === "for_verification" && (
            <div className="success" style={{ marginTop: 10 }}>
              Reference received. Staff will confirm your
              payment shortly. You can correct it below if needed.
            </div>
          )}
          <form onSubmit={submit} style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              type="text"
              aria-label="Reference number"
              placeholder="Reference no."
              value={reference}
              maxLength={60}
              required
              onChange={(e) => setReference(e.target.value)}
            />
            <button className="btn" disabled={busy} style={{ whiteSpace: "nowrap" }}>
              {busy ? "Sending…" : status === "for_verification" ? "Update" : "I've paid"}
            </button>
          </form>
        </>
      )}

      {info?.note && <p className="muted" style={{ fontSize: 14, margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{info.note}</p>}
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}
