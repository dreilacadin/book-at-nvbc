import { db, getSettings } from "./db";
import { findBlockConflict } from "./blocks";
import { blocksOn } from "./court-blocks";
import { CUSTOMER, logBooking } from "./booking-history";
import { minutesUntilStart, RELEASE_MINUTES } from "./booking-policy";
import { formatDateLong, formatRange, halfHours, publicName, SLOT_HOURS } from "./format";
import { notifyStaff } from "./notify";
import { computePrice, rateFor, ratesForDate, type RateType } from "./pricing";
import { courtAllowed, sportEmoji, sportLabel } from "./sports";
import { addDays, daysBetween, isValidDate, nowAtFacility } from "./time";
import { holidayOn } from "./holidays";
import { closedAllDay, closedRanges, closureTimeText, overlapsClosure } from "./closures";
import { scheduleWaitlistCheck } from "./waitlist";

// Customers moving their own booking (My booking → Change time): to another free court or time of
// the same sport/activity, the same length and the same price, up to the hours before the start
// set in Settings, at most the number of times set there. Anything else goes through staff.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

type Current = {
  id: string; code: string; name: string; court_id: number; court_name: string; activity: string; date: string;
  start_hour: number; end_hour: number; amount: number; rate_type: RateType; status: string; phase: string | null;
  reschedule_count: number; group_id: string | null; members: number; membership_expires: string | null;
  coaching_status: string | null;
};

async function current(code: string): Promise<Current | null> {
  const { rows } = await db().query<Current>(
    `SELECT b.id, b.cancel_code AS code, b.player_name AS name, b.court_id, c.name AS court_name,
            COALESCE(b.activity, c.sport) AS activity, b.booking_date AS date, b.start_hour::float8 AS start_hour,
            b.end_hour::float8 AS end_hour, b.amount::float8 AS amount, b.rate_type, b.status, b.phase, b.reschedule_count, b.group_id,
            b.coaching_status,
            (SELECT count(*)::int FROM bookings g WHERE g.group_id = b.id AND g.status <> 'cancelled') AS members,
            m.expires_on AS membership_expires
       FROM bookings b JOIN courts c ON c.id = b.court_id LEFT JOIN memberships m ON m.id = b.membership_id
      WHERE b.cancel_code = $1`,
    [code]
  );
  return rows[0] ?? null;
}

/** Why this booking can't be moved online right now, or null if it can. */
function blocker(b: Current, settings: Awaited<ReturnType<typeof getSettings>>): string | null {
  if (settings.reschedule_max <= 0) return "Changing the time online isn't available — please contact the front desk.";
  if (b.status === "cancelled") return "This booking is cancelled.";
  if (b.group_id || b.members > 0) return "Group bookings can't be moved online — please message staff or contact the front desk.";
  if (b.phase) return "This booking has already been played.";
  if (b.coaching_status === "requested" || b.coaching_status === "accepted")
    return "This booking has a coaching session — please message staff or contact the front desk to change the time.";
  if (b.reschedule_count >= settings.reschedule_max)
    return `This booking has already been moved ${b.reschedule_count === 1 ? "once" : `${b.reschedule_count} times`} — please contact the front desk for more changes.`;
  if (minutesUntilStart(b.date, b.start_hour, nowAtFacility()) < settings.reschedule_hours * 60)
    return `Times can be changed up to ${settings.reschedule_hours} hour${settings.reschedule_hours === 1 ? "" : "s"} before the start — please contact the front desk.`;
  return null;
}

export type MoveOption = { courtId: number; courtName: string; start: number };

/**
 * Free times on `date` this booking could move to: same sport/activity, same length, same price.
 * `rules` tells the page what's allowed (or why not).
 */
export async function rescheduleOptions(code: string, rawDate: unknown) {
  const settings = await getSettings();
  const b = await current(code);
  if (!b) return fail(404, "No booking found with that code.");
  const today = nowAtFacility();
  const lastDate = addDays(today.date, settings.booking_window_days);
  const why = blocker(b, settings);
  const base = {
    rules: { hours: settings.reschedule_hours, max: settings.reschedule_max, used: b.reschedule_count, firstDate: today.date, lastDate },
    blocked: why,
  };
  if (why || rawDate === undefined) return { ok: true as const, data: { ...base, options: [] as MoveOption[] } };
  if (!isValidDate(rawDate) || rawDate < today.date || daysBetween(today.date, rawDate) > settings.booking_window_days)
    return fail(400, "Please choose a date you can book.");
  const date = rawDate;
  const hours = b.end_hour - b.start_hour;
  const holiday = await holidayOn(date);
  const closedTimes = closedRanges(holiday, 0, 24);
  if (closedAllDay(holiday, settings.open_hour, settings.close_hour))
    return { ok: true as const, data: { ...base, options: [], note: `NVBC is closed that day (${holiday!.name}).` } };
  if (!samePrice(b, settings, date, holiday?.kind === "holiday"))
    return { ok: true as const, data: { ...base, options: [], note: "Prices are different on this day, so your booking can't be moved to it online." } };

  const [courts, taken, blocks] = await Promise.all([
    db().query<{ id: number; name: string; sport: string }>(`SELECT id, name, sport FROM courts WHERE is_active ORDER BY sort_order, id`),
    db().query<{ court_id: number; slot_hour: number }>(
      `SELECT court_id, slot_hour::float8 AS slot_hour FROM booking_slots WHERE slot_date = $1 AND booking_id <> $2`,
      [date, b.id]
    ),
    blocksOn(date),
  ]);
  const busy = new Set(taken.rows.map((t) => `${t.court_id}:${t.slot_hour}`));
  const options: MoveOption[] = [];
  for (const c of courts.rows.filter((c) => courtAllowed(b.activity, c, settings.activity_courts))) {
    for (const start of halfHours(settings.open_hour, settings.close_hour - hours)) {
      if (date === b.date && start === b.start_hour && c.id === b.court_id) continue; // where it is now
      if (minutesUntilStart(date, start, today) <= RELEASE_MINUTES) continue;
      if (halfHours(start, start + hours - SLOT_HOURS).some((h) => busy.has(`${c.id}:${h}`))) continue;
      if (findBlockConflict(blocks, c.id, date, start, start + hours)) continue;
      if (overlapsClosure(closedTimes, start, start + hours)) continue; // closed for part of the day
      options.push({ courtId: c.id, courtName: c.name, start });
    }
  }
  options.sort((x, y) => x.start - y.start || Number(y.courtId === b.court_id) - Number(x.courtId === b.court_id));
  return { ok: true as const, data: { ...base, options } };
}

function samePrice(b: Current, settings: Awaited<ReturnType<typeof getSettings>>, date: string, holiday: boolean): boolean {
  const plan = settings.rate_plans[b.activity];
  if (!plan) return false;
  const rates = ratesForDate(plan, date, holiday);
  const total = computePrice(rateFor(rates, b.rate_type), b.end_hour - b.start_hour, rates.regular).total;
  return Math.abs(total - b.amount) < 0.01;
}

/** Moves the booking. Everything is checked again here, inside one transaction. */
export async function rescheduleByCode(code: string, input: Record<string, unknown>) {
  const settings = await getSettings();
  const b = await current(code);
  if (!b) return fail(404, "No booking found with that code.");
  const why = blocker(b, settings);
  if (why) return fail(400, why);
  const date = input.date;
  const courtId = Number(input.courtId);
  const start = Number(input.start);
  const hours = b.end_hour - b.start_hour;
  const today = nowAtFacility();
  if (!isValidDate(date) || date < today.date || daysBetween(today.date, date) > settings.booking_window_days)
    return fail(400, "Please choose a date you can book.");
  if (!Number.isInteger(courtId) || !halfHours(settings.open_hour, settings.close_hour - hours).includes(start))
    return fail(400, "Please choose one of the available times.");
  if (minutesUntilStart(date, start, today) <= RELEASE_MINUTES) return fail(400, "That time is about to start — please pick a later one.");
  const holiday = await holidayOn(date);
  if (overlapsClosure(closedRanges(holiday, 0, 24), start, start + hours))
    return fail(400, `NVBC is closed then (${holiday!.name}: ${closureTimeText(holiday!)}).`);
  if (!samePrice(b, settings, date, holiday?.kind === "holiday")) return fail(400, "That day has different prices, so the booking can't be moved there online.");
  if (b.rate_type === "member" && b.membership_expires && b.membership_expires < date)
    return fail(400, "Your membership ends before that date, so the member rate can't be used then.");

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows: cs } = await client.query<{ id: number; name: string; sport: string }>(
      `SELECT id, name, sport FROM courts WHERE id = $1 AND is_active`,
      [courtId]
    );
    const court = cs[0];
    if (!court || !courtAllowed(b.activity, court, settings.activity_courts)) {
      await client.query("ROLLBACK");
      return fail(400, `That court can't be booked for ${sportLabel(b.activity)}.`);
    }
    if (findBlockConflict(await blocksOn(date), courtId, date, start, start + hours)) {
      await client.query("ROLLBACK");
      return fail(409, "That time is reserved — please pick another.");
    }
    // Lock the booking, check it hasn't changed since it was read, then move it.
    const { rows: locked } = await client.query<{ status: string; reschedule_count: number }>(
      `SELECT status, reschedule_count FROM bookings WHERE id = $1 FOR UPDATE`,
      [b.id]
    );
    if (locked[0]?.status !== b.status || locked[0]?.reschedule_count !== b.reschedule_count) {
      await client.query("ROLLBACK");
      return fail(409, "This booking just changed — please reload and try again.");
    }
    await client.query(`DELETE FROM booking_slots WHERE booking_id = $1`, [b.id]);
    await client.query(
      `INSERT INTO booking_slots (court_id, slot_date, slot_hour, booking_id)
       SELECT $1, $2, h, $3 FROM generate_series($4::numeric, $5::numeric - 0.5, 0.5) AS h`,
      [courtId, date, b.id, start, start + hours]
    );
    await client.query(
      `UPDATE bookings SET court_id = $2, booking_date = $3, start_hour = $4, end_hour = $5,
              reschedule_count = reschedule_count + 1, reminder_sent_at = NULL
        WHERE id = $1`,
      [b.id, courtId, date, start, start + hours]
    );
    await client.query("COMMIT");
    const from = `${b.court_name}, ${formatDateLong(b.date)}, ${formatRange(b.start_hour, b.end_hour)}`;
    const to = `${court.name}, ${formatDateLong(date)}, ${formatRange(start, start + hours)}`;
    await logBooking({ id: b.id }, CUSTOMER, "Rescheduled", `${from} → ${to}`);
    await notifyStaff([{
      kind: "booking_moved",
      title: `Rescheduled — ${b.name} (${b.code})`,
      pushTitle: `Rescheduled — ${publicName(b.name)}`,
      body: `${sportEmoji(b.activity)} ${from} → ${to}`,
      bookingCode: b.code,
    }]);
    scheduleWaitlistCheck(b.date); // the old time is free now
    return { ok: true as const, data: { date, courtName: court.name, startHour: start, endHour: start + hours } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if ((e as { code?: string }).code === "23505") return fail(409, "Someone just booked that time — please pick another.");
    throw e;
  } finally {
    client.release();
  }
}
