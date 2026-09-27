import { randomInt } from "node:crypto";
import { db, getSettings, type Settings } from "./db";
import {
  activeBookingStatus,
  computePrice,
  isPaymentMethod,
  type BookingStatus,
  rateFor,
  type SportRates,
  isPaymentStatus,
  isRateType,
  PAYMENT_METHODS,
  type PaymentInfo,
  type PaymentMethod,
  type PaymentStatus,
  type RateType,
} from "./pricing";
import { SPORTS, type Sport } from "./sports";
import { addDays, daysBetween, isPastSlot, isValidDate, nowAtFacility } from "./time";

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
 * Public, anonymous availability for one date and sport. Never includes who booked.
 * If no sport is given, the first sport that has courts is used.
 */
export async function getAvailability(date: string, requestedSport?: Sport) {
  const settings = await getSettings();
  const today = nowAtFacility();
  const [allCourts, slots] = await Promise.all([
    db().query<{ id: number; name: string; sport: Sport }>(
      `SELECT id, name, sport FROM courts WHERE is_active ORDER BY sort_order, id`
    ),
    db().query<{ court_id: number; slot_hour: number }>(
      `SELECT court_id, slot_hour FROM booking_slots WHERE slot_date = $1`,
      [date]
    ),
  ]);
  const sports = SPORTS.map((s) => ({
    ...s,
    courtCount: allCourts.rows.filter((c) => c.sport === s.id).length,
  }));
  const sport: Sport =
    requestedSport ?? sports.find((s) => s.courtCount > 0)?.id ?? SPORTS[0].id;
  const courts = allCourts.rows
    .filter((c) => c.sport === sport)
    .map(({ id, name }) => ({ id, name }));
  const courtIds = new Set(courts.map((c) => c.id));
  return {
    sport,
    sports,
    date,
    today: today.date,
    currentHour: today.hour,
    openHour: settings.open_hour,
    closeHour: settings.close_hour,
    maxHoursPerBooking: settings.max_hours_per_booking,
    bookingWindowDays: settings.booking_window_days,
    lastBookableDate: addDays(today.date, settings.booking_window_days),
    announcement: settings.announcement,
    // Public pricing info. The member/coach codes themselves are never sent.
    pricing: {
      rates: sportRates(settings, sport),
      memberCodeRequired: settings.member_code.trim() !== "",
      coachCodeRequired: settings.coach_code.trim() !== "",
    },
    paymentMethods: enabledMethods(settings),
    courts,
    booked: slots.rows
      .filter((r) => courtIds.has(r.court_id))
      .map((r) => ({ courtId: r.court_id, hour: r.slot_hour })),
  };
}

/**
 * Payment methods players can actually use: switched on in /admin AND with their details
 * filled in (a GCash method with no GCash number would just confuse people).
 * Kept in the standard order: Cash, GCash, QR Ph, BPI.
 */
/** Regular, member and coach hourly prices for a sport. Missing member/coach prices fall back to regular. */
export function sportRates(s: Settings, sport: string): SportRates {
  const regular = Number(s.hourly_rates?.[sport] ?? 0);
  const pick = (v: unknown) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? regular : Number(v));
  return { regular, member: pick(s.member_rates?.[sport]), coach: pick(s.coach_rates?.[sport]) };
}

function enabledMethods(s: Settings): PaymentMethod[] {
  const on = s.payment_methods ?? [];
  const ready: Record<PaymentMethod, boolean> = {
    cash: true,
    gcash: s.gcash_number.trim() !== "",
    qrph: s.qrph_image !== "",
    bpi: s.bpi_account_number.trim() !== "",
  };
  const list = PAYMENT_METHODS.map((m) => m.id).filter((id) => on.includes(id) && ready[id]);
  return list.length ? list : ["cash"];
}

/** Payment instructions players see after booking. */
export async function getPaymentInfo(): Promise<PaymentInfo> {
  const s = await getSettings();
  return {
    methods: enabledMethods(s),
    gcashName: s.gcash_name,
    gcashNumber: s.gcash_number,
    bpiAccountName: s.bpi_account_name,
    bpiAccountNumber: s.bpi_account_number,
    qrphImage: s.qrph_image,
    note: s.payment_note,
  };
}

const sameCode = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

function cleanRef(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 60) : "";
}

export type NewBookingInput = {
  rateType?: unknown; // regular | member | coach
  rateCode?: unknown; // member/coach code, if the center requires one
  paymentMethod?: unknown; // cash | gcash | qrph | bpi
  paymentRef?: unknown; // reference number, if already paid by e-wallet/bank
  paymentStatus?: unknown; // staff only
  noCharge?: unknown; // staff only: tournaments, maintenance blocks
  courtId?: unknown;
  date?: unknown;
  startHour?: unknown;
  hours?: unknown;
  name?: unknown;
  contact?: unknown;
  notes?: unknown;
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
    status: "pending" | "confirmed";
  }>
> {
  const admin = !!opts.admin;
  if (!admin && str(input.website)) return fail(400, "Booking could not be completed.");

  const courtId = Number(input.courtId);
  const startHour = Number(input.startHour);
  const hours = Number(input.hours);
  const date = input.date;
  const name = str(input.name).replace(/\s+/g, " ");
  const contact = str(input.contact);
  const notes = str(input.notes);

  if (!Number.isInteger(courtId)) return fail(400, "Please choose a court.");
  if (!isValidDate(date)) return fail(400, "Please choose a valid date.");
  if (!Number.isInteger(startHour) || !Number.isInteger(hours) || hours < 1)
    return fail(400, "Please choose a valid time.");
  if (name.length < 2 || name.length > 60) return fail(400, "Please enter your name (2–60 characters).");
  if (!admin && (contact.length < 7 || contact.length > 60 || !/[0-9@]/.test(contact)))
    return fail(400, "Please enter a mobile number or email so we can reach you.");
  if (notes.length > 200) return fail(400, "Notes must be 200 characters or fewer.");

  const rateType: RateType = input.rateType === undefined || input.rateType === "" ? "regular" : (input.rateType as RateType);
  if (!isRateType(rateType)) return fail(400, "Please choose Regular, Member or Coach.");
  const paymentMethod: PaymentMethod =
    input.paymentMethod === undefined || input.paymentMethod === "" ? "cash" : (input.paymentMethod as PaymentMethod);
  if (!isPaymentMethod(paymentMethod)) return fail(400, "Please choose a payment method.");
  const paymentRef = cleanRef(input.paymentRef);

  const settings = await getSettings();

  if (!admin) {
    if (!enabledMethods(settings).includes(paymentMethod))
      return fail(400, "That payment method isn't available right now. Please choose another.");
    // Member/coach rates can be protected with a code set by staff in /admin.
    const required = rateType === "member" ? settings.member_code : rateType === "coach" ? settings.coach_code : "";
    if (required.trim() && !sameCode(str(input.rateCode), required))
      return fail(
        400,
        `That ${rateType} code isn't right. Choose Regular, or ask the front desk for the ${rateType} code.`
      );
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
    const rates = sportRates(settings, sport);
    const price = noCharge ? computePrice(0, hours) : computePrice(rateFor(rates, rateType), hours, rates.regular);
    let paymentStatus: PaymentStatus = paymentRef && paymentMethod !== "cash" ? "for_verification" : "unpaid";
    if (noCharge) paymentStatus = "waived";
    else if (admin && isPaymentStatus(input.paymentStatus)) paymentStatus = input.paymentStatus;
    const status = activeBookingStatus(paymentMethod, paymentStatus, price.total);

    // Fair-use limit per person per day (matched on their contact number/email).
    const used = await client.query<{ total: number }>(
      `SELECT COALESCE(SUM(end_hour - start_hour), 0)::int AS total
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
                                 payment_ref, paid_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                   CASE WHEN $14 = 'paid' THEN now() END, $16) RETURNING id`,
          [
            courtId, date, startHour, endHour, name, contact || "(admin)", notes, code,
            rateType, price.hourlyRate, 0, price.total, paymentMethod, paymentStatus, paymentRef, status,
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

    // Claim every hour. The primary key on booking_slots rejects any overlap.
    await client.query(
      `INSERT INTO booking_slots (court_id, slot_date, slot_hour, booking_id)
       SELECT $1, $2, h, $3 FROM generate_series($4::int, $5::int - 1) AS h`,
      [courtId, date, bookingId, startHour, endHour]
    );

    await client.query("COMMIT");
    return {
      ok: true,
      data: {
        code, courtName: court.rows[0].name, sport, date, startHour, endHour,
        rateType, hourlyRate: price.hourlyRate, regularRate: price.regularRate, savings: price.savings, amount: price.total,
        paymentMethod, paymentStatus, paymentRef, status,
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
  canCancel: boolean;
};

/** Look up a booking by its code. Only the person holding the code sees the name. */
export async function findByCode(rawCode: unknown): Promise<Result<BookingView>> {
  const code = normalizeCode(rawCode);
  if (!code) return fail(400, "Booking codes look like NV-ABC123.");
  const { rows } = await db().query(
    `SELECT b.cancel_code, c.name AS court_name, c.sport, b.booking_date, b.start_hour, b.end_hour,
            b.player_name, b.status, b.rate_type, b.hourly_rate, b.discount_pct, b.amount,
            b.payment_method, b.payment_status, b.payment_ref
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
      canCancel: r.status !== "cancelled" && !isPastSlot(r.booking_date, r.start_hour),
    },
  };
}

async function cancelWhere(whereSql: string, param: string, by: "player" | "admin", allowStarted: boolean) {
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
  return cancelWhere("cancel_code = $1", code, "player", false);
}

export async function cancelById(id: string): Promise<Result<{ id: string }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  return cancelWhere("id = $1", id, "admin", true);
}

/** Player tells us they paid by GCash / QR Ph / BPI: store the reference number for staff to verify. */
export async function submitPayment(
  rawCode: unknown,
  method: unknown,
  ref: unknown
): Promise<Result<{ paymentStatus: PaymentStatus; paymentMethod: PaymentMethod; paymentRef: string }>> {
  const code = normalizeCode(rawCode);
  if (!code) return fail(400, "Booking codes look like NV-ABC123.");
  if (!isPaymentMethod(method) || method === "cash") return fail(400, "Choose GCash, QR Ph or BPI transfer.");
  const paymentRef = cleanRef(ref);
  if (!/^[A-Za-z0-9][A-Za-z0-9 \-]{3,}$/.test(paymentRef))
    return fail(400, "Please enter the reference number from your payment receipt.");
  const settings = await getSettings();
  if (!enabledMethods(settings).includes(method))
    return fail(400, "That payment method isn't available right now.");

  const { rows } = await db().query<{ payment_status: PaymentStatus }>(
    `UPDATE bookings SET payment_method = $2, payment_ref = $3, payment_status = 'for_verification',
            status = CASE WHEN amount > 0 THEN 'pending' ELSE status END -- held until staff verify
      WHERE cancel_code = $1 AND status <> 'cancelled' AND payment_status IN ('unpaid', 'for_verification')
      RETURNING payment_status`,
    [code, method, paymentRef]
  );
  if (!rows[0]) {
    const b = await findByCode(code);
    if (!b.ok) return b;
    if (b.data.status === "cancelled") return fail(400, "This booking was cancelled.");
    return fail(400, `This booking is already marked "${b.data.paymentStatus === "paid" ? "paid" : b.data.paymentStatus}".`);
  }
  return { ok: true, data: { paymentStatus: "for_verification", paymentMethod: method, paymentRef } };
}

/** Staff: mark a booking paid / unpaid / no charge / refunded (optionally correcting method or reference). */
export async function setPaymentStatus(
  id: string,
  status: unknown,
  method?: unknown,
  ref?: unknown
): Promise<Result<{ id: string; status: BookingStatus }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  if (!isPaymentStatus(status)) return fail(400, "Unknown payment status.");
  if (method !== undefined && !isPaymentMethod(method)) return fail(400, "Unknown payment method.");
  const { rows } = await db().query(
    `UPDATE bookings SET
        payment_status = $2,
        payment_method = COALESCE($3, payment_method),
        payment_ref    = COALESCE($4, payment_ref),
        paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, now()) ELSE NULL END,
        -- Pending ⇄ confirmed follows the payment (see activeBookingStatus); cancelled stays cancelled.
        status = CASE
          WHEN status = 'cancelled' THEN status
          WHEN COALESCE($3, payment_method) <> 'cash' AND amount > 0 AND $2 IN ('unpaid', 'for_verification') THEN 'pending'
          ELSE 'confirmed' END
      WHERE id = $1 RETURNING id, status`,
    [id, status, method ?? null, ref === undefined ? null : cleanRef(ref)]
  );
  if (!rows[0]) return fail(404, "Booking not found.");
  return { ok: true, data: { id, status: rows[0].status as BookingStatus } };
}
