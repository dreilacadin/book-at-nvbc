// Describes what staff changed when editing a booking, for the booking history. Pure (no Node
// imports), so it can be tested.
import { formatRange } from "./format.ts";

export type BookingFields = {
  court: string; // court name
  date: string;
  startHour: number;
  endHour: number;
  name: string;
  contact: string;
  notes: string;
  rateType: string;
  hourlyRate: number;
  amount: number;
  paymentMethod: string;
  paymentRef: string;
};

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const day = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const methodLabel = (m: string) => ({ cash: "Cash", gcash: "GCash", qrph: "QR Ph", bpi: "BPI transfer" })[m] ?? m;
const quote = (s: string) => (s ? `“${s}”` : "(blank)");

/** One line per change, e.g. "Time: Mon, Oct 12, 6:00 PM – 7:00 PM → Tue, Oct 13, 6:00 PM – 7:30 PM". */
export function describeChanges(before: BookingFields, after: BookingFields): string[] {
  const out: string[] = [];
  if (before.court !== after.court) out.push(`Court: ${before.court} → ${after.court}`);
  const when = (b: BookingFields) => `${day(b.date)}, ${formatRange(b.startHour, b.endHour)}`;
  if (when(before) !== when(after)) out.push(`Time: ${when(before)} → ${when(after)}`);
  if (before.name !== after.name) out.push(`Name: ${quote(before.name)} → ${quote(after.name)}`);
  if (before.contact !== after.contact) out.push(`Contact: ${quote(before.contact)} → ${quote(after.contact)}`);
  if (before.notes !== after.notes) out.push(`Notes: ${quote(before.notes)} → ${quote(after.notes)}`);
  if (before.rateType !== after.rateType || before.hourlyRate !== after.hourlyRate)
    out.push(`Rate: ${cap(before.rateType)} ${peso(before.hourlyRate)}/hr → ${cap(after.rateType)} ${peso(after.hourlyRate)}/hr`);
  if (before.amount !== after.amount) out.push(`Amount: ${peso(before.amount)} → ${peso(after.amount)}`);
  if (before.paymentMethod !== after.paymentMethod)
    out.push(`Payment method: ${methodLabel(before.paymentMethod)} → ${methodLabel(after.paymentMethod)}`);
  if (before.paymentRef !== after.paymentRef) out.push(`Reference: ${quote(before.paymentRef)} → ${quote(after.paymentRef)}`);
  return out;
}
