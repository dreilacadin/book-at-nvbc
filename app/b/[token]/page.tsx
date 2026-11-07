import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import AddToCalendar from "@/components/AddToCalendar";
import { sharedBooking } from "@/lib/bookings";
import { formatDateLong, formatRange } from "@/lib/format";

export const dynamic = "force-dynamic";

// One database read for the page and its link preview.
const load = cache(sharedBooking);

const STATE = {
  confirmed: { tone: "", label: "Confirmed", line: "This booking is confirmed. See you there!" },
  unconfirmed: { tone: "pending", label: "Not confirmed yet", line: "The person who booked still has to pay or be verified. If it isn't paid in time, the court is released." },
  cancelled: { tone: "grey", label: "Cancelled", line: "This booking was cancelled, so the court isn't held any more." },
  over: { tone: "grey", label: "Finished", line: "This booking has already been played." },
};

// A private link: keep it out of search engines. Chat apps still show the when and where in their preview.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const b = await load((await params).token);
  if (!b) return { title: "NVBC Courts", robots: { index: false, follow: false } };
  const title = `${b.label} at NVBC — ${formatDateLong(b.date)}, ${formatRange(b.startHour, b.endHour)}`;
  const description = `${b.courts.join(", ")} · ${STATE[b.state].label}`;
  return { title, description, robots: { index: false, follow: false }, openGraph: { title, description } };
}

/** A view-only booking link (from "Share this booking" on My booking): when and where, nothing else. */
export default async function SharedBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const b = await load((await params).token);
  if (!b)
    return (
      <div className="card shared-booking">
        <h1 style={{ marginTop: 0 }}>Booking not found</h1>
        <p>This link isn&apos;t valid any more. Please ask the person who shared it for a new one.</p>
        <Link href="/" className="btn">Book a court</Link>
      </div>
    );
  const s = STATE[b.state];
  return (
    <div className="card shared-booking">
      <span className={`badge ${s.tone}`}>{s.label}</span>
      <h1>{formatDateLong(b.date)}</h1>
      <p className="shared-when">{formatRange(b.startHour, b.endHour)}</p>
      <p className="shared-where">{b.emoji} {b.label} · {b.courts.join(", ")}</p>
      <p className="muted">NV Badminton Center · Booked by {b.bookedBy}</p>
      <p className="bk-head-line">{s.line}</p>
      {b.state !== "cancelled" && b.notes.map((n) => <div key={n} className="court-note">ⓘ {n}</div>)}
      {(b.state === "confirmed" || b.state === "unconfirmed") && (
        <div className="folds">
          <AddToCalendar code={b.calendarId} sport={b.sport} courts={b.courts.join(" + ")} date={b.date} startHour={b.startHour} endHour={b.endHour}
            details="NVBC court booking shared with you. Check the link you were sent for any changes." />
        </div>
      )}
      <p className="hint" style={{ margin: 0 }}>
        This page always shows the latest time and court. It&apos;s view-only: only the person who booked can change, cancel or pay for it.
      </p>
    </div>
  );
}
