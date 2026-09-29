import { NextRequest, NextResponse } from "next/server";
import { isAdmin, unauthorized } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { serverError } from "@/lib/http";
import { bookingStatusLabel, paymentLabel, paymentStatusLabel, rateTypeLabel } from "@/lib/pricing";
import { toCsv, toXlsx, type Cell } from "@/lib/spreadsheet";
import { isSport, sportLabel } from "@/lib/sports";
import { daysBetween, isValidDate } from "@/lib/time";

export const dynamic = "force-dynamic";

type Row = {
  code: string;
  date: string;
  start_hour: number;
  end_hour: number;
  court_name: string;
  sport: string;
  name: string;
  contact: string;
  notes: string;
  rate_type: string;
  hourly_rate: number;
  amount: number;
  payment_method: string;
  payment_status: string;
  payment_ref: string;
  has_proof: boolean;
  member_code: string | null;
  status: string;
  created_at: Date;
  cancelled_by: string | null;
};

const time = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`; // 10.5 → "10:30"
const dow = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { weekday: "short", timeZone: "UTC" });
const manila = (d: Date) =>
  d.toLocaleString("sv-SE", { timeZone: process.env.FACILITY_TIMEZONE || "Asia/Manila" }).slice(0, 16); // "YYYY-MM-DD HH:MM"
const round = (n: number) => Math.round(n * 100) / 100;

// Admin only: download bookings for a period as Excel (.xlsx) or CSV.
// ?from=YYYY-MM-DD&to=YYYY-MM-DD&format=xlsx|csv[&sport=badminton|pickleball]
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return unauthorized();
  const q = req.nextUrl.searchParams;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? from;
  const format = q.get("format") === "csv" ? "csv" : "xlsx";
  const sport = q.get("sport");
  if (!isValidDate(from) || !isValidDate(to) || to < from || daysBetween(from, to) > 366)
    return NextResponse.json({ error: "Choose a period of up to one year." }, { status: 400 });
  if (sport && !isSport(sport)) return NextResponse.json({ error: "Unknown sport." }, { status: 400 });

  try {
    const { rows } = await db().query<Row>(
      `SELECT b.cancel_code AS code, b.booking_date AS date, b.start_hour, b.end_hour, c.name AS court_name, c.sport,
              b.player_name AS name, b.contact, b.notes, b.rate_type, b.hourly_rate, b.amount, b.payment_method,
              b.payment_status, b.payment_ref, (b.payment_proof <> '') AS has_proof, b.status, b.created_at, b.cancelled_by,
              mb.member_code
         FROM bookings b JOIN courts c ON c.id = b.court_id
         LEFT JOIN memberships mb ON mb.id = b.membership_id
        WHERE b.booking_date BETWEEN $1 AND $2 AND ($3::text IS NULL OR c.sport = $3)
        ORDER BY b.booking_date, b.start_hour, c.sort_order, c.id`,
      [from, to, sport]
    );

    const header = [
      "Date", "Day", "Start", "End", "Hours", "Court", "Sport", "Name", "Contact", "Notes", "Rate", "Member code", "₱ per hour",
      "Amount", "Payment method", "Payment status", "Reference no.", "Screenshot", "Booking status", "Booking code",
      "Booked at", "Cancelled by",
    ];
    const bookingRows: Cell[][] = rows.map((b) => [
      b.date, dow(b.date), time(b.start_hour), time(b.end_hour), b.end_hour - b.start_hour, b.court_name,
      sportLabel(b.sport), b.name, b.contact === "(admin)" ? "" : b.contact, b.notes, rateTypeLabel(b.rate_type), b.member_code ?? "",
      b.hourly_rate, b.amount, paymentLabel(b.payment_method), paymentStatusLabel(b.payment_status), b.payment_ref,
      b.has_proof ? "Yes" : "", bookingStatusLabel(b.status), b.code, manila(new Date(b.created_at)), b.cancelled_by ?? "",
    ]);

    const period = from === to ? from : `${from}_to_${to}`;
    const filename = `nvbc-bookings-${sport ? sport + "-" : ""}${period}.${format}`;
    const headers = { "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" };

    if (format === "csv")
      return new NextResponse(toCsv([header, ...bookingRows]), {
        headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
      });

    // Summary sheet: totals, then one line per day. Cancelled bookings only count as "cancelled".
    const active = rows.filter((b) => b.status !== "cancelled");
    const sum = (list: Row[]) => round(list.reduce((s, b) => s + b.amount, 0));
    const billed = (list: Row[]) => sum(list.filter((b) => b.status !== "cancelled" && b.payment_status !== "waived"));
    const paid = (list: Row[]) => sum(list.filter((b) => b.payment_status === "paid"));
    const unpaid = (list: Row[]) => sum(list.filter((b) => b.status !== "cancelled" && b.payment_status === "unpaid"));
    const days = [...new Set(rows.map((b) => b.date))];
    const summary: Cell[][] = [
      ["NVBC bookings", from === to ? from : `${from} to ${to}`],
      ["Sport", sport ? sportLabel(sport) : "All sports"],
      [],
      ["Bookings", active.length],
      ["Billed", { money: billed(rows) }],
      ["Collected (paid)", { money: paid(rows) }],
      ["Still unpaid", { money: unpaid(rows) }],
      ["Payments to verify", active.filter((b) => b.payment_status === "for_verification").length],
      ["Cancelled", rows.length - active.length],
      [],
      ["Date", "Day", "Bookings", "Billed", "Collected", "Unpaid", "Cancelled"],
      ...days.map((d): Cell[] => {
        const list = rows.filter((b) => b.date === d);
        return [d, dow(d), list.filter((b) => b.status !== "cancelled").length, { money: billed(list) },
          { money: paid(list) }, { money: unpaid(list) }, list.filter((b) => b.status === "cancelled").length];
      }),
    ];

    const xlsx = toXlsx([
      { name: "Summary", rows: summary, freezeHeader: false, widths: [20, 22, 10, 12, 12, 12, 10] },
      {
        name: "Bookings",
        rows: [header, ...bookingRows],
        widths: [11, 6, 7, 7, 7, 20, 11, 22, 16, 24, 9, 16, 11, 11, 14, 15, 18, 11, 14, 12, 17, 12],
        moneyCols: [12, 13],
      },
    ]);
    return new NextResponse(new Uint8Array(xlsx), {
      headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    });
  } catch (e) {
    return serverError(e);
  }
}
