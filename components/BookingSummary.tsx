"use client";

import { useState } from "react";
import { payByLabel } from "@/components/BookingPolicy";
import { formatRange } from "@/lib/format";
import { formatPeso, paymentLabel } from "@/lib/pricing";
import { sportEmoji } from "@/lib/sports";

type Tone = "ok" | "pending" | "reserved" | "bad" | "grey";

/** What to tell a customer about their booking right now: a pill and one short line. */
export function customerStatus(b: {
  status: string;
  paymentStatus: string;
  phase?: string | null;
  cancelledBy?: string | null;
  amount: number;
  date: string;
  startHour: number;
}): { label: string; tone: Tone; line: string } {
  if (b.status === "cancelled")
    return b.cancelledBy === "system"
      ? { label: "Released", tone: "grey", line: "Released — it wasn't paid in time. You're welcome to book again." }
      : { label: "Cancelled", tone: "grey", line: "This booking was cancelled." };
  if (b.phase === "in_progress") return { label: "In progress", tone: "ok", line: "Enjoy your game!" };
  if (b.phase === "completed") return { label: "Completed", tone: "grey", line: "Thanks for playing at NVBC!" };
  if (b.status === "reserved")
    return { label: "Reserved", tone: "reserved", line: `Pay ${formatPeso(b.amount)} cash at the front desk by ${payByLabel(b.date, b.startHour)}.` };
  if (b.status === "pending") {
    if (b.paymentStatus === "rejected") return { label: "Pending", tone: "bad", line: "We couldn't verify your payment — see the note below." };
    if (b.paymentStatus === "for_verification")
      return { label: "Pending", tone: "pending", line: "Payment received — staff will confirm it shortly." };
    return { label: "Pending", tone: "pending", line: "Pay before the timer runs out to keep this slot." };
  }
  return { label: "Confirmed", tone: "ok", line: "You're all set — show your QR code at the front desk." };
}

const BADGE: Record<Tone, string> = { ok: "", pending: "pending", reserved: "coach-reserved", bad: "bad", grey: "grey" };

/** The top of a booking: status, when, where, how much — in four short lines. */
export function BookingHeader({
  b,
  extra,
}: {
  b: {
    code: string; courtName: string; sport: string; date: string; startHour: number; endHour: number;
    amount: number; paymentMethod: string; status: string; paymentStatus: string; phase?: string | null; cancelledBy?: string | null;
  };
  extra?: React.ReactNode; // e.g. "Booked under Juan · Member rate"
}) {
  const s = customerStatus(b);
  const day = new Date(b.date + "T00:00:00Z").toLocaleDateString("en-PH", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div className="bk-head">
      <div className="bk-head-top">
        <span className={`badge ${BADGE[s.tone]}`}>{s.label}</span>
        <span className="mono muted">{b.code}</span>
      </div>
      <div className="bk-head-when">{day} · {formatRange(b.startHour, b.endHour)}</div>
      <div className="muted">
        {sportEmoji(b.sport)} {b.courtName} · {b.amount > 0 ? `${formatPeso(b.amount)} · ${paymentLabel(b.paymentMethod)}` : "No charge"}
      </div>
      {extra && <div className="muted bk-head-extra">{extra}</div>}
      <p className={`bk-head-line ${s.tone}`}>{s.line}</p>
    </div>
  );
}

/** A collapsible row: icon, title and a short state on the right ("On", "2 new"), details inside. */
export function Fold({
  icon,
  title,
  hint,
  hintTone,
  defaultOpen = false,
  id,
  onToggle,
  children,
}: {
  icon: string;
  title: string;
  hint?: React.ReactNode;
  hintTone?: "on" | "off" | "new";
  defaultOpen?: boolean;
  id?: string;
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details id={id} className="fold" open={open}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(o);
        onToggle?.(o);
      }}>
      <summary>
        <span className="fold-icon" aria-hidden="true">{icon}</span>
        <span className="fold-title">{title}</span>
        {hint !== undefined && hint !== null && hint !== "" && <span className={`fold-hint ${hintTone ?? ""}`}>{hint}</span>}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
