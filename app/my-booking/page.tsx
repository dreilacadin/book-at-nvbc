"use client";

import BookingAlerts from "@/components/BookingAlerts";
import BookingChat from "@/components/BookingChat";
import BookingPolicy, { payByLabel } from "@/components/BookingPolicy";
import BookingQr from "@/components/BookingQr";
import { BookingHeader, Fold } from "@/components/BookingSummary";
import AddToCalendar from "@/components/AddToCalendar";
import BookingCoaching from "@/components/BookingCoaching";
import RescheduleBooking from "@/components/RescheduleBooking";
import { setCustomActivities, SPORTS } from "@/lib/sports";
import PaymentPanel from "@/components/PaymentPanel";
import { REFUND_HOURS, refundOnCancel } from "@/lib/booking-policy";
import {
  paymentLabel,
  rateTypeLabel,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/pricing";
import { forgetCode, loadCodes, type SavedCode } from "@/lib/saved-codes";
import { nowAtFacility } from "@/lib/time";
import { useEffect, useState } from "react";

type Booking = {
  code: string;
  courtName: string;
  sport: string;
  date: string;
  startHour: number;
  endHour: number;
  name: string;
  status: BookingStatus;
  canCancel: boolean;
  rateType: string;
  hourlyRate: number;
  discountPct: number;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentRef: string;
  hasProof: boolean;
  cancelledBy: string | null; // "system" = released (not paid in time)
  payBy: string | null; // online booking: pay by this time (ISO) or it's released
  courtNotes: string;
  phase: "in_progress" | "completed" | null;
  rejectedNote: string; // payment rejected by staff: why
  unreadMessages: number; // new messages from staff
  courts: string[]; // a group booking's courts
  coaching: { coachId: string; coach: string; status: "requested" | "accepted" | "declined" | "cancelled"; note: string } | null;
  coachBooking: string | null; // booked with this coach's own code
  activity: { id: string; label: string; emoji: string };
};

export default function MyBookingPage() {
  const [code, setCode] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<SavedCode[]>([]);

  useEffect(() => setSaved(loadCodes()), []);
  // Links in notifications and emails open /my-booking#NV-ABC123 (after "#", so the code stays
  // out of server logs).
  useEffect(() => {
    const fromHash = () => {
      const c = decodeURIComponent(window.location.hash.slice(1))
        .trim()
        .toUpperCase();
      if (/^NV-[A-Z0-9]{4,}$/.test(c)) {
        setCode(c);
        lookup(c);
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function lookup(c: string) {
    setBusy(true);
    setError("");
    setMessage("");
    setBooking(null);
    setConfirming(false);
    try {
      const res = await fetch("/api/bookings/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || "Booking not found.");
      else {
        // A custom activity (e.g. Zumba): register its name and emoji for display.
        if (json.activity && !SPORTS.some((s) => s.id === json.activity.id)) setCustomActivities([json.activity]);
        setBooking(json);
        setCode(json.code);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!booking) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: booking.code }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || "Could not cancel.");
      else {
        setBooking({ ...booking, status: "cancelled", canCancel: false });
        setMessage(
          "Your booking has been cancelled and the court is open for others. Thank you!",
        );
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  function removeSaved(c: string) {
    forgetCode(c);
    setSaved(loadCodes());
  }

  const refund = booking
    ? refundOnCancel(
        {
          payment_method: booking.paymentMethod,
          payment_status: booking.paymentStatus,
          date: booking.date,
          start_hour: booking.startHour,
        },
        nowAtFacility(),
      )
    : "none";

  // Payment still to do: keep the payment box first, and the QR code folded away.
  const needsPayment =
    !!booking &&
    booking.status === "pending" &&
    (booking.paymentStatus === "unpaid" || booking.paymentStatus === "rejected");

  // With an online payment still to send, "Cancel" sits beside the payment button.
  const cancelInPanel =
    !!booking &&
    booking.canCancel &&
    !confirming &&
    booking.status !== "cancelled" &&
    booking.amount > 0 &&
    booking.paymentMethod !== "cash" &&
    !["paid", "waived", "refunded"].includes(booking.paymentStatus);

  return (
    <div style={{ maxWidth: 560 }}>
      <h1>My booking</h1>
      <p className="lead">
        Enter the booking code you got when you reserved to view, pay for or
        cancel your booking.
      </p>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          lookup(code);
        }}
      >
        <label htmlFor="code">Booking code</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="code"
            type="text"
            placeholder="NV-ABC123"
            autoCapitalize="characters"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
          />
          <button className="btn" disabled={busy}>
            Find
          </button>
        </div>
      </form>

      {error && (
        <div className="error" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}
      {message && (
        <div className="success" style={{ marginTop: 16 }}>
          {message}
        </div>
      )}

      {booking && (
        <div className="card" style={{ marginTop: 16 }}>
          <BookingHeader
            b={booking}
            extra={
              <>
                Booked under {booking.name}
                {booking.rateType !== "regular" &&
                  ` · ${rateTypeLabel(booking.rateType)} rate`}
                {booking.courts.length > 1 &&
                  ` · 👥 ${booking.courts.length} courts, one payment`}
              </>
            }
          />
          {booking.courtNotes && booking.status !== "cancelled" && (
            <div className="court-note">ⓘ {booking.courtNotes}</div>
          )}

          <div className="folds">
            {booking.status !== "cancelled" && (
              <Fold
                icon="🎟️"
                title="Booking QR code"
                hint={booking.code}
                defaultOpen={!needsPayment}
              >
                <BookingQr code={booking.code} />
              </Fold>
            )}
            <BookingChat
              key={`chat-${booking.code}`}
              code={booking.code}
              unread={booking.unreadMessages}
            />
            {booking.status !== "cancelled" && !booking.phase && (
              <BookingAlerts key={`alerts-${booking.code}`} code={booking.code} />
            )}
            {!booking.coachBooking && (booking.coaching || (booking.status !== "cancelled" && booking.canCancel)) && (
              <BookingCoaching key={`coach-${booking.code}-${booking.coaching?.status ?? ""}`} code={booking.code} coaching={booking.coaching}
                onChanged={() => lookup(booking.code)} />
            )}
            {booking.status !== "cancelled" && !booking.phase && booking.canCancel && (
              <RescheduleBooking
                key={`move-${booking.code}-${booking.date}-${booking.startHour}`}
                code={booking.code}
                date={booking.date}
                startHour={booking.startHour}
                endHour={booking.endHour}
                onMoved={(msg) => {
                  lookup(booking.code).then(() => setMessage(msg));
                }}
              />
            )}
            {booking.status !== "cancelled" && (
              <AddToCalendar
                code={booking.code}
                sport={booking.sport}
                courts={booking.courtName}
                date={booking.date}
                startHour={booking.startHour}
                endHour={booking.endHour}
              />
            )}
          </div>
          {booking.status !== "cancelled" && booking.amount > 0 &&
            !["paid", "waived", "refunded"].includes(booking.paymentStatus) && (
            <PaymentPanel
              key={booking.code}
              code={booking.code}
              amount={booking.amount}
              method={booking.paymentMethod}
              status={booking.paymentStatus}
              reference={booking.paymentRef}
              hasProof={booking.hasProof}
              payBy={payByLabel(booking.date, booking.startHour)}
              deadline={booking.payBy}
              rejectedNote={booking.rejectedNote}
              secondaryAction={
                cancelInPanel ? (
                  <button
                    type="button"
                    className="btn secondary"
                    aria-label="Cancel this booking"
                    onClick={() => setConfirming(true)}
                  >
                    Cancel
                  </button>
                ) : undefined
              }
              onUpdated={(u) =>
                setBooking({
                  ...booking,
                  ...u,
                  payBy: null,
                  status:
                    u.paymentStatus === "for_verification"
                      ? "pending"
                      : booking.status,
                })
              }
            />
          )}
          {booking.status === "cancelled" &&
            booking.paymentStatus === "paid" &&
            booking.paymentMethod !== "cash" && (
              <p className="muted" style={{ fontSize: 14 }}>
                You paid for this booking by{" "}
                {paymentLabel(booking.paymentMethod)}. Refunds apply to bookings
                cancelled at least {REFUND_HOURS} hours before the start time —
                please contact the front desk about your refund.
              </p>
            )}

          {booking.canCancel && !confirming && !cancelInPanel && (
            <div className="actions">
              <button
                className="btn secondary"
                onClick={() => setConfirming(true)}
              >
                Cancel this booking
              </button>
            </div>
          )}
          {confirming && refund !== "none" && (
            <div
              className={refund === "refundable" ? "success" : "notice"}
              style={{ marginTop: 14 }}
            >
              {refund === "refundable"
                ? `You're cancelling at least ${REFUND_HOURS} hours before your start time, so your ${paymentLabel(booking.paymentMethod)} payment is eligible for a refund. The front desk will arrange it.`
                : `Your start time is less than ${REFUND_HOURS} hours away, so your ${paymentLabel(booking.paymentMethod)} payment is non-refundable if you cancel now.`}
            </div>
          )}
          {confirming && (
            <div className="actions" style={{ alignItems: "center" }}>
              <span className="muted" style={{ marginRight: "auto" }}>
                Cancel for sure?
              </span>
              <button
                className="btn secondary"
                onClick={() => setConfirming(false)}
              >
                Keep it
              </button>
              <button className="btn danger" onClick={cancel} disabled={busy}>
                Yes, cancel
              </button>
            </div>
          )}
          {booking.status !== "cancelled" && !booking.canCancel && (
            <p className="muted" style={{ fontSize: 14, marginBottom: 0 }}>
              This booking has already started. Please talk to the front desk
              for changes.
            </p>
          )}
          {booking.status !== "cancelled" && booking.amount > 0 && (
            <div className="folds">
              <Fold icon="ⓘ" title="Good to know">
                <BookingPolicy title="Payments and refunds" />
              </Fold>
            </div>
          )}
        </div>
      )}

      {saved.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h2>Saved on this device</h2>
          <div className="card" style={{ padding: 8 }}>
            {saved.map((s) => (
              <div
                key={s.code}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 8,
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontFamily: "ui-monospace, monospace" }}>
                    {s.code}
                  </strong>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {s.label}
                  </div>
                </div>
                <button
                  className="btn small secondary"
                  onClick={() => lookup(s.code)}
                >
                  View
                </button>
                <button
                  className="btn small secondary"
                  aria-label={`Forget ${s.code}`}
                  onClick={() => removeSaved(s.code)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
