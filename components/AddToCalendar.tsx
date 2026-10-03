"use client";

import { googleCalendarUrl, icsFile, type CalendarBooking } from "@/lib/calendar";
import { sportLabel } from "@/lib/sports";
import { Fold } from "./BookingSummary";

/** "Add to calendar": Google Calendar, or an .ics file for Apple Calendar / Outlook / most phones. */
export default function AddToCalendar({
  code,
  sport,
  courts,
  date,
  startHour,
  endHour,
}: {
  code: string;
  sport: string;
  courts: string;
  date: string;
  startHour: number;
  endHour: number;
}) {
  const page = typeof window === "undefined" ? "/my-booking" : `${window.location.origin}/my-booking`;
  const base = { code, title: `${sportLabel(sport)} at NVBC — ${courts}`, location: "NV Badminton Center", date, startHour, endHour };
  const ics: CalendarBooking = { ...base, details: `Booking code ${code}. Show your booking QR code at the front desk.\nView or change your booking: ${page}` };
  // The Google link is sent to Google: no booking code in it.
  const google: CalendarBooking = { ...base, details: `Show your booking QR code at the front desk.\nView or change your booking: ${page}` };

  function download() {
    const url = URL.createObjectURL(new Blob([icsFile(ics)], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `NVBC-${code}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Fold icon="📅" title="Add to calendar">
      <div className="cal-buttons">
        <a className="btn small secondary" href={googleCalendarUrl(google)} target="_blank" rel="noopener noreferrer">Google Calendar</a>
        <button type="button" className="btn small secondary" onClick={download}>Apple / Outlook (.ics)</button>
      </div>
      <p className="hint" style={{ margin: "8px 0 0" }}>Includes a reminder 1 hour before.</p>
    </Fold>
  );
}
