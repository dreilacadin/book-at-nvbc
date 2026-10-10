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
  paymentStatusLabel,
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
import { bookingPhase, minutesUntilStart, PAY_WINDOW_MINUTES, paymentDeadline, phaseLabel, refundOnCancel, RELEASE_MINUTES, type Phase } from "./booking-policy";
import { formatDateLong, formatRange, halfHours, isHalfHour, publicName, SLOT_HOURS } from "./format";
import { normalizeMemberCode } from "./membership";
import { blocksOn } from "./court-blocks";
import { notifyStaff, pushConfig } from "./notify";
import { notifyCustomer, scheduleReminders } from "./customer-notify";
import { isEmail } from "./customer-messages";
import { CUSTOMER, logBooking, logBookings, staff, SYSTEM } from "./booking-history";
import { describeChanges, type BookingFields } from "./booking-changes";
import { scheduleWaitlistCheck } from "./waitlist";
import { activeCoachCount, availableCoaches, coachForCode, coachingCancelled, notifyCoachCodeUsed, notifyCoachingRequest, restoreCoaching, type CodeCoach } from "./coaches";
import { allActivities, BOOKING_DEFAULT_SPORT, courtAllowed, isActivity, isSport, SPORTS, sportEmoji, sportLabel, type Sport } from "./sports";
import { holidayOn, holidaysBetween } from "./holidays";
import { closedAllDay, closedRanges, closureTimeText, overlapsClosure } from "./closures";
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
    `SELECT b.id, b.cancel_code, b.player_name, c.name AS court_name, COALESCE(b.activity, c.sport) AS sport, b.booking_date, b.start_hour, b.end_hour,
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
    booking_date: string; start_hour: number; end_hour: number; group_id: string | null;
  }>(
    `WITH rel AS (
       UPDATE bookings b SET status = 'cancelled', cancelled_by = 'system', cancelled_at = now()
         FROM courts c
        WHERE c.id = b.court_id
          AND b.status IN ('pending', 'reserved') AND b.payment_status IN ('unpaid', 'rejected') AND b.amount > 0
          AND b.phase IS NULL AND b.auto_release -- marked in progress/completed or restored by staff: keep
          AND ((b.booking_date - $1::date) * 1440 + (b.start_hour - $2::numeric) * 60 <= $3
               OR b.pay_by <= now())
        RETURNING b.id, b.cancel_code, b.player_name, c.name AS court_name, COALESCE(b.activity, c.sport) AS sport, b.booking_date, b.start_hour, b.end_hour, b.group_id
     ), freed AS (
       DELETE FROM booking_slots WHERE booking_id IN (SELECT id FROM rel)
     )
     SELECT * FROM rel`,
    [now.date, now.time, RELEASE_MINUTES]
  );
  await logBookings(rows.map((r) => r.id), SYSTEM, "Released", "Not paid in time");
  scheduleWaitlistCheck(...rows.map((r) => r.booking_date)); // someone may be waiting for these times
  await coachingCancelled(rows.map((r) => r.id));
  await notifyStaff(
    rows.filter((r) => !r.group_id || !rows.some((o) => o.id === r.group_id)).map((r) => ({
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
export async function getAvailability(date: string, requestedSport?: string) {
  await releaseUnpaidBookings();
  const settings = await getSettings();
  const today = nowAtFacility();
  const holiday = await holidayOn(date);
  const [allCourts, taken, blocks] = await Promise.all([
    db().query<{ id: number; name: string; sport: Sport; notes: string }>(
      `SELECT id, name, sport, notes FROM courts WHERE is_active ORDER BY sort_order, id`
    ),
    db().query<{ court_id: number; start_hour: number; end_hour: number; player_name: string; status: BookingStatus; coach_id: string | null }>(
      `SELECT court_id, start_hour, end_hour, player_name, status, coach_id FROM bookings
        WHERE booking_date = $1 AND status <> 'cancelled' ORDER BY court_id, start_hour`,
      [date]
    ),
    blocksOn(date),
  ]);
  // Booking page tabs: the default sport first, then the other sports, then activities (e.g. Zumba)
  // that have courts. A sport or activity can also use courts shared with it in Settings.
  const shared = settings.activity_courts;
  const sports = allActivities()
    .map((s) => ({ ...s, courtCount: allCourts.rows.filter((c) => courtAllowed(s.id, c, shared)).length }))
    .filter((s) => isSport(s.id) || s.courtCount > 0)
    .sort((a, b) => Number(b.id === BOOKING_DEFAULT_SPORT) - Number(a.id === BOOKING_DEFAULT_SPORT));
  // Without ?sport=, open the default sport — or, if it has no courts, the first one that does.
  const sport: string =
    (requestedSport && sports.some((s) => s.id === requestedSport) ? requestedSport : undefined) ??
    sports.find((s) => s.courtCount > 0)?.id ?? BOOKING_DEFAULT_SPORT;
  const courts = allCourts.rows
    .filter((c) => courtAllowed(sport, c, shared))
    .map(({ id, name, notes, sport: courtSport }) => ({
      id, name, notes,
      // A court shared from another sport (e.g. a badminton court for Zumba) says so.
      sharedFrom: courtSport !== sport ? courtSport : null,
    }));
  const courtIds = new Set(courts.map((c) => c.id));
  const closedTimes = closedRanges(holiday, settings.open_hour, settings.close_hour);
  return {
    sport,
    sports,
    activities: settings.activities, // custom activities, so the page can show their names
    pushKey: pushConfig()?.publicKey ?? null, // for "notify me if this opens up" on this device
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
      rates: ratesForDate(settings.rate_plans[sport], date, holiday?.kind === "holiday"),
      rateTypes: rateTypesFor(settings.rate_plans[sport]),
      weekend: settings.rate_plans[sport].weekendRates && (holiday?.kind === "holiday" || isWeekend(date)),
      // A holiday (open, or only partly closed) is priced like a weekend.
      holiday: holiday?.kind === "holiday" && !closedAllDay(holiday, settings.open_hour, settings.close_hour) ? holiday.name : null,
      memberCodeRequired: true, // the member rate needs an active member code (NVBC-XXXX-XXXX)
      // Coaches type their own code (or the old shared one while it's on).
      coachCodeRequired: (settings.shared_coach_code_enabled && settings.coach_code.trim() !== "") || (await activeCoachCount()) > 0,
    },
    // GCash / QR Ph / bank transfer for everyone; cash only with the coach rate and coach code.
    paymentMethods: enabledMethods(settings),
    cashForCoaches: cashAllowedForCoaches(settings, await activeCoachCount()),
    courts,
    // Booked times, shown with the booker's first name and last initial only ("Ana C.").
    bookings: taken.rows
      .filter((r) => courtIds.has(r.court_id))
      .map((r) => ({
        courtId: r.court_id,
        start: r.start_hour,
        end: r.end_hour,
        name: r.coach_id ? r.player_name : publicName(r.player_name), // coaches show by their nickname (e.g. "Coach Marvin")
        status: r.status as "pending" | "reserved" | "confirmed",
      })),
    // Closed (all day or part of it): "Christmas Eve — open 8:00 AM – 3:00 PM only".
    closed: closedTimes.length ? `${holiday!.name} — ${closureTimeText(holiday!)}` : null,
    // Days closed all day in the booking window (holidays, weekly rest days), for the date strip.
    closedDates: (await holidaysBetween(today.date, addDays(today.date, settings.booking_window_days)))
      .filter((h) => closedAllDay(h, settings.open_hour, settings.close_hour))
      .map((h) => h.date),
    // Closed times, then reserved times (Open Play, Queueing, …) with their label, so players see why.
    blocked: [
      ...courts.flatMap((c) =>
        halfHours(settings.open_hour, settings.close_hour - SLOT_HOURS)
          .filter((hour) => overlapsClosure(closedTimes, hour, hour + SLOT_HOURS))
          .map((hour) => ({ courtId: c.id, hour, label: `Closed · ${holiday!.name}` }))
      ),
      ...[...blockedSlots(blocks, date)]
        .map(([key, label]) => {
          const [courtId, hour] = key.split(":").map(Number);
          return { courtId, hour, label };
        })
        .filter((b) => courtIds.has(b.courtId) && !overlapsClosure(closedTimes, b.hour, b.hour + SLOT_HOURS)),
    ],
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
export function cashAllowedForCoaches(s: Settings, activeCoaches = 0): boolean {
  return enabledMethods(s).includes("cash") && ((s.shared_coach_code_enabled && s.coach_code.trim() !== "") || activeCoaches > 0);
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
  sport?: unknown; // what it's for: a sport or activity the court can be used for (default: the court's sport)
  extraCourtIds?: unknown; // group booking: more courts at the same time, under one code and one payment
  coachingCoachId?: unknown; // the customer asks this coach for a coaching session
  website?: unknown; // honeypot — real people never fill this in
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function createBooking(
  input: NewBookingInput,
  opts: { admin?: boolean; by?: string } = {} // by: the staff member adding it (admin)
): Promise<
  Result<{
    code: string;
    courtName: string; // all courts, for a group ("Court 1, Court 2")
    courts: string[];
    sport: string; // the sport or activity booked
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
  let name = str(input.name).replace(/\s+/g, " ");
  let contact = str(input.contact);
  const notes = str(input.notes);
  let email = str(input.email);

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
  }
  // The coach rate needs a coach code: a coach's own code (active coaches only), or the old shared
  // code while it's switched on. A coach's own code books under the coach's name and contact.
  let coach: CodeCoach | null = null;
  let sharedCoachCode = false;
  if (rateType === "coach") {
    const found = await coachForCode(input.rateCode);
    if (typeof found === "string") {
      if (!admin) return fail(400, found);
    } else if (found) coach = found;
    else if (settings.shared_coach_code_enabled && settings.coach_code.trim() && sameCode(str(input.rateCode), settings.coach_code))
      sharedCoachCode = true;
    else if (!admin && (str(input.rateCode) || (settings.shared_coach_code_enabled && settings.coach_code.trim()) || (await activeCoachCount()) > 0))
      return fail(400, "That coach code isn't right. Choose Regular, or ask the front desk for your coach code.");
  }
  if (coach) {
    name = coach.name; // the coach's nickname, as shown on bookings (e.g. "Coach Marvin")
    contact = coach.mobile;
    email = email || coach.email;
  }
  // Cash at the desk is only for coaches with a working code; everyone else pays online.
  if (!admin && paymentMethod === "cash" && !(rateType === "coach" && (coach || sharedCoachCode) && enabledMethods(settings).includes("cash")))
    return fail(400, "Cash payment is reserved for coaches (with their coach code). Please pay by GCash, QR Ph or bank transfer.");
  // A customer asking for a coaching session with a coach who's free then.
  const coachingId = rateType !== "coach" && typeof input.coachingCoachId === "string" && input.coachingCoachId ? input.coachingCoachId : null;

  // Is this rate offered for the court's sport? Checked first, so a switched-off Member rate
  // says so instead of asking for a member code. (Re-checked in the transaction below.)
  // What it's for: the chosen sport or activity (e.g. Zumba on a badminton court), or the court's own sport.
  const courtRow = await db().query<{ sport: Sport }>(`SELECT sport FROM courts WHERE id = $1`, [courtId]);
  const activity: string = isActivity(input.sport) ? input.sport : courtRow.rows[0]?.sport ?? "";
  // Group booking: more courts at the same time, one code and one payment.
  const extraIds = Array.isArray(input.extraCourtIds)
    ? [...new Set(input.extraCourtIds.map(Number))].filter((n) => Number.isInteger(n) && n !== courtId)
    : [];
  if (extraIds.length > 7) return fail(400, "You can book up to 8 courts at once.");
  if (!admin && rateType !== "regular") {
    const plan = settings.rate_plans[activity];
    if (plan && !rateTypesFor(plan).includes(rateType))
      return fail(
        400,
        rateTypesFor(plan).length === 1
          ? `${sportLabel(activity)} has one standard rate. Please book at the standard rate.`
          : `The ${rateTypeLabel(rateType).toLowerCase()} rate isn't offered for ${sportLabel(activity)}. Please choose another rate.`
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
  const holiday = await holidayOn(date);
  if (!admin && holiday?.closed) {
    const times = closedRanges(holiday, 0, 24);
    if (overlapsClosure(times, startHour, startHour + hours))
      return fail(400, holiday.mode === "all"
        ? `NVBC is closed on ${formatDateLong(date)} (${holiday.name}).`
        : `NVBC is closed for part of ${formatDateLong(date)} (${holiday.name}: ${closureTimeText(holiday)}). Please pick another time.`);
  }
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

  if (coachingId) {
    const free = await availableCoaches(activity, date, startHour, endHour);
    if (!free.some((c) => c.id === coachingId))
      return fail(409, "That coach isn't available at this time any more. Please choose another coach, or book without one.");
  }

  const client = await db().connect();
  try {
    await client.query("BEGIN");

    const allIds = [courtId, ...extraIds];
    const found = await client.query<{ id: number; name: string; sport: Sport }>(
      `SELECT id, name, sport FROM courts WHERE id = ANY($1::int[]) AND (is_active OR $2)`,
      [allIds, admin]
    );
    const courtsById = new Map(found.rows.map((c) => [c.id, c]));
    if (allIds.some((id) => !courtsById.has(id))) {
      await client.query("ROLLBACK");
      return fail(400, "That court is not available for booking.");
    }
    if (!settings.rate_plans[activity] || allIds.some((id) => !courtAllowed(activity, courtsById.get(id)!, settings.activity_courts))) {
      await client.query("ROLLBACK");
      return fail(400, `That court can't be booked for ${sportLabel(activity)}.`);
    }
    const court = { rows: [courtsById.get(courtId)!] };
    const sport = activity;
    if (!admin) {
      // Staff may book over reserved times (e.g. to sell a slot); players may not.
      const dayBlocks = await blocksOn(date);
      for (const id of allIds) {
        const block = findBlockConflict(dayBlocks, id, date, startHour, endHour);
        if (block) {
          await client.query("ROLLBACK");
          return fail(409, `${courtsById.get(id)!.name} is reserved for ${block.label} at that time. Please pick another time or court.`);
        }
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
    const rates = ratesForDate(plan, date, holiday?.kind === "holiday");
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
          AND group_id IS NULL -- a group booking's extra courts don't count again: it's the same time
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

    // One booking per court. The first holds the code the customer uses; a group's other courts
    // point to it. Retries on the (very unlikely) chance of a duplicate code.
    const insertOne = async (cId: number, groupId: string | null): Promise<{ id: string; code: string }> => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const c = newCancelCode();
        await client.query("SAVEPOINT ins");
        try {
          const proof = groupId === null && paymentMethod !== "cash" ? paymentProof : ""; // the screenshot goes on the first only
          const ins = await client.query<{ id: string }>(
            `INSERT INTO bookings (court_id, booking_date, start_hour, end_hour, player_name, contact, notes, cancel_code,
                                   rate_type, hourly_rate, discount_pct, amount, payment_method, payment_status,
                                   payment_ref, paid_at, status, payment_proof, membership_id, pay_by, payment_sent_at, customer_email,
                                   payment_proof_hash, activity, group_id, coach_id, coach_code_shared, coaching_coach_id, coaching_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                     CASE WHEN $14 = 'paid' THEN now() END, $16, $17, $18, $19,
                     CASE WHEN $15 <> '' OR $17 <> '' THEN now() END, $20,
                     CASE WHEN $17 <> '' THEN md5($17) ELSE '' END, $21, $22, $23, $24, $25,
                     CASE WHEN $25::uuid IS NOT NULL THEN 'requested' END) RETURNING id`,
            [
              cId, date, startHour, endHour, name, contact || "(admin)", notes, c,
              rateType, price.hourlyRate, 0, price.total, paymentMethod, paymentStatus, paymentRef, status,
              proof,
              rateType === "member" ? membershipId : null,
              payBy,
              email,
              activity,
              groupId,
              coach?.id ?? null,
              sharedCoachCode,
              groupId === null ? coachingId : null, // the coaching request goes on the first court
            ]
          );
          // Claim every half-hour slot. The primary key on booking_slots rejects any overlap.
          await client.query(
            `INSERT INTO booking_slots (court_id, slot_date, slot_hour, booking_id)
             SELECT $1, $2, h, $3 FROM generate_series($4::numeric, $5::numeric - 0.5, 0.5) AS h`,
            [cId, date, ins.rows[0].id, startHour, endHour]
          );
          return { id: ins.rows[0].id, code: c };
        } catch (e: unknown) {
          const err = e as { code?: string; constraint?: string };
          if (err.code === "23505" && err.constraint !== "booking_slots_pkey") {
            await client.query("ROLLBACK TO SAVEPOINT ins");
            continue;
          }
          if (err.code === "23505") {
            const taken = courtsById.get(cId)!.name;
            const e2 = new Error(`taken:${taken}`) as Error & { code: string };
            e2.code = "slot-taken";
            throw e2;
          }
          throw e;
        }
      }
      throw new Error("Could not generate a unique booking code");
    };
    const first = await insertOne(courtId, null);
    const bookingId = first.id;
    const code = first.code;
    for (const id of extraIds) await insertOne(id, bookingId);
    const courtNames = allIds.map((id) => courtsById.get(id)!.name);
    const groupTotal = Math.round(price.total * allIds.length * 100) / 100;

    await client.query("COMMIT");
    const info = { code, name, contact, court: courtNames.join(" + "), sport: activity, date, start: startHour, end: endHour };
    if (coach) notifyCoachCodeUsed(coach.id, info);
    if (coachingId) notifyCoachingRequest(coachingId, info);
    await logBooking(
      { id: bookingId },
      admin ? staff(opts.by ?? "Staff") : CUSTOMER,
      "Booked",
      `${courtNames.join(" + ")}, ${formatDateLong(date)}, ${formatRange(startHour, endHour)} · ${sportLabel(activity)} · ${formatPeso(groupTotal)} · ` +
        `${paymentLabel(paymentMethod)} · ${paymentStatusLabel(paymentStatus)}${paymentRef ? ` · ref ${paymentRef}` : ""}` +
        `${paymentMethod !== "cash" && paymentProof ? " · screenshot" : ""}${admin ? " · added by staff" : ""}`
    );
    if (!admin) {
      const paying =
        paymentStatus === "for_verification" ? `${paymentLabel(paymentMethod)} payment sent — please verify`
        : paymentMethod === "cash" ? "Coach · cash at the desk"
        : price.total > 0 ? `${paymentLabel(paymentMethod)} · paying within ${PAY_WINDOW_MINUTES} min` : "No charge";
      const extra = extraIds.length ? ` (+${extraIds.length} more court${extraIds.length > 1 ? "s" : ""})` : "";
      await notifyStaff([{
        kind: "booking_new",
        title: `New booking — ${name}`,
        pushTitle: `New booking — ${publicName(name)}`,
        body: `${bookingLine({ court_name: court.rows[0].name, sport, booking_date: date, start_hour: startHour, end_hour: endHour })}${extra} · ${formatPeso(groupTotal)} · ${paying}`,
        bookingCode: code,
      }]);
    }
    return {
      ok: true,
      data: {
        code, courtName: courtNames.join(", "), courts: courtNames, sport, date, startHour, endHour,
        rateType, hourlyRate: price.hourlyRate, regularRate: price.regularRate, savings: price.savings, amount: groupTotal,
        paymentMethod, paymentStatus, paymentRef, hasProof: paymentMethod !== "cash" && paymentProof !== "", status, payBy,
      },
    };
  } catch (e: unknown) {
    await client.query("ROLLBACK").catch(() => {});
    if ((e as { code?: string }).code === "slot-taken") {
      const taken = (e as Error).message.slice("taken:".length);
      return fail(409, extraIds.length ? `Sorry — ${taken} was just booked for part of that time. Please pick other courts or another time.` : "Sorry — someone just booked that slot. Please pick another time.");
    }
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
  courtName: string; // a group's courts, joined
  courts: string[]; // one court, or a group's courts (still booked)
  rescheduleCount: number;
  coaching: { coachId: string; coach: string; status: "requested" | "accepted" | "declined" | "cancelled"; note: string } | null;
  coachBooking: string | null;
  activity: { id: string; label: string; emoji: string };
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
  unreadMessages: number; // messages from staff the customer hasn't seen
};

/** Look up a booking by its code. Only the person holding the code sees the name. */
export async function findByCode(rawCode: unknown): Promise<Result<BookingView>> {
  const code = normalizeCode(rawCode);
  if (!code) return fail(400, "Booking codes look like NV-ABC123.");
  await releaseUnpaidBookings();
  const { rows } = await db().query(
    `SELECT b.id, b.cancel_code, c.name AS court_name, COALESCE(b.activity, c.sport) AS sport, b.booking_date, b.start_hour, b.end_hour,
            b.player_name, b.status, b.rate_type, b.hourly_rate, b.discount_pct, b.amount, b.reschedule_count,
            b.coaching_status, b.coaching_note, b.coaching_coach_id, (SELECT COALESCE(NULLIF(nickname, ''), full_name) FROM coaches WHERE id = b.coaching_coach_id) AS coaching_coach,
            (SELECT COALESCE(NULLIF(nickname, ''), full_name) FROM coaches WHERE id = b.coach_id) AS booked_by_coach,
            -- A group booking: its other courts (still booked), and what they all cost together.
            (SELECT json_agg(json_build_object('name', c2.name, 'status', g.status) ORDER BY c2.sort_order, c2.id)
               FROM bookings g JOIN courts c2 ON c2.id = g.court_id WHERE g.group_id = b.id) AS group_courts,
            b.payment_method, b.payment_status, b.payment_ref, (b.payment_proof <> '') AS has_proof, b.cancelled_by,
            b.pay_by, c.notes AS court_notes, b.phase, b.rejected_note,
            (SELECT count(*)::int FROM booking_messages m
              WHERE m.booking_id = b.id AND m.sender_kind = 'staff' AND m.read_at IS NULL) AS unread_messages
       FROM bookings b JOIN courts c ON c.id = b.court_id
      WHERE b.cancel_code = $1`,
    [code]
  );
  const r = rows[0];
  if (!r) return fail(404, "No booking found with that code.");
  // A group: every court still booked (the first one may have been cancelled by staff alone).
  const others = ((r.group_courts ?? []) as { name: string; status: BookingStatus }[]).filter((g) => g.status !== "cancelled");
  const courtNames = [...(r.status !== "cancelled" || others.length === 0 ? [r.court_name as string] : []), ...others.map((g) => g.name)];
  const groupStatus: BookingStatus = r.status === "cancelled" && others.length ? others[0].status : r.status;
  const groupAmount = Number(r.amount) * courtNames.length;
  return {
    ok: true,
    data: {
      code: r.cancel_code,
      courtName: courtNames.join(", "),
      courts: courtNames,
      rescheduleCount: r.reschedule_count,
      coaching: r.coaching_status
        ? { coachId: r.coaching_coach_id, coach: r.coaching_coach ?? "Coach", status: r.coaching_status, note: r.coaching_note }
        : null,
      coachBooking: r.booked_by_coach ?? null, // booked with a coach's own code
      activity: { id: r.sport, label: sportLabel(r.sport), emoji: sportEmoji(r.sport) }, // custom activities' name and emoji
      sport: r.sport,
      date: r.booking_date,
      startHour: r.start_hour,
      endHour: r.end_hour,
      name: r.player_name,
      status: groupStatus,
      rateType: r.rate_type,
      hourlyRate: r.hourly_rate,
      discountPct: r.discount_pct,
      amount: groupAmount,
      paymentMethod: r.payment_method,
      paymentStatus: r.payment_status,
      paymentRef: r.payment_ref,
      hasProof: r.has_proof,
      canCancel: groupStatus !== "cancelled" && !isPastSlot(r.booking_date, r.start_hour),
      cancelledBy: r.cancelled_by,
      payBy: r.pay_by && (r.payment_status === "unpaid" || r.payment_status === "rejected") && r.status === "pending"
        ? new Date(r.pay_by).toISOString() : null,
      rejectedNote: r.payment_status === "rejected" ? r.rejected_note : "",
      unreadMessages: r.unread_messages,
      courtNotes: r.court_notes,
      phase: bookingPhase(
        { status: groupStatus, phase: r.phase, payment_status: r.payment_status, amount: r.amount, date: r.booking_date, start_hour: r.start_hour, end_hour: r.end_hour },
        nowAtFacility()
      ),
    },
  };
}

/**
 * Cancels a booking and frees its time. With `wholeGroup`, also the other courts of its group
 * (a customer cancelling by code cancels everything booked under it).
 */
async function cancelWhere(whereSql: string, param: string, by: string, allowStarted: boolean, wholeGroup = false) {
  // A refund becomes due for paid courts: by the refund rules when the customer cancels online,
  // always when staff cancel (they can then mark it refunded or "no refund").
  const byCustomer = by === "player";
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, booking_date, start_hour, status, payment_method, payment_status FROM bookings WHERE ${whereSql} FOR UPDATE`,
      [param]
    );
    const b = rows[0];
    if (!b) {
      await client.query("ROLLBACK");
      return fail(404, "Booking not found.");
    }
    const members = wholeGroup
      ? (await client.query<{ id: string }>(`SELECT id FROM bookings WHERE group_id = $1 AND status <> 'cancelled' FOR UPDATE`, [b.id])).rows
      : [];
    if (b.status === "cancelled" && members.length === 0) {
      await client.query("ROLLBACK");
      return fail(400, "This booking is already cancelled.");
    }
    if (!allowStarted && isPastSlot(b.booking_date, b.start_hour)) {
      await client.query("ROLLBACK");
      return fail(400, "This booking has already started and can no longer be cancelled online.");
    }
    const ids = [...(b.status === "cancelled" ? [] : [b.id as string]), ...members.map((m) => m.id)];
    await client.query(`DELETE FROM booking_slots WHERE booking_id = ANY($1::uuid[])`, [ids]);
    await client.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), payment_proof = '' WHERE id = ANY($1::uuid[])`,
      [ids, by]
    );
    const refundable = byCustomer
      ? refundOnCancel({ payment_method: b.payment_method, payment_status: b.payment_status, date: b.booking_date, start_hour: Number(b.start_hour) }, nowAtFacility()) === "refundable"
      : true;
    if (refundable)
      await client.query(
        `UPDATE bookings SET refund_status = 'due', refund_amount = amount
          WHERE id = ANY($1::uuid[]) AND refund_status IS NULL AND amount > 0
            AND (payment_status = 'paid' OR ($2 AND payment_status = 'for_verification'))
            AND ($2 = FALSE OR payment_method <> 'cash')`,
        [ids, byCustomer]
      );
    await client.query("COMMIT");
    await coachingCancelled(ids); // tell any coach whose session this was
    return { ok: true as const, data: { id: b.id as string, date: b.booking_date as string } };
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
  const r = await cancelWhere("cancel_code = $1", code, "player", false, true);
  if (r.ok) {
    scheduleWaitlistCheck(r.data.date);
    await logBooking({ id: r.data.id }, CUSTOMER, "Cancelled", "On My booking");
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
  const r = await cancelWhere("id = $1", id, by.slice(0, 60) || "admin", true);
  if (r.ok) {
    await logBooking({ id }, staff(by), "Cancelled");
    scheduleWaitlistCheck(r.data.date);
  }
  return r;
}

/**
 * Player tells us they paid by GCash / QR Ph / BPI: store the reference number and/or receipt
 * screenshot for staff to verify. Sending only one keeps the other from an earlier submission.
 */
export async function submitPayment(
  rawCode: unknown,
  method: unknown,
  ref: unknown,
  proof?: unknown,
  amountPaid?: unknown // what the player says they sent (read from their screenshot, checked by them)
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
  const paid = typeof amountPaid === "string" ? amountPaid.replace(/,/g, "").trim() : amountPaid;
  const reported = paid === undefined || paid === null || paid === "" ? null : Number(paid);
  if (reported !== null && (!Number.isFinite(reported) || reported <= 0 || reported >= 1_000_000))
    return fail(400, "Please check the amount you paid (or leave it blank).");
  const settings = await getSettings();
  if (!enabledMethods(settings).includes(method))
    return fail(400, "That payment method isn't available right now.");
  await releaseUnpaidBookings();

  // Accepted while the booking is active and, for a first payment, within its payment window.
  const { rows } = await db().query<{ payment_ref: string; has_proof: boolean }>(
    `UPDATE bookings SET payment_method = $2,
            payment_ref   = CASE WHEN $3 = '' THEN payment_ref ELSE $3 END,
            -- The screenshot (and the amount the player reports) go on the booking with the code; a
            -- group's other courts share its payment.
            payment_proof = CASE WHEN $4 = '' OR cancel_code <> $1 THEN payment_proof ELSE $4 END,
            -- Fingerprint of the screenshot: kept after the screenshot itself is deleted, to spot reuse.
            payment_proof_hash = CASE WHEN $4 = '' OR cancel_code <> $1 THEN payment_proof_hash ELSE md5($4) END,
            paid_amount_reported = CASE WHEN cancel_code = $1 THEN COALESCE($5, paid_amount_reported) ELSE paid_amount_reported END,
            payment_status = 'for_verification',
            payment_sent_at = now(),
            status = CASE WHEN amount > 0 THEN 'pending' ELSE status END -- held until staff verify
      WHERE (cancel_code = $1 OR group_id = (SELECT id FROM bookings WHERE cancel_code = $1))
        AND status <> 'cancelled' AND payment_status IN ('unpaid', 'for_verification', 'rejected')
        AND (pay_by IS NULL OR pay_by > now() OR payment_status = 'for_verification')
      RETURNING payment_ref, (SELECT payment_proof <> '' FROM bookings p WHERE p.cancel_code = $1) AS has_proof`,
    [code, method, paymentRef, paymentProof, reported === null ? null : Math.round(reported * 100) / 100]
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
  await logBooking(
    { code },
    CUSTOMER,
    "Payment sent",
    `${paymentLabel(method)}${rows[0].payment_ref ? ` · ref ${rows[0].payment_ref}` : ""}${paymentProof ? " · screenshot" : ""}`
  );
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
  by = "admin",
  rawSplits?: unknown // staff only: a payment in parts, e.g. [{ method: "cash", amount: 350 }, { method: "gcash", amount: 100, reference }]
): Promise<Result<{ id: string; status: BookingStatus }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  if (!isPaymentStatus(status)) return fail(400, "Unknown payment status.");
  if (status === "rejected") return rejectPayment(id, note, by);
  // Split payment: every part valid, and together exactly what's due (a group's total for a group).
  let splits: { method: PaymentMethod; amount: number; reference: string }[] | null = null;
  if (rawSplits !== undefined && rawSplits !== null) {
    if (status !== "paid") return fail(400, "A split payment can only be recorded as Paid.");
    if (!Array.isArray(rawSplits) || rawSplits.length < 2 || rawSplits.length > 4)
      return fail(400, "A split payment has 2 to 4 parts.");
    splits = [];
    for (const p of rawSplits as Record<string, unknown>[]) {
      const amount = Math.round(Number(p?.amount) * 100) / 100;
      if (!isPaymentMethod(p?.method)) return fail(400, "Choose how each part was paid.");
      if (!Number.isFinite(amount) || amount <= 0) return fail(400, "Enter an amount for each part.");
      splits.push({ method: p.method, amount, reference: p.method === "cash" ? "" : cleanRef(p.reference) });
    }
    const { rows: due } = await db().query<{ total: number }>(
      `SELECT COALESCE(sum(amount), 0)::float8 AS total FROM bookings
        WHERE COALESCE(group_id, id) = (SELECT COALESCE(group_id, id) FROM bookings WHERE id = $1) AND (status <> 'cancelled' OR id = $1)`,
      [id]
    );
    const total = splits.reduce((n, p) => n + p.amount, 0);
    if (Math.abs(total - Number(due[0]?.total ?? 0)) >= 0.01)
      return fail(400, `The parts add up to ${formatPeso(total)}, but ${formatPeso(Number(due[0]?.total ?? 0))} is due.`);
    // The biggest part is the booking's payment method; the references are kept together.
    method = [...splits].sort((a, b) => b.amount - a.amount)[0].method;
    ref = splits.map((p) => p.reference).filter(Boolean).join(" / ");
  }
  if (method !== undefined && !isPaymentMethod(method)) return fail(400, "Unknown payment method.");
  const { rows } = await db().query(
    `UPDATE bookings SET
        payment_status = $2,
        payment_method = COALESCE($3, payment_method),
        payment_ref    = COALESCE($4, payment_ref),
        paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, now()) ELSE NULL END,
        -- Checked: the screenshot isn't needed any more (its fingerprint and the reference stay).
        payment_proof = CASE WHEN $2 IN ('paid', 'waived', 'refunded') THEN '' ELSE payment_proof END,
        payment_splits = NULL, -- set again below for a split payment
        pay_by = NULL, -- staff handle the payment from here: no online payment window
        -- Status follows the payment (see activeBookingStatus); cancelled stays cancelled.
        status = CASE
          WHEN status = 'cancelled' THEN status
          WHEN amount > 0 AND $2 NOT IN ('paid', 'waived')
            THEN CASE WHEN COALESCE($3, payment_method) = 'cash' THEN 'reserved' ELSE 'pending' END
          ELSE 'confirmed' END
       FROM (SELECT id AS old_id, payment_status AS old_status, payment_method AS old_method, payment_ref AS old_ref,
                    COALESCE(group_id, id) AS root
               FROM bookings WHERE id = $1 FOR UPDATE) old -- the value before this change
      -- A group's courts share one payment: the other (still booked) courts change with it.
      WHERE id = old.old_id OR (COALESCE(group_id, id) = old.root AND status <> 'cancelled')
      RETURNING id, status, old.old_status, old.old_method, payment_method, old.old_ref, payment_ref, old.root`,
    [id, status, method ?? null, ref === undefined ? null : cleanRef(ref)]
  );
  const r = rows.find((x) => x.id === id);
  if (!r) return fail(404, "Booking not found.");
  if (splits) await db().query(`UPDATE bookings SET payment_splits = $2::jsonb WHERE id = $1`, [r.root, JSON.stringify(splits)]);
  const changes = [
    r.old_status !== status ? `${paymentStatusLabel(r.old_status)} → ${paymentStatusLabel(status)}` : "",
    r.old_method !== r.payment_method ? `method ${paymentLabel(r.old_method)} → ${paymentLabel(r.payment_method)}` : "",
    r.old_ref !== r.payment_ref ? `reference “${r.old_ref}” → “${r.payment_ref}”` : "",
  ].filter(Boolean);
  if (splits) changes.push(`split: ${splits.map((p) => `${paymentLabel(p.method)} ${formatPeso(p.amount)}${p.reference ? ` (ref ${p.reference})` : ""}`).join(" + ")}`);
  const group = rows.length > 1 ? ` (all ${rows.length} courts of the group)` : "";
  if (changes.length) await logBooking({ id }, staff(by), "Payment status", changes.join(" · ") + group);
  const settled = (s: string) => s === "paid" || s === "waived";
  if (r.status === "confirmed" && settled(status) && !settled(r.old_status)) notifyCustomer(r.root, "confirmed");
  return { ok: true, data: { id, status: r.status as BookingStatus } };
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
  // The whole group (one payment for all its courts).
  const { rows: done } = await db().query<{ root: string }>(
    `UPDATE bookings SET payment_status = 'rejected', status = 'pending', paid_at = NULL, pay_by = $2, payment_proof = '',
            rejected_note = $3, rejected_by = $4, rejected_at = now()
      WHERE id = $1 OR (COALESCE(group_id, id) = (SELECT COALESCE(group_id, id) FROM bookings WHERE id = $1) AND status <> 'cancelled')
      RETURNING COALESCE(group_id, id) AS root`,
    [id, payBy, note, by.slice(0, 60) || "admin"]
  );
  await logBooking({ id }, staff(by), "Payment rejected", note);
  notifyCustomer(done[0]?.root ?? id, "rejected");
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
export async function updateBooking(id: string, input: BookingEdit, by = "Staff"): Promise<Result<{ id: string; status: BookingStatus }>> {
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
    const cur = await client.query<{
      status: BookingStatus; payment_status: PaymentStatus; court_name: string; booking_date: string; start_hour: number;
      end_hour: number; player_name: string; contact: string; notes: string; rate_type: string; hourly_rate: number;
      amount: number; payment_method: string; payment_ref: string;
    }>(
      `SELECT b.status, b.payment_status, c.name AS court_name, b.booking_date, b.start_hour, b.end_hour, b.player_name,
              b.contact, b.notes, b.rate_type, b.hourly_rate, b.amount, b.payment_method, b.payment_ref
         FROM bookings b JOIN courts c ON c.id = b.court_id WHERE b.id = $1 FOR UPDATE OF b`,
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
    const court = await client.query<{ name: string }>(`SELECT name FROM courts WHERE id = $1`, [courtId]);
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
    const before: BookingFields = {
      court: b.court_name, date: b.booking_date, startHour: Number(b.start_hour), endHour: Number(b.end_hour), name: b.player_name,
      contact: b.contact, notes: b.notes, rateType: b.rate_type, hourlyRate: Number(b.hourly_rate), amount: Number(b.amount),
      paymentMethod: b.payment_method, paymentRef: b.payment_ref,
    };
    const changes = describeChanges(before, {
      court: court.rows[0].name, date, startHour, endHour, name, contact: contact || "(admin)", notes, rateType,
      hourlyRate: price.hourlyRate, amount: price.total, paymentMethod, paymentRef: paymentMethod === "cash" ? "" : paymentRef,
    });
    if (changes.length) await logBooking({ id }, staff(by), "Edited", changes.join("\n"));
    if (before.date !== date || before.startHour !== startHour || before.endHour !== endHour || before.court !== court.rows[0].name)
      scheduleWaitlistCheck(before.date); // its old time may be free now
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
export async function deleteCancelledBooking(id: string, by = "Staff"): Promise<Result<{ id: string }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  // The first booking of a group holds the code the customer uses: keep it while other courts are booked.
  const { rows: active } = await db().query(`SELECT 1 FROM bookings WHERE group_id = $1 AND status <> 'cancelled' LIMIT 1`, [id]);
  if (active.length) return fail(400, "This booking holds the group's code — cancel the group's other courts before deleting it.");
  const who = staff(by);
  // The log entry is written in the same statement, so it exists exactly when the booking was deleted.
  const { rows } = await db().query<{ status: BookingStatus }>(
    `WITH gone AS (DELETE FROM bookings WHERE id = $1 AND status = 'cancelled' RETURNING id, cancel_code, player_name),
          logged AS (
            INSERT INTO booking_history (booking_id, booking_code, actor, actor_kind, action, details)
            SELECT NULL, cancel_code, $2, $3, 'Deleted', 'Removed permanently · ' || player_name FROM gone
          )
     SELECT (SELECT count(*) FROM gone)::int AS deleted, (SELECT status FROM bookings WHERE id = $1) AS status`,
    [id, who.name, who.kind]
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
export async function setBookingPhase(id: string, phase: unknown, by = "Staff"): Promise<Result<{ id: string; phase: Phase | null }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  if (phase !== null && phase !== "in_progress" && phase !== "completed") return fail(400, "Unknown progress status.");
  const { rows } = await db().query<{ status: BookingStatus; phase: Phase | null }>(`SELECT status, phase FROM bookings WHERE id = $1`, [id]);
  if (!rows[0]) return fail(404, "Booking not found.");
  if (rows[0].status === "cancelled") return fail(400, "Restore this booking first — it's cancelled.");
  await db().query(`UPDATE bookings SET phase = $2 WHERE id = $1`, [id, phase]);
  const label = (p: Phase | null) => (p ? phaseLabel(p) : "Automatic");
  if (rows[0].phase !== phase) await logBooking({ id }, staff(by), "Progress", `${label(rows[0].phase)} → ${label(phase as Phase | null)}`);
  return { ok: true, data: { id, phase: phase as Phase | null } };
}

/**
 * Staff: undo an automatic release. The booking takes its hours back (refused if someone else has
 * booked them since), keeps its payment status, and won't be released for non-payment again.
 * `phase` optionally marks it in progress or completed straight away.
 */
export async function restoreBooking(
  id: string, phase: unknown, by: string
): Promise<Result<{ id: string; status: BookingStatus; coaching: string | null }>> {
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
    await logBooking({ id }, staff(by), "Restored", `After an automatic release${phase ? `, as ${phaseLabel(phase as Phase)}` : ""}`);
    // A coaching session cancelled by the release comes back too (unless the coach can't take it now).
    const c = await restoreCoaching(id, staff(by));
    const coaching = c.ok ? null : c.status === 400 ? null : c.error;
    return { ok: true, data: { id, status, coaching } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Staff: record a refund for a cancelled, paid booking (the whole group, when it's one):
 * "refunded" (with the reference), "none" (no refund, with a note), or "due" (owed).
 */
export async function setRefund(id: string, input: Record<string, unknown>, by: string): Promise<Result<{ id: string }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  const action = input.refund;
  if (action !== "refunded" && action !== "none" && action !== "due") return fail(400, "Unknown refund action.");
  const ref = cleanRef(input.reference);
  const note = typeof input.note === "string" ? input.note.trim().replace(/\s+/g, " ").slice(0, 300) : "";
  if (action === "none" && note.length < 3) return fail(400, "Add a short note saying why there's no refund.");
  const { rows } = await db().query<{ id: string; amount: number; root: string }>(
    `UPDATE bookings SET
        refund_status = $2,
        refund_amount = COALESCE(refund_amount, amount),
        refund_ref = CASE WHEN $2 = 'refunded' THEN $3 ELSE refund_ref END,
        refund_note = CASE WHEN $2 = 'none' THEN $4 ELSE refund_note END,
        refund_by = CASE WHEN $2 = 'due' THEN refund_by ELSE $5 END,
        refund_at = CASE WHEN $2 = 'due' THEN refund_at ELSE now() END,
        payment_status = CASE WHEN $2 = 'refunded' THEN 'refunded'
                              WHEN payment_status = 'refunded' THEN 'paid' ELSE payment_status END
      WHERE status = 'cancelled' AND amount > 0
        AND COALESCE(group_id, id) = (SELECT COALESCE(group_id, id) FROM bookings WHERE id = $1)
        AND (id = $1 OR refund_status IS NOT NULL)
      RETURNING id, amount::float8 AS amount, COALESCE(group_id, id) AS root`,
    [id, action, ref, note, by.slice(0, 60) || "Staff"]
  );
  if (!rows.length) return fail(400, "Only cancelled bookings with a payment can be refunded.");
  const total = rows.reduce((n, r) => n + Number(r.amount), 0);
  const what = action === "refunded" ? `Refunded ${formatPeso(total)}${ref ? ` · ref ${ref}` : ""}`
    : action === "none" ? `No refund: ${note}` : `Refund due: ${formatPeso(total)}`;
  await logBooking({ id }, staff(by), "Refund", what + (rows.length > 1 ? ` (${rows.length} courts)` : ""));
  if (action === "refunded") notifyCustomer(rows[0].root, "refunded");
  return { ok: true, data: { id } };
}

/** Staff: mark that the player didn't turn up (or undo it). Shown when the same contact books again. */
export async function setNoShow(id: string, on: unknown, by: string): Promise<Result<{ id: string }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  const flag = on === true;
  const { rows } = await db().query<{ booking_date: string; start_hour: number }>(
    `UPDATE bookings SET no_show = $2, no_show_by = CASE WHEN $2 THEN $3 END, no_show_at = CASE WHEN $2 THEN now() END
      WHERE id = $1 AND status <> 'cancelled'
        AND (booking_date + make_interval(mins => (start_hour * 60)::int)) <= (now() AT TIME ZONE 'Asia/Manila') -- it has started
      RETURNING booking_date, start_hour`,
    [id, flag, by.slice(0, 60) || "Staff"]
  );
  if (!rows[0]) return fail(400, "Only bookings that have started (and weren't cancelled) can be marked as a no-show.");
  await logBooking({ id }, staff(by), flag ? "No-show" : "No-show undone", flag ? "The player didn't turn up" : "");
  return { ok: true, data: { id } };
}

/** Staff: a coach's code was used by someone else on this booking (or undo). Counted on the coach. */
export async function setCoachMisuse(id: string, on: unknown, by: string): Promise<Result<{ id: string }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  const { rows } = await db().query<{ id: string }>(
    `UPDATE bookings SET coach_code_misuse = $2 WHERE id = $1 AND (coach_id IS NOT NULL OR coach_code_shared) RETURNING id`,
    [id, on === true]
  );
  if (!rows[0]) return fail(400, "Only bookings made with a coach code can be flagged.");
  await logBooking({ id }, staff(by), on === true ? "Coach code misuse" : "Coach code misuse undone",
    on === true ? "Booked with a coach code by someone who isn't that coach" : "");
  return { ok: true, data: { id } };
}
