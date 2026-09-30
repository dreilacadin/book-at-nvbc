import { randomInt } from "node:crypto";
import { db, getSettings, type Settings } from "./db";
import {
  activeBookingStatus,
  computePrice,
  formatPeso,
  hasPaymentProof,
  isPaymentMethod,
  isProofImage,
  type ActiveStatus,
  type BookingStatus,
  isWeekend,
  rateFor,
  ratesForDate,
  rateTypesFor,
  rateTypeLabel,
  isPaymentStatus,
  isRateType,
  gcashAccounts,
  PAYMENT_METHODS,
  paymentLabel,
  type PaymentInfo,
  type PaymentMethod,
  type PaymentStatus,
  type RateType,
} from "./pricing";
import { blockedSlots, findBlockConflict } from "./blocks";
import { bookingPhase, minutesUntilStart, PAY_WINDOW_MINUTES, paymentDeadline, RELEASE_MINUTES, type Phase } from "./booking-policy";
import { formatDateLong, formatRange, isHalfHour, publicName, SLOT_HOURS } from "./format";
import { normalizeMemberCode } from "./membership";
import { blocksOn } from "./court-blocks";
import { notifyStaff } from "./notify";
import { notifyCustomer, scheduleReminders } from "./customer-notify";
import { isEmail } from "./customer-messages";
import { BOOKING_DEFAULT_SPORT, SPORTS, sportEmoji, sportLabel, type Sport } from "./sports";
import { addDays, daysBetween, isPastSlot, isValidDate, nowAtFacility } from "./time";

/** "🏸 Badminton Court 2 · Wed, Oct 1 · 9:00 AM – 10:00 AM" — for staff notifications. */
function bookingLine(b: { court_name: string; sport: string; booking_date: string; start_hour: number; end_hour: number }) {
  const day = new Date(b.booking_date + "T00:00:00Z").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${sportEmoji(b.sport)} ${b.court_name} · ${day} · ${formatRange(b.start_hour, b.end_hour)}`;
}

/** Court/time details of one booking, for a notification. */
async function bookingDetails(where: "id" | "cancel_code", value: string) {
  const { rows } = await db().query<{
    id: string; cancel_code: string; player_name: string; court_name: string; sport: string; booking_date: string;
    start_hour: number; end_hour: number; amount: number; payment_method: PaymentMethod; payment_ref: string;
  }>(
    `SELECT b.id, b.cancel_code, b.player_name, c.name AS court_name, c.sport, b.booking_date, b.start_hour, b.end_hour,
            b.amount, b.payment_method, b.payment_ref
       FROM bookings b JOIN courts c ON c.id = b.court_id WHERE b.${where} = $1`,
    [value]
  );
  return rows[0] ?? null;
}

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string) => ({ ok: false as const, status, error });

// No 0/O/1/I/L so codes are easy to read out loud or type.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newCancelCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `NV-${s}`;
}

export function normalizeCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = c.startsWith("NV") ? c.slice(2) : c;
  return /^[A-Z0-9]{6}$/.test(body) ? `NV-${body}` : null;
}

/**
 * Releases unpaid bookings (see shouldRelease): pending or reserved bookings within
 * RELEASE_MINUTES of their start, and online bookings whose 15-minute payment window (pay_by) ran
 * out. They are cancelled by "system" and their slots open up. Runs whenever bookings are looked
 * at or made (at most every 10 seconds per server), so no scheduled job is needed.
 */
let lastRelease = 0;
export async function releaseUnpaidBookings(): Promise<number> {
  scheduleReminders(); // "coming up" reminders for customers (throttled, after the response)
  if (Date.now() - lastRelease < 10_000) return 0;
  lastRelease = Date.now();
  const now = nowAtFacility();
  const { rows } = await db().query<{
    id: string; cancel_code: string; player_name: string; court_name: string; sport: string;
    booking_date: string; start_hour: number; end_hour: number;
  }>(
    `WITH rel AS (
       UPDATE bookings b SET status = 'cancelled', cancelled_by = 'system', cancelled_at = now()
         FROM courts c
        WHERE c.id = b.court_id
          AND b.status IN ('pending', 'reserved') AND b.payment_status IN ('unpaid', 'rejected') AND b.amount > 0
          AND b.phase IS NULL AND b.auto_release -- marked in progress/completed or restored by staff: keep
          AND ((b.booking_date - $1::date) * 1440 + (b.start_hour - $2::numeric) * 60 <= $3
               OR b.pay_by <= now())
        RETURNING b.id, b.cancel_code, b.player_name, c.name AS court_name, c.sport, b.booking_date, b.start_hour, b.end_hour
     ), freed AS (
       DELETE FROM booking_slots WHERE booking_id IN (SELECT id FROM rel)
     )
     SELECT * FROM rel`,
    [now.date, now.time, RELEASE_MINUTES]
  );
  await notifyStaff(
    rows.map((r) => ({
      kind: "booking_gone" as const,
      title: `Released — ${r.player_name} (not paid in time)`,
      pushTitle: `Released — ${publicName(r.player_name)} (not paid in time)`,
      body: bookingLine(r),
      bookingCode: r.cancel_code,
    }))
  );
  return rows.length;
}

/**
 * Public, anonymous availability for one date and sport: bookers show as first name + last
 * initial only. If no sport is given, the booking page's default sport (or the first with courts).
 */
export async function getAvailability(date: string, requestedSport?: Sport) {
  await releaseUnpaidBookings();
  const settings = await getSettings();
  const today = nowAtFacility();
  const [allCourts, taken, blocks] = await Promise.all([
    db().query<{ id: number; name: string; sport: Sport; notes: string }>(
      `SELECT id, name, sport, notes FROM courts WHERE is_active ORDER BY sort_order, id`
    ),
    db().query<{ court_id: number; start_hour: number; end_hour: number; player_name: string; status: BookingStatus }>(
      `SELECT court_id, start_hour, end_hour, player_name, status FROM bookings
        WHERE booking_date = $1 AND status <> 'cancelled' ORDER BY court_id, start_hour`,
      [date]
    ),
    blocksOn(date),
  ]);
  // Booking page tabs: the default sport first, then the rest in their usual order.
  const sports = [...SPORTS]
    .sort((a, b) => Number(b.id === BOOKING_DEFAULT_SPORT) - Number(a.id === BOOKING_DEFAULT_SPORT))
    .map((s) => ({
      ...s,
      courtCount: allCourts.rows.filter((c) => c.sport === s.id).length,
    }));
  // Without ?sport=, open the default sport — or, if it has no courts, the first sport that does.
  const sport: Sport =
    requestedSport ?? sports.find((s) => s.courtCount > 0)?.id ?? BOOKING_DEFAULT_SPORT;
  const courts = allCourts.rows
    .filter((c) => c.sport === sport)
    .map(({ id, name, notes }) => ({ id, name, notes }));
  const courtIds = new Set(courts.map((c) => c.id));
  return {
    sport,
    sports,
    date,
    today: today.date,
    currentHour: today.time, // e.g. 10.75 at 10:45 — slots starting at or before this are past
    openHour: settings.open_hour,
    closeHour: settings.close_hour,
    maxHoursPerBooking: settings.max_hours_per_booking,
    bookingWindowDays: settings.booking_window_days,
    lastBookableDate: addDays(today.date, settings.booking_window_days),
    announcement: settings.announcement,
    // Public pricing info. The member/coach codes themselves are never sent.
    pricing: {
      rates: ratesForDate(settings.rate_plans[sport], date),
      rateTypes: rateTypesFor(settings.rate_plans[sport]),
      weekend: settings.rate_plans[sport].weekendRates && isWeekend(date),
      memberCodeRequired: true, // the member rate needs an active member code (NVBC-XXXX-XXXX)
      coachCodeRequired: settings.coach_code.trim() !== "",
    },
    // GCash / QR Ph / bank transfer for everyone; cash only with the coach rate and coach code.
    paymentMethods: enabledMethods(settings),
    cashForCoaches: cashAllowedForCoaches(settings),
    courts,
    // Booked times, shown with the booker's first name and last initial only ("Ana C.").
    bookings: taken.rows
      .filter((r) => courtIds.has(r.court_id))
      .map((r) => ({
        courtId: r.court_id,
        start: r.start_hour,
        end: r.end_hour,
        name: publicName(r.player_name),
        status: r.status as "pending" | "reserved" | "confirmed",
      })),
    // Reserved times (Open Play, Queueing, …) with their label, so players see why.
    blocked: [...blockedSlots(blocks, date)]
      .map(([key, label]) => {
        const [courtId, hour] = key.split(":").map(Number);
        return { courtId, hour, label };
      })
      .filter((b) => courtIds.has(b.courtId)),
  };
}

/**
 * Payment methods players can actually use: switched on in /admin AND with their details
 * filled in (a GCash method with no GCash number would just confuse people).
 * Kept in the standard order: Cash, GCash, QR Ph, BPI.
 */
export function enabledMethods(s: Settings): PaymentMethod[] {
  const on = s.payment_methods ?? [];
  const ready: Record<PaymentMethod, boolean> = {
    cash: true,
    gcash: gcashAccounts(s).length > 0,
    qrph: s.qrph_image !== "",
    bpi: s.bpi_account_number.trim() !== "",
  };
  const list = PAYMENT_METHODS.map((m) => m.id).filter((id) => on.includes(id) && ready[id]);
  return list.length ? list : ["cash"];
}

/**
 * Cash (paid at the desk) is only for coaches: it needs the coach rate AND the coach code, so a
 * coach code must be set in /admin and cash switched on. Everyone else pays online.
 */
export function cashAllowedForCoaches(s: Settings): boolean {
  return enabledMethods(s).includes("cash") && s.coach_code.trim() !== "";
}

/** Payment instructions players see after booking. */
export async function getPaymentInfo(): Promise<PaymentInfo> {
  const s = await getSettings();
  return {
    methods: enabledMethods(s),
    gcashAccounts: gcashAccounts(s),
    bpiAccountName: s.bpi_account_name,
    bpiAccountNumber: s.bpi_account_number,
    qrphImage: s.qrph_image,
    note: s.payment_note,
  };
}

const sameCode = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export function cleanRef(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 60) : "";
}

/**
 * Checks a member code for a member-rate booking on `date`: the membership must be approved and
 * not expired by then. Returns the membership, or a message for the player.
 */
export async function verifyMemberCode(raw: unknown, date: string): Promise<{ id: string; fullName: string } | string> {
  const code = normalizeMemberCode(raw);
  if (!code) return "Enter your member code — it looks like NVBC-XXXX-XXXX and is on your member QR card.";
  const { rows } = await db().query<{ id: string; full_name: string; status: string; expires_on: string | null }>(
    `SELECT id, full_name, status, expires_on FROM memberships WHERE member_code = $1`,
    [code]
  );
  const m = rows[0];
  if (!m || m.status === "rejected") return `We couldn't find member code ${code}. Check it, or book at the Regular rate.`;
  if (m.status === "forfeited") return "That membership has ended. Ask the front desk to reactivate it, or book at the Regular rate.";
  if (m.status !== "active" || !m.expires_on) return "That membership hasn't been approved yet. Book at the Regular rate for now.";
  const today = nowAtFacility().date;
  if (today >= m.expires_on)
    return `That membership expired on ${formatDateLong(m.expires_on)}. Renew it at the front desk, or book at the Regular rate.`;
  if (date >= m.expires_on)
    return `That membership expires on ${formatDateLong(m.expires_on)}, before this booking. Renew it at the front desk, or book at the Regular rate.`;
  return { id: m.id, fullName: m.full_name };
}

export type NewBookingInput = {
  rateType?: unknown; // regular | member | coach
  rateCode?: unknown; // member rate: the player's member code; coach rate: the coach code, if set
  paymentMethod?: unknown; // cash | gcash | qrph | bpi
  paymentRef?: unknown; // reference number, if already paid by e-wallet/bank
  paymentProof?: unknown; // screenshot of the receipt (image data: URL)
  paymentStatus?: unknown; // staff only
  noCharge?: unknown; // staff only: tournaments, maintenance blocks
  courtId?: unknown;
  date?: unknown;
  startHour?: unknown;
  hours?: unknown;
  name?: unknown;
  contact?: unknown;
  notes?: unknown;
  email?: unknown; // optional: for booking updates by email
  website?: unknown; // honeypot — real people never fill this in
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function createBooking(
  input: NewBookingInput,
  opts: { admin?: boolean } = {}
): Promise<
  Result<{
    code: string;
    courtName: string;
    sport: Sport;
    date: string;
    startHour: number;
    endHour: number;
    rateType: RateType;
    hourlyRate: number;
    regularRate: number;
    savings: number;
    amount: number;
    paymentMethod: PaymentMethod;
    paymentStatus: PaymentStatus;
    paymentRef: string;
    hasProof: boolean;
    status: ActiveStatus;
    payBy: string | null; // online bookings: pay (send reference/screenshot) by this time, or the slot is released
  }>
> {
  const admin = !!opts.admin;
  if (!admin && str(input.website)) return fail(400, "Booking could not be completed.");
  await releaseUnpaidBookings();

  const courtId = Number(input.courtId);
  const startHour = Number(input.startHour);
  const hours = Number(input.hours);
  const date = input.date;
  const name = str(input.name).replace(/\s+/g, " ");
  const contact = str(input.contact);
  const notes = str(input.notes);
  const email = str(input.email);

  if (!Number.isInteger(courtId)) return fail(400, "Please choose a court.");
  if (!isValidDate(date)) return fail(400, "Please choose a valid date.");
  if (!isHalfHour(startHour) || !Number.isInteger(hours * 2) || hours < SLOT_HOURS)
    return fail(400, "Please choose a valid time.");
  if (name.length < 2 || name.length > 60) return fail(400, "Please enter your name (2–60 characters).");
  if (!admin && (contact.length < 7 || contact.length > 60 || !/[0-9@]/.test(contact)))
    return fail(400, "Please enter a mobile number or email so we can reach you.");
  if (notes.length > 200) return fail(400, "Notes must be 200 characters or fewer.");
  if (email && !isEmail(email)) return fail(400, "Please check your email address (or leave it blank).");

  let rateType: RateType = input.rateType === undefined || input.rateType === "" ? "regular" : (input.rateType as RateType);
  if (!isRateType(rateType)) return fail(400, "Please choose Regular, Member or Coach.");
  const paymentMethod: PaymentMethod =
    input.paymentMethod === undefined || input.paymentMethod === "" ? "cash" : (input.paymentMethod as PaymentMethod);
  if (!isPaymentMethod(paymentMethod)) return fail(400, "Please choose a payment method.");
  const paymentRef = cleanRef(input.paymentRef);
  const paymentProof = input.paymentProof === undefined || input.paymentProof === "" ? "" : input.paymentProof;
  if (paymentProof !== "" && !isProofImage(paymentProof))
    return fail(400, "The payment screenshot must be a PNG, JPG or WebP image under 700 KB.");

  const settings = await getSettings();

  if (!admin) {
    if (!enabledMethods(settings).includes(paymentMethod))
      return fail(400, "That payment method isn't available right now. Please choose another.");
    // The coach rate can be protected with a shared code set by staff in /admin.
    if (rateType === "coach" && settings.coach_code.trim() && !sameCode(str(input.rateCode), settings.coach_code))
      return fail(400, "That coach code isn't right. Choose Regular, or ask the front desk for the coach code.");
    // Cash at the desk is only for coaches (coach rate + coach code); everyone else pays online.
    if (paymentMethod === "cash" && !(rateType === "coach" && cashAllowedForCoaches(settings)))
      return fail(400, "Cash payment is reserved for coaches. Please pay by GCash, QR Ph or bank transfer.");
  }

  // Is this rate offered for the court's sport? Checked first, so a switched-off Member rate
  // says so instead of asking for a member code. (Re-checked in the transaction below.)
  if (!admin && rateType !== "regular") {
    const c = await db().query<{ sport: Sport }>(`SELECT sport FROM courts WHERE id = $1`, [courtId]);
    const plan = c.rows[0] && settings.rate_plans[c.rows[0].sport];
    if (plan && !rateTypesFor(plan).includes(rateType))
      return fail(
        400,
        rateTypesFor(plan).length === 1
          ? `${sportLabel(c.rows[0].sport)} has one standard rate. Please book at the standard rate.`
          : `The ${rateTypeLabel(rateType).toLowerCase()} rate isn't offered for ${sportLabel(c.rows[0].sport)}. Please choose another rate.`
      );
  }

  // The member rate needs the player's own member code, active on the booking date.
  // Staff bookings don't (they check membership at the desk) but may still link one.
  let membershipId: string | null = null;
  if (rateType === "member" && (!admin || str(input.rateCode))) {
    const member = await verifyMemberCode(input.rateCode, date);
    if (typeof member === "string") return fail(400, member);
    membershipId = member.id;
  }

  const noCharge = admin && input.noCharge === true;

  const endHour = startHour + hours;
  const today = nowAtFacility().date;

  if (startHour < 0 || endHour > 24) return fail(400, "Please choose a valid time.");
  if (!admin) {
    // Admins can block any time (tournaments, maintenance); players follow the rules.
    if (date < today) return fail(400, "That date has already passed.");
    if (daysBetween(today, date) > settings.booking_window_days)
      return fail(400, `Bookings open up to ${settings.booking_window_days} days in advance.`);
    if (hours > settings.max_hours_per_booking)
      return fail(400, `You can book up to ${settings.max_hours_per_booking} hour(s) at a time.`);
    if (startHour < settings.open_hour || endHour > settings.close_hour)
      return fail(400, "That time is outside opening hours.");
    if (isPastSlot(date, startHour)) return fail(400, "That time slot has already started.");
    // Unpaid bookings are released RELEASE_MINUTES before the start, so there'd be no time to pay.
    if (minutesUntilStart(date, startHour, nowAtFacility()) <= RELEASE_MINUTES)
      return fail(400, `This slot starts in less than ${RELEASE_MINUTES} minutes — please book it at the front desk.`);
  }

  const client = await db().connect();
  try {
    await client.query("BEGIN");

    const court = await client.query<{ name: string; sport: Sport }>(
      `SELECT name, sport FROM courts WHERE id = $1 AND (is_active OR $2)`,
      [courtId, admin]
    );
    if (!court.rows[0]) {
      await client.query("ROLLBACK");
      return fail(400, "That court is not available for booking.");
    }

    const sport = court.rows[0].sport;
    if (!admin) {
      // Staff may book over reserved times (e.g. to sell a slot); players may not.
      const block = findBlockConflict(await blocksOn(date), courtId, date, startHour, endHour);
      if (block) {
        await client.query("ROLLBACK");
        return fail(409, `That time is reserved for ${block.label}. Please pick another time or court.`);
      }
    }
    const plan = settings.rate_plans[sport];
    if (!rateTypesFor(plan).includes(rateType)) {
      if (!admin) {
        await client.query("ROLLBACK");
        return fail(
          400,
          rateTypesFor(plan).length === 1
            ? `${sportLabel(sport)} has one standard rate. Please book at the standard rate.`
            : `The ${rateTypeLabel(rateType).toLowerCase()} rate isn't offered for ${sportLabel(sport)}. Please choose another rate.`
        );
      }
      rateType = "regular"; // staff picked member/coach for a sport without them: charge the standard rate
    }
    const rates = ratesForDate(plan, date);
    const price = noCharge ? computePrice(0, hours) : computePrice(rateFor(rates, rateType), hours, rates.regular);
    // Payment proof (reference number and/or screenshot) may come with the booking, or within the
    // payment window afterwards.
    const proven = paymentMethod !== "cash" && hasPaymentProof(paymentRef, paymentProof);
    let paymentStatus: PaymentStatus = proven ? "for_verification" : "unpaid";
    if (noCharge) paymentStatus = "waived";
    else if (admin && isPaymentStatus(input.paymentStatus)) paymentStatus = input.paymentStatus;
    const status = activeBookingStatus(paymentMethod, paymentStatus, price.total);
    // Online bookings get PAY_WINDOW_MINUTES (at most until 10 minutes before the start) to pay,
    // like an airline booking; after that the slot is released.
    const payBy =
      !admin && paymentMethod !== "cash" && paymentStatus === "unpaid" && price.total > 0
        ? new Date(paymentDeadline(Date.now(), date, startHour, nowAtFacility())).toISOString()
        : null;

    // Fair-use limit per person per day (matched on their contact number/email).
    const used = await client.query<{ total: number }>(
      `SELECT COALESCE(SUM(end_hour - start_hour), 0)::float8 AS total
         FROM bookings
        WHERE status <> 'cancelled' AND booking_date = $1
          AND lower(regexp_replace(contact, '[^a-zA-Z0-9@.]', '', 'g'))
            = lower(regexp_replace($2,      '[^a-zA-Z0-9@.]', '', 'g'))`,
      [date, contact]
    );
    if (!admin && used.rows[0].total + hours > settings.max_hours_per_day) {
      await client.query("ROLLBACK");
      return fail(
        400,
        `Each player can book up to ${settings.max_hours_per_day} hour(s) per day. ` +
          `You already have ${used.rows[0].total} hour(s) on this date.`
      );
    }

    // Retry on the (very unlikely) chance of a duplicate cancel code.
    let code = "";
    let bookingId = "";
    for (let attempt = 0; attempt < 5 && !bookingId; attempt++) {
      code = newCancelCode();
      await client.query("SAVEPOINT ins");
      try {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO bookings (court_id, booking_date, start_hour, end_hour, player_name, contact, notes, cancel_code,
                                 rate_type, hourly_rate, discount_pct, amount, payment_method, payment_status,
                                 payment_ref, paid_at, status, payment_proof, membership_id, pay_by, payment_sent_at, customer_email)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                   CASE WHEN $14 = 'paid' THEN now() END, $16, $17, $18, $19,
                   CASE WHEN $15 <> '' OR $17 <> '' THEN now() END, $20) RETURNING id`,
          [
            courtId, date, startHour, endHour, name, contact || "(admin)", notes, code,
            rateType, price.hourlyRate, 0, price.total, paymentMethod, paymentStatus, paymentRef, status,
            paymentMethod === "cash" ? "" : paymentProof,
            rateType === "member" ? membershipId : null,
            payBy,
            email,
          ]
        );
        bookingId = ins.rows[0].id;
      } catch (e: unknown) {
        if ((e as { code?: string }).code === "23505") {
          await client.query("ROLLBACK TO SAVEPOINT ins");
          continue;
        }
        throw e;
      }
    }
    if (!bookingId) throw new Error("Could not generate a unique booking code");

    // Claim every half-hour slot. The primary key on booking_slots rejects any overlap.
    await client.query(
      `INSERT INTO booking_slots (court_id, slot_date, slot_hour, booking_id)
       SELECT $1, $2, h, $3 FROM generate_series($4::numeric, $5::numeric - 0.5, 0.5) AS h`,
      [courtId, date, bookingId, startHour, endHour]
    );

    await client.query("COMMIT");
    if (!admin) {
      const paying =
        paymentStatus === "for_verification" ? `${paymentLabel(paymentMethod)} payment sent — please verify`
        : paymentMethod === "cash" ? "Coach · cash at the desk"
        : price.total > 0 ? `${paymentLabel(paymentMethod)} · paying within ${PAY_WINDOW_MINUTES} min` : "No charge";
      await notifyStaff([{
        kind: "booking_new",
        title: `New booking — ${name}`,
        pushTitle: `New booking — ${publicName(name)}`,
        body: `${bookingLine({ court_name: court.rows[0].name, sport, booking_date: date, start_hour: startHour, end_hour: endHour })} · ${formatPeso(price.total)} · ${paying}`,
        bookingCode: code,
      }]);
    }
    return {
      ok: true,
      data: {
        code, courtName: court.rows[0].name, sport, date, startHour, endHour,
        rateType, hourlyRate: price.hourlyRate, regularRate: price.regularRate, savings: price.savings, amount: price.total,
        paymentMethod, paymentStatus, paymentRef, hasProof: paymentMethod !== "cash" && paymentProof !== "", status, payBy,
      },
    };
  } catch (e: unknown) {
    await client.query("ROLLBACK").catch(() => {});
    if ((e as { code?: string }).code === "23505") {
      return fail(409, "Sorry — someone just booked that slot. Please pick another time.");
    }
    throw e;
  } finally {
    client.release();
  }
}

export type BookingView = {
  code: string;
  courtName: string;
  sport: Sport;
  date: string;
  startHour: number;
  endHour: number;
  name: string;
  status: BookingStatus;
  rateType: RateType;
  hourlyRate: number;
  discountPct: number;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentRef: string;
  hasProof: boolean; // a payment screenshot was uploaded
  canCancel: boolean;
  cancelledBy: string | null; // "system" = released automatically (not paid in time)
  payBy: string | null; // online booking: pay by this time (ISO) or it's released
  courtNotes: string;
  phase: Phase | null; // in progress / completed (by the clock for paid bookings, or set by staff)
  rejectedNote: string; // payment rejected by staff: why (empty otherwise)
};

/** Look up a booking by its code. Only the person holding the code sees the name. */
export async function findByCode(rawCode: unknown): Promise<Result<BookingView>> {
  const code = normalizeCode(rawCode);
  if (!code) return fail(400, "Booking codes look like NV-ABC123.");
  await releaseUnpaidBookings();
  const { rows } = await db().query(
    `SELECT b.cancel_code, c.name AS court_name, c.sport, b.booking_date, b.start_hour, b.end_hour,
            b.player_name, b.status, b.rate_type, b.hourly_rate, b.discount_pct, b.amount,
            b.payment_method, b.payment_status, b.payment_ref, (b.payment_proof <> '') AS has_proof, b.cancelled_by,
            b.pay_by, c.notes AS court_notes, b.phase, b.rejected_note
       FROM bookings b JOIN courts c ON c.id = b.court_id
      WHERE b.cancel_code = $1`,
    [code]
  );
  const r = rows[0];
  if (!r) return fail(404, "No booking found with that code.");
  return {
    ok: true,
    data: {
      code: r.cancel_code,
      courtName: r.court_name,
      sport: r.sport,
      date: r.booking_date,
      startHour: r.start_hour,
      endHour: r.end_hour,
      name: r.player_name,
      status: r.status,
      rateType: r.rate_type,
      hourlyRate: r.hourly_rate,
      discountPct: r.discount_pct,
      amount: r.amount,
      paymentMethod: r.payment_method,
      paymentStatus: r.payment_status,
      paymentRef: r.payment_ref,
      hasProof: r.has_proof,
      canCancel: r.status !== "cancelled" && !isPastSlot(r.booking_date, r.start_hour),
      cancelledBy: r.cancelled_by,
      payBy: r.pay_by && (r.payment_status === "unpaid" || r.payment_status === "rejected") && r.status === "pending"
        ? new Date(r.pay_by).toISOString() : null,
      rejectedNote: r.payment_status === "rejected" ? r.rejected_note : "",
      courtNotes: r.court_notes,
      phase: bookingPhase(
        { status: r.status, phase: r.phase, payment_status: r.payment_status, amount: r.amount, date: r.booking_date, start_hour: r.start_hour, end_hour: r.end_hour },
        nowAtFacility()
      ),
    },
  };
}

async function cancelWhere(whereSql: string, param: string, by: string, allowStarted: boolean) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, booking_date, start_hour, status FROM bookings WHERE ${whereSql} FOR UPDATE`,
      [param]
    );
    const b = rows[0];
    if (!b) {
      await client.query("ROLLBACK");
      return fail(404, "Booking not found.");
    }
    if (b.status === "cancelled") {
      await client.query("ROLLBACK");
      return fail(400, "This booking is already cancelled.");
    }
    if (!allowStarted && isPastSlot(b.booking_date, b.start_hour)) {
      await client.query("ROLLBACK");
      return fail(400, "This booking has already started and can no longer be cancelled online.");
    }
    await client.query(`DELETE FROM booking_slots WHERE booking_id = $1`, [b.id]);
    await client.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_by = $2, cancelled_at = now() WHERE id = $1`,
      [b.id, by]
    );
    await client.query("COMMIT");
    return { ok: true as const, data: { id: b.id as string } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelByCode(rawCode: unknown): Promise<Result<{ id: string }>> {
  const code = normalizeCode(rawCode);
  if (!code) return fail(400, "Booking codes look like NV-ABC123.");
  const r = await cancelWhere("cancel_code = $1", code, "player", false);
  if (r.ok) {
    const b = await bookingDetails("cancel_code", code);
    if (b)
      await notifyStaff([{
        kind: "booking_gone",
        title: `Cancelled by player — ${b.player_name}`,
        pushTitle: `Cancelled by player — ${publicName(b.player_name)}`,
        body: bookingLine(b),
        bookingCode: b.cancel_code,
      }]);
  }
  return r;
}

/** Staff cancel. `by` is recorded on the booking (the staff member's name). */
export async function cancelById(id: string, by = "admin"): Promise<Result<{ id: string }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  return cancelWhere("id = $1", id, by.slice(0, 60) || "admin", true);
}

/**
 * Player tells us they paid by GCash / QR Ph / BPI: store the reference number and/or receipt
 * screenshot for staff to verify. Sending only one keeps the other from an earlier submission.
 */
export async function submitPayment(
  rawCode: unknown,
  method: unknown,
  ref: unknown,
  proof?: unknown
): Promise<Result<{ paymentStatus: PaymentStatus; paymentMethod: PaymentMethod; paymentRef: string; hasProof: boolean }>> {
  const code = normalizeCode(rawCode);
  if (!code) return fail(400, "Booking codes look like NV-ABC123.");
  if (!isPaymentMethod(method) || method === "cash") return fail(400, "Choose GCash, QR Ph or BPI transfer.");
  const paymentRef = cleanRef(ref);
  const paymentProof = proof === undefined || proof === null || proof === "" ? "" : proof;
  if (paymentProof !== "" && !isProofImage(paymentProof))
    return fail(400, "The payment screenshot must be a PNG, JPG or WebP image under 700 KB.");
  if (!hasPaymentProof(paymentRef, paymentProof))
    return fail(400, "Enter the reference number or upload a screenshot of your payment receipt.");
  if (paymentRef && !/^[A-Za-z0-9][A-Za-z0-9 \-]{3,}$/.test(paymentRef))
    return fail(400, "Please enter the reference number from your payment receipt.");
  const settings = await getSettings();
  if (!enabledMethods(settings).includes(method))
    return fail(400, "That payment method isn't available right now.");
  await releaseUnpaidBookings();

  // Accepted while the booking is active and, for a first payment, within its payment window.
  const { rows } = await db().query<{ payment_ref: string; has_proof: boolean }>(
    `UPDATE bookings SET payment_method = $2,
            payment_ref   = CASE WHEN $3 = '' THEN payment_ref ELSE $3 END,
            payment_proof = CASE WHEN $4 = '' THEN payment_proof ELSE $4 END,
            payment_status = 'for_verification',
            payment_sent_at = now(),
            status = CASE WHEN amount > 0 THEN 'pending' ELSE status END -- held until staff verify
      WHERE cancel_code = $1 AND status <> 'cancelled' AND payment_status IN ('unpaid', 'for_verification', 'rejected')
        AND (pay_by IS NULL OR pay_by > now() OR payment_status = 'for_verification')
      RETURNING payment_ref, (payment_proof <> '') AS has_proof`,
    [code, method, paymentRef, paymentProof]
  );
  if (!rows[0]) {
    const b = await findByCode(code);
    if (!b.ok) return b;
    const windowOver = b.data.payBy !== null && Date.parse(b.data.payBy) <= Date.now();
    if (windowOver || (b.data.status === "cancelled" && b.data.cancelledBy === "system"))
      return fail(
        400,
        "The time to pay for this booking has ended, so the slot was released for other players. " +
          "You're welcome to book again. If you already sent a payment, please contact the front desk."
      );
    if (b.data.status === "cancelled") return fail(400, "This booking was cancelled.");
    return fail(400, `This booking is already marked "${b.data.paymentStatus === "paid" ? "paid" : b.data.paymentStatus}".`);
  }
  const b = await bookingDetails("cancel_code", code);
  if (b)
    await notifyStaff([{
      kind: "payment_sent",
      title: `Payment sent — ${b.player_name}`,
      pushTitle: `Payment sent — ${publicName(b.player_name)}`,
      body: `${paymentLabel(method)}${rows[0].payment_ref ? ` ref ${rows[0].payment_ref}` : ""}${rows[0].has_proof ? " · screenshot" : ""} · ${formatPeso(b.amount)} · ${bookingLine(b)} — please verify`,
      bookingCode: b.cancel_code,
    }]);
  return {
    ok: true,
    data: { paymentStatus: "for_verification", paymentMethod: method, paymentRef: rows[0].payment_ref, hasProof: rows[0].has_proof },
  };
}

/**
 * Staff: mark a booking paid / unpaid / no charge / refunded (optionally correcting method or
 * reference), or reject its payment with a note. The customer is told when their payment is
 * confirmed or rejected.
 */
export async function setPaymentStatus(
  id: string,
  status: unknown,
  method?: unknown,
  ref?: unknown,
  note?: unknown,
  by = "admin"
): Promise<Result<{ id: string; status: BookingStatus }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  if (!isPaymentStatus(status)) return fail(400, "Unknown payment status.");
  if (status === "rejected") return rejectPayment(id, note, by);
  if (method !== undefined && !isPaymentMethod(method)) return fail(400, "Unknown payment method.");
  const { rows } = await db().query(
    `UPDATE bookings SET
        payment_status = $2,
        payment_method = COALESCE($3, payment_method),
        payment_ref    = COALESCE($4, payment_ref),
        paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, now()) ELSE NULL END,
        pay_by = NULL, -- staff handle the payment from here: no online payment window
        -- Status follows the payment (see activeBookingStatus); cancelled stays cancelled.
        status = CASE
          WHEN status = 'cancelled' THEN status
          WHEN amount > 0 AND $2 NOT IN ('paid', 'waived')
            THEN CASE WHEN COALESCE($3, payment_method) = 'cash' THEN 'reserved' ELSE 'pending' END
          ELSE 'confirmed' END
       FROM (SELECT id AS old_id, payment_status AS old_status FROM bookings WHERE id = $1 FOR UPDATE) old -- the value before this change
      WHERE id = old.old_id RETURNING id, status, old.old_status`,
    [id, status, method ?? null, ref === undefined ? null : cleanRef(ref)]
  );
  if (!rows[0]) return fail(404, "Booking not found.");
  const settled = (s: string) => s === "paid" || s === "waived";
  if (rows[0].status === "confirmed" && settled(status) && !settled(rows[0].old_status)) notifyCustomer(id, "confirmed");
  return { ok: true, data: { id, status: rows[0].status as BookingStatus } };
}

/**
 * Staff couldn't verify an online payment. The booking stays pending with a fresh payment window
 * (PAY_WINDOW_MINUTES, or until RELEASE_MINUTES before the start) for the customer to send a
 * correct payment or screenshot; otherwise it's released as usual. The note tells them why.
 */
async function rejectPayment(id: string, rawNote: unknown, by: string): Promise<Result<{ id: string; status: BookingStatus }>> {
  const note = typeof rawNote === "string" ? rawNote.trim().replace(/\s+/g, " ") : "";
  if (note.length < 3) return fail(400, "Add a short note for the customer saying why the payment was rejected.");
  if (note.length > 300) return fail(400, "Keep the note under 300 characters.");
  const { rows: found } = await db().query<{
    status: string; payment_status: string; payment_method: string; amount: number; booking_date: string; start_hour: number;
  }>(
    `SELECT status, payment_status, payment_method, amount, booking_date, start_hour FROM bookings WHERE id = $1`,
    [id]
  );
  const b = found[0];
  if (!b) return fail(404, "Booking not found.");
  if (b.status === "cancelled") return fail(400, "This booking is cancelled.");
  if (b.payment_method === "cash") return fail(400, "Cash payments can't be rejected — set the payment to Unpaid instead.");
  if (Number(b.amount) <= 0) return fail(400, "This booking has nothing to pay.");
  if (b.payment_status !== "for_verification") return fail(400, "Only a payment waiting to be verified can be rejected.");
  const payBy = new Date(paymentDeadline(Date.now(), b.booking_date, Number(b.start_hour), nowAtFacility())).toISOString();
  await db().query(
    `UPDATE bookings SET payment_status = 'rejected', status = 'pending', paid_at = NULL, pay_by = $2,
            rejected_note = $3, rejected_by = $4, rejected_at = now()
      WHERE id = $1`,
    [id, payBy, note, by.slice(0, 60) || "admin"]
  );
  notifyCustomer(id, "rejected");
  return { ok: true, data: { id, status: "pending" } };
}

export type BookingEdit = {
  courtId?: unknown;
  date?: unknown;
  startHour?: unknown;
  endHour?: unknown;
  name?: unknown;
  contact?: unknown;
  notes?: unknown;
  rateType?: unknown;
  hourlyRate?: unknown; // ₱ per hour; the amount becomes hourlyRate × hours
  paymentMethod?: unknown;
  paymentRef?: unknown;
};

/**
 * Staff: change a booking's court, date, time, player details, rate or payment method.
 * Moving it re-claims the hours in one transaction, so it can never overlap another booking.
 * Staff edits ignore player limits (opening hours, booking window), like staff bookings do.
 */
export async function updateBooking(id: string, input: BookingEdit): Promise<Result<{ id: string; status: BookingStatus }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  const courtId = Number(input.courtId);
  const startHour = Number(input.startHour);
  const endHour = Number(input.endHour);
  const date = input.date;
  const name = str(input.name).replace(/\s+/g, " ");
  const contact = str(input.contact);
  const notes = str(input.notes);
  const hourlyRate = Number(input.hourlyRate);
  const paymentRef = cleanRef(input.paymentRef);

  if (!Number.isInteger(courtId)) return fail(400, "Please choose a court.");
  if (!isValidDate(date)) return fail(400, "Please choose a valid date.");
  if (!isHalfHour(startHour) || !isHalfHour(endHour) || endHour <= startHour)
    return fail(400, "The end time must be after the start time.");
  if (name.length < 2 || name.length > 60) return fail(400, "Name must be 2–60 characters.");
  if (contact.length > 60) return fail(400, "Contact must be 60 characters or fewer.");
  if (notes.length > 200) return fail(400, "Notes must be 200 characters or fewer.");
  if (!isRateType(input.rateType)) return fail(400, "Choose Regular, Member or Coach.");
  if (!Number.isFinite(hourlyRate) || hourlyRate < 0 || hourlyRate > 100_000) return fail(400, "Enter a valid hourly rate.");
  if (!isPaymentMethod(input.paymentMethod)) return fail(400, "Choose a payment method.");
  const rateType = input.rateType;
  const paymentMethod = input.paymentMethod;
  const price = computePrice(Math.round(hourlyRate * 100) / 100, endHour - startHour);

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{ status: BookingStatus; payment_status: PaymentStatus }>(
      `SELECT status, payment_status FROM bookings WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const b = cur.rows[0];
    if (!b) {
      await client.query("ROLLBACK");
      return fail(404, "Booking not found.");
    }
    if (b.status === "cancelled") {
      await client.query("ROLLBACK");
      return fail(400, "Cancelled bookings can't be edited.");
    }
    const court = await client.query(`SELECT 1 FROM courts WHERE id = $1`, [courtId]);
    if (!court.rows[0]) {
      await client.query("ROLLBACK");
      return fail(400, "That court doesn't exist.");
    }

    const status = activeBookingStatus(paymentMethod, b.payment_status, price.total);
    await client.query(
      `UPDATE bookings SET court_id = $2, booking_date = $3, start_hour = $4, end_hour = $5,
              player_name = $6, contact = $7, notes = $8, rate_type = $9, hourly_rate = $10,
              discount_pct = 0, amount = $11, payment_method = $12, payment_ref = $13, status = $14,
              -- A booking moved to another date or time starts over: its manual in progress/completed mark is cleared.
              phase = CASE WHEN booking_date IS DISTINCT FROM $3::date OR start_hour <> $4 OR end_hour <> $5 THEN NULL ELSE phase END,
              -- ... and gets its "coming up" reminder again at the new time.
              reminder_sent_at = CASE WHEN booking_date IS DISTINCT FROM $3::date OR start_hour <> $4 THEN NULL ELSE reminder_sent_at END
        WHERE id = $1`,
      [id, courtId, date, startHour, endHour, name, contact || "(admin)", notes, rateType, price.hourlyRate,
        price.total, paymentMethod, paymentMethod === "cash" ? "" : paymentRef, status]
    );
    // Re-claim the half-hour slots. The primary key on booking_slots rejects any overlap with other bookings.
    await client.query(`DELETE FROM booking_slots WHERE booking_id = $1`, [id]);
    await client.query(
      `INSERT INTO booking_slots (court_id, slot_date, slot_hour, booking_id)
       SELECT $1, $2, h, $3 FROM generate_series($4::numeric, $5::numeric - 0.5, 0.5) AS h`,
      [courtId, date, id, startHour, endHour]
    );
    await client.query("COMMIT");
    return { ok: true, data: { id, status } };
  } catch (e: unknown) {
    await client.query("ROLLBACK").catch(() => {});
    if ((e as { code?: string }).code === "23505")
      return fail(409, "That court is already booked for part of that time. Choose another court or time.");
    throw e;
  } finally {
    client.release();
  }
}

/** Staff: permanently delete a booking. Only cancelled bookings can be deleted. */
export async function deleteCancelledBooking(id: string): Promise<Result<{ id: string }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  const { rows } = await db().query<{ status: BookingStatus }>(
    `WITH gone AS (DELETE FROM bookings WHERE id = $1 AND status = 'cancelled' RETURNING id)
     SELECT (SELECT count(*) FROM gone)::int AS deleted, (SELECT status FROM bookings WHERE id = $1) AS status`,
    [id]
  );
  const r = rows[0] as unknown as { deleted: number; status: BookingStatus | null };
  if (r.deleted) return { ok: true, data: { id } };
  if (!r.status) return fail(404, "Booking not found.");
  return fail(400, "Cancel the booking first. Only cancelled bookings can be deleted.");
}


/**
 * Staff: mark a booking "in_progress" or "completed" by hand, or null to go back to automatic
 * (paid bookings follow the clock). A marked booking is never released for non-payment.
 */
export async function setBookingPhase(id: string, phase: unknown): Promise<Result<{ id: string; phase: Phase | null }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  if (phase !== null && phase !== "in_progress" && phase !== "completed") return fail(400, "Unknown progress status.");
  const { rows } = await db().query<{ status: BookingStatus }>(`SELECT status FROM bookings WHERE id = $1`, [id]);
  if (!rows[0]) return fail(404, "Booking not found.");
  if (rows[0].status === "cancelled") return fail(400, "Restore this booking first — it's cancelled.");
  await db().query(`UPDATE bookings SET phase = $2 WHERE id = $1`, [id, phase]);
  return { ok: true, data: { id, phase: phase as Phase | null } };
}

/**
 * Staff: undo an automatic release. The booking takes its hours back (refused if someone else has
 * booked them since), keeps its payment status, and won't be released for non-payment again.
 * `phase` optionally marks it in progress or completed straight away.
 */
export async function restoreBooking(id: string, phase: unknown, by: string): Promise<Result<{ id: string; status: BookingStatus }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  if (phase !== null && phase !== undefined && phase !== "in_progress" && phase !== "completed")
    return fail(400, "Unknown progress status.");
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{
      status: BookingStatus; cancelled_by: string | null; court_id: number; booking_date: string;
      start_hour: number; end_hour: number; payment_method: PaymentMethod; payment_status: PaymentStatus; amount: number;
    }>(
      `SELECT status, cancelled_by, court_id, booking_date, start_hour, end_hour, payment_method, payment_status, amount
         FROM bookings WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const b = cur.rows[0];
    if (!b) {
      await client.query("ROLLBACK");
      return fail(404, "Booking not found.");
    }
    if (b.status !== "cancelled" || b.cancelled_by !== "system") {
      await client.query("ROLLBACK");
      return fail(400, "Only bookings released automatically (not paid in time) can be restored.");
    }
    // Take the hours back; the primary key on booking_slots refuses them if they're taken.
    await client.query("SAVEPOINT slots");
    try {
      await client.query(
        `INSERT INTO booking_slots (court_id, slot_date, slot_hour, booking_id)
         SELECT $1, $2, h, $3 FROM generate_series($4::numeric, $5::numeric - 0.5, 0.5) AS h`,
        [b.court_id, b.booking_date, id, b.start_hour, b.end_hour]
      );
    } catch (e) {
      if ((e as { code?: string }).code !== "23505") throw e;
      await client.query("ROLLBACK TO SAVEPOINT slots");
      const taken = await client.query<{ player_name: string; cancel_code: string; start_hour: number; end_hour: number }>(
        `SELECT DISTINCT o.player_name, o.cancel_code, o.start_hour, o.end_hour FROM booking_slots s JOIN bookings o ON o.id = s.booking_id
          WHERE s.court_id = $1 AND s.slot_date = $2 AND s.slot_hour >= $3 AND s.slot_hour < $4 LIMIT 1`,
        [b.court_id, b.booking_date, b.start_hour, b.end_hour]
      );
      await client.query("ROLLBACK");
      const t = taken.rows[0];
      return fail(
        409,
        t
          ? `Can't restore: ${t.player_name} (${t.cancel_code}) has booked ${formatRange(t.start_hour, t.end_hour)} on this court since. Move one of the bookings first.`
          : "Can't restore: that time on this court has been booked since."
      );
    }
    const status = activeBookingStatus(b.payment_method, b.payment_status, b.amount);
    await client.query(
      `UPDATE bookings SET status = $2, cancelled_by = NULL, cancelled_at = NULL, pay_by = NULL, auto_release = FALSE,
              phase = $3, restored_by = $4, restored_at = now()
        WHERE id = $1`,
      [id, status, phase ?? null, by.slice(0, 60) || "admin"]
    );
    await client.query("COMMIT");
    return { ok: true, data: { id, status } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
