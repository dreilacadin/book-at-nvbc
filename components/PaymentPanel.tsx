"use client";

import { imageToDataUrl } from "@/lib/image";
import { readReceipt } from "@/lib/receipt-read";
import {
  formatPeso,
  paymentLabel,
  paymentStatusLabel,
  type PaymentInfo,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/pricing";
import { useEffect, useState } from "react";

/** Public payment details (GCash number, BPI account, QR Ph image). */
export function usePaymentInfo() {
  const [info, setInfo] = useState<PaymentInfo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/payment-info", { cache: "no-store" })
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setError("Could not load payment details."));
  }, []);
  return { info, error };
}

/** Where to send an online payment: the GCash number, BPI account or QR Ph code. */
export function PaymentDetails({
  info,
  method,
  amount,
}: {
  info: PaymentInfo;
  method: PaymentMethod;
  amount: number;
}) {
  const [copied, setCopied] = useState("");
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value.replace(/\s/g, ""));
      setCopied(label);
    } catch {
      /* clipboard blocked */
    }
  };

  if (method === "gcash") {
    const accounts = info.gcashAccounts;
    return (
      <div className="pay-detail">
        <p style={{ margin: 0 }}>
          Send <strong>{formatPeso(amount)}</strong> via GCash to{" "}
          {accounts.length > 1 ? (
            <>
              <strong>any one</strong> of these:
            </>
          ) : (
            ":"
          )}
        </p>
        {accounts.map((a, i) => (
          <div key={a.number} className="acct">
            <div>
              <strong>{a.number}</strong>
              {a.name && <div className="muted">{a.name}</div>}
            </div>
            <button
              type="button"
              className="btn small secondary"
              onClick={() => copy(`gcash${i}`, a.number)}
            >
              {copied === `gcash${i}` ? "Copied ✓" : "Copy"}
            </button>
          </div>
        ))}
      </div>
    );
  }

  if (method === "bpi")
    return (
      <div className="pay-detail">
        <p style={{ margin: 0 }}>
          Transfer <strong>{formatPeso(amount)}</strong> to our BPI account:
        </p>
        <div className="acct">
          <div>
            <strong>{info.bpiAccountNumber}</strong>
            {info.bpiAccountName && (
              <div className="muted">{info.bpiAccountName}</div>
            )}
          </div>
          <button
            type="button"
            className="btn small secondary"
            onClick={() => copy("bpi", info.bpiAccountNumber)}
          >
            {copied === "bpi" ? "Copied ✓" : "Copy"}
          </button>
        </div>
      </div>
    );

  if (method === "qrph" && info.qrphImage)
    return (
      <div className="pay-detail" style={{ textAlign: "center" }}>
        <p style={{ margin: 0, textAlign: "left" }}>
          Scan with GCash, Maya or any bank app and pay{" "}
          <strong>{formatPeso(amount)}</strong>:
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={info.qrphImage}
          alt="NVBC QR Ph payment code"
          className="qr"
        />
        <div>
          <a
            href={info.qrphImage}
            download="NVBC-QRPh.png"
            className="btn small secondary"
          >
            Save QR image
          </a>
        </div>
      </div>
    );

  return null;
}

/** Text in a screenshot, read on this device (the image isn't sent anywhere for this). */
async function readImageText(file: File): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 45_000));
    const { data } = await Promise.race([worker.recognize(file), timeout]);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

type ReadState = { state: "reading" } | { state: "done"; reference: string | null; amount: number | null } | { state: "failed" };

/**
 * Reference number and/or receipt screenshot — at least one is needed for an online payment.
 * A screenshot is read on the player's device to fill in the reference number (and the amount,
 * when `onAmount` is given) for them to check.
 */
export function ProofFields({
  reference,
  onReference,
  proof,
  onProof,
  hasProof = false,
  amount,
  onAmount,
  expectedAmount,
}: {
  reference: string;
  onReference: (v: string) => void;
  proof: string;
  onProof: (v: string) => void;
  hasProof?: boolean; // a screenshot was already sent earlier
  amount?: string; // amount paid, as typed (bookings)
  onAmount?: (v: string) => void;
  expectedAmount?: number; // what the booking costs, to warn about a different amount
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [read, setRead] = useState<ReadState | null>(null);

  async function readNumbers(file: File) {
    setRead({ state: "reading" });
    try {
      const r = readReceipt(await readImageText(file));
      if (r.reference && !reference.trim()) onReference(r.reference);
      if (r.amount !== null && onAmount && !amount?.trim()) onAmount(String(r.amount));
      setRead(r.reference || r.amount !== null ? { state: "done", ...r } : { state: "failed" });
    } catch {
      setRead({ state: "failed" });
    }
  }
  const typed = amount !== undefined && amount.trim() !== "" ? Number(amount) : null;
  const amountOff = expectedAmount !== undefined && typed !== null && Number.isFinite(typed) && Math.abs(typed - expectedAmount) >= 0.01;
  return (
    <div className="proof-fields">
      <input
        type="text"
        aria-label="Reference number"
        placeholder="Reference no."
        value={reference}
        maxLength={60}
        onChange={(e) => onReference(e.target.value)}
      />
      <div className="proof-or">and / or</div>
      <label className="btn small secondary proof-upload">
        {busy
          ? "Reading…"
          : proof
            ? "Change screenshot"
            : hasProof
              ? "Replace screenshot"
              : "📷 Upload screenshot"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            setError("");
            try {
              onProof(
                await imageToDataUrl(
                  f,
                  1400,
                  "That screenshot is too large. Please crop it and try again.",
                ),
              );
              void readNumbers(f);
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Could not read that image.",
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {proof ? (
        <div className="proof-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={proof} alt="Your payment screenshot" />
          <button
            type="button"
            className="btn small secondary"
            onClick={() => onProof("")}
          >
            Remove
          </button>
        </div>
      ) : hasProof ? (
        <p className="hint" style={{ margin: "6px 0 0" }}>
          Screenshot received ✓
        </p>
      ) : null}
      {proof && read?.state === "reading" && (
        <p className="hint proof-read">🔎 Reading the reference number and amount from your screenshot…</p>
      )}
      {proof && read?.state === "done" && (
        <p className="hint proof-read">
          ✓ Filled in from your screenshot — <strong>please check they match your receipt</strong>.
          {!read.reference && " We couldn't read the reference number, so please type it."}
        </p>
      )}
      {proof && read?.state === "failed" && (
        <p className="hint proof-read">We couldn&apos;t read the numbers on this screenshot — please type the reference number{onAmount ? " and amount" : ""}.</p>
      )}
      {onAmount && (
        <div className="proof-amount">
          <label htmlFor="proof-amount">Amount paid (₱)</label>
          <input id="proof-amount" type="text" inputMode="decimal" placeholder={expectedAmount !== undefined ? String(expectedAmount) : "0.00"}
            maxLength={12} value={amount ?? ""} onChange={(e) => onAmount(e.target.value.replace(/[^\d.,]/g, ""))} />
        </div>
      )}
      {amountOff && expectedAmount !== undefined && (
        <div className="notice" style={{ marginTop: 8 }}>
          That&apos;s ₱{typed?.toLocaleString("en-PH")} — your booking is ₱{expectedAmount.toLocaleString("en-PH")}. Please check the amount you sent.
        </div>
      )}
      {error && (
        <div className="error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Shows how to pay for a booking and lets the player send their reference number and/or
 * a screenshot of the receipt. Used on the booking confirmation and on the My booking page.
 */
/** Seconds left until `deadline` (ISO), ticking every second; null without a deadline. */
function useSecondsLeft(deadline: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline
    ? Math.max(0, Math.floor((Date.parse(deadline) - now) / 1000))
    : null;
}

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function PaymentPanel({
  code,
  amount,
  method: initialMethod,
  status: initialStatus,
  reference: initialRef = "",
  hasProof: initialHasProof = false,
  payBy,
  deadline = null,
  rejectedNote = "",
  secondaryAction,
  onUpdated,
}: {
  code: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  reference?: string;
  hasProof?: boolean;
  payBy?: string; // "9:50 AM on Thu, Oct 1": unpaid bookings are released then
  deadline?: string | null; // online booking: send the payment by this time (ISO) or the slot is released
  rejectedNote?: string; // staff rejected the payment sent: why
  secondaryAction?: React.ReactNode; // e.g. "Cancel this booking", shown beside the main button
  onUpdated?: (p: {
    paymentMethod: PaymentMethod;
    paymentStatus: PaymentStatus;
    paymentRef: string;
    hasProof: boolean;
  }) => void;
}) {
  const { info, error: infoError } = usePaymentInfo();
  const [method, setMethod] = useState<PaymentMethod>(initialMethod);
  const [status, setStatus] = useState<PaymentStatus>(initialStatus);
  const [reference, setReference] = useState(initialRef);
  const [proof, setProof] = useState("");
  const [paidAmount, setPaidAmount] = useState(""); // what the player says they sent (read from the screenshot)
  const [hasProof, setHasProof] = useState(initialHasProof);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const secondsLeft = useSecondsLeft(
    status === "unpaid" || status === "rejected" ? deadline : null,
  );
  const timeUp = secondsLeft === 0;

  if (status === "paid" || status === "waived" || status === "refunded") {
    return (
      <div className="pay-box">
        <div className="pay-row">
          <span>Payment</span>
          <span className={`badge ${status === "paid" ? "" : "grey"}`}>
            {paymentStatusLabel(status)}
          </span>
        </div>
        {status === "paid" && (
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Thank you — see you on court!
          </p>
        )}
      </div>
    );
  }

  // Online methods; cash only for a booking already made as cash (coaches).
  const eMethods = (info?.methods ?? []).filter((m) => m !== "cash");
  const choices: PaymentMethod[] =
    initialMethod === "cash" ? ["cash", ...eMethods] : eMethods;

  if (timeUp)
    return (
      <div className="pay-box">
        <div className="pay-timer expired">⏱ Time&apos;s up</div>
        <p style={{ margin: "10px 0 0" }}>
          The time to pay for this booking has ended, so the slot has been
          released for other players. You&apos;re welcome to book again. If you
          already sent a payment, please contact the front desk.
        </p>
      </div>
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reference.trim() && !proof && !hasProof)
      return setError(
        "Enter the reference number or upload a screenshot of your receipt.",
      );
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/bookings/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, method, reference, proof, amountPaid: paidAmount }),
      });
      const json = await res.json();
      if (!res.ok)
        return setError(json.error || "Could not save your payment details.");
      setStatus(json.paymentStatus);
      setReference(json.paymentRef);
      setHasProof(json.hasProof);
      setProof("");
      onUpdated?.(json);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pay-box">
      {status === "for_verification" && (
        <div className="notice" style={{ marginTop: 10, marginBottom: 10 }}>
          Payment details received. Staff will confirm your payment shortly. You
          can correct them below if needed.
        </div>
      )}
      {secondsLeft !== null && (
        <div
          className={`pay-timer${secondsLeft <= 120 ? " urgent" : ""}`}
          role="timer"
          aria-live={secondsLeft <= 60 ? "assertive" : "off"}
        >
          ⏱ Time left to pay: <strong>{mmss(secondsLeft)}</strong>
        </div>
      )}
      <div className="pay-row">
        <span>Amount to pay</span>
        <strong style={{ fontSize: 22 }}>{formatPeso(amount)}</strong>
      </div>

      {info && choices.length > 1 && (
        <div
          className="method-pills"
          role="radiogroup"
          aria-label="Payment method"
        >
          {choices.map((m) => (
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
          Pay <strong>{formatPeso(amount)}</strong> in cash at the front desk
          {payBy ? (
            <>
              {" "}
              by <strong>{payBy}</strong>
            </>
          ) : (
            " before you play"
          )}{" "}
          and show your booking QR (or code <strong>{code}</strong>). Your
          booking is confirmed once staff receive your payment.
        </p>
      )}

      {info && <PaymentDetails info={info} method={method} amount={amount} />}

      {method !== "cash" && (
        <>
          <p className="muted" style={{ fontSize: 14, margin: "10px 0 0" }}>
            Put <strong>{code}</strong> in the message/notes if your app allows.
            After paying, enter the reference number or upload a screenshot of
            the receipt so staff can confirm it.
          </p>
          {status === "rejected" && (
            <div className="error pay-rejected" style={{ marginTop: 10 }}>
              <strong>We couldn&apos;t verify your payment.</strong>
              {rejectedNote && (
                <div style={{ marginTop: 4 }}>“{rejectedNote}”</div>
              )}
              <div style={{ marginTop: 4 }}>
                Please send a correct payment and its reference number or
                screenshot below before the timer runs out. If you think this is
                a mistake, please contact the front desk.
              </div>
            </div>
          )}

          <form onSubmit={submit} style={{ marginTop: 10 }}>
            <ProofFields
              reference={reference}
              onReference={setReference}
              proof={proof}
              onProof={setProof}
              hasProof={hasProof}
              amount={paidAmount}
              onAmount={setPaidAmount}
              expectedAmount={amount}
            />
            <div className="pay-actions">
              <button className="btn" disabled={busy}>
                {busy
                  ? "Sending…"
                  : status === "for_verification"
                    ? "Update"
                    : status === "rejected"
                      ? "Send again"
                      : "Submit payment details"}
              </button>
              {secondaryAction}
            </div>
          </form>
        </>
      )}

      {info?.note && (
        <p
          className="muted"
          style={{ fontSize: 14, margin: "10px 0 0", whiteSpace: "pre-wrap" }}
        >
          {info.note}
        </p>
      )}
      {(error || infoError) && (
        <div className="error" style={{ marginTop: 10 }}>
          {error || infoError}
        </div>
      )}
    </div>
  );
}
