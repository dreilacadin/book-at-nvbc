import webpush from "web-push";
import { db, getSettings } from "./db";
import { findBlockConflict } from "./blocks";
import { blocksOn } from "./court-blocks";
import { minutesUntilStart, RELEASE_MINUTES } from "./booking-policy";
import { later, siteOrigin } from "./customer-notify";
import { isEmail } from "./customer-messages";
import { formatDateLong, formatRange, isHalfHour } from "./format";
import { emailSender, sendEmail } from "./mailer";
import { setupVapid } from "./notify";
import { courtAllowed, isActivity, sportEmoji, sportLabel } from "./sports";
import { holidayOn } from "./holidays";
import { isValidDate, nowAtFacility } from "./time";

// Waitlist: "tell me if this time opens up". When a booking is cancelled, released or moved,
// everyone waiting for a time that's now free on a court that can be used for their sport or
// activity is told at once (push and/or email); whoever books first gets it. Server only.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

/** Someone asks to be told when a time opens up. */
export async function joinWaitlist(input: Record<string, unknown>): Promise<{ ok: true; data: { id: number } } | Fail> {
  const settings = await getSettings();
  const activity = input.sport;
  const date = input.date;
  const start = Number(input.start);
  const end = Number(input.end);
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const sub = (input.subscription ?? null) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = typeof sub?.endpoint === "string" && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length <= 1000 ? sub.endpoint : null;
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh.slice(0, 200) : null;
  const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth.slice(0, 100) : null;

  if (!isActivity(activity) || !settings.rate_plans[activity]) return fail(400, "Unknown sport or activity.");
  if (!isValidDate(date)) return fail(400, "Please choose a valid date.");
  if (!isHalfHour(start) || !isHalfHour(end) || end <= start || end - start > 12) return fail(400, "Please choose a valid time.");
  if (minutesUntilStart(date, start, nowAtFacility()) <= RELEASE_MINUTES) return fail(400, "That time is about to start.");
  if (email && !isEmail(email)) return fail(400, "Please check your email address.");
  const holiday = await holidayOn(date);
  if (holiday?.closed) return fail(400, `NVBC is closed that day (${holiday.name}).`);
  if (!email && !(endpoint && p256dh && auth)) return fail(400, "Turn on notifications or enter an email so we can tell you.");

  // A court is already free for that whole time: no need to wait.
  if (await freeCourt(activity, date, start, end))
    return fail(409, "Good news — a court is free for that time right now. Pick an open slot on the grid to book it.");

  // Already waiting for this exact time (same device or email): nothing to add.
  const { rows: dup } = await db().query<{ id: string }>(
    `SELECT id FROM waitlist
      WHERE notified_at IS NULL AND activity = $1 AND slot_date = $2 AND start_hour = $3 AND end_hour = $4
        AND (($5 <> '' AND email = $5) OR ($6::text IS NOT NULL AND endpoint = $6))`,
    [activity, date, start, end, email, endpoint]
  );
  if (dup[0]) return { ok: true, data: { id: Number(dup[0].id) } };
  const { rows } = await db().query<{ id: string }>(
    `INSERT INTO waitlist (activity, slot_date, start_hour, end_hour, email, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [activity, date, start, end, email, endpoint, p256dh, auth]
  );
  // Now and then, forget requests for times that have passed.
  if (Math.random() < 0.05) await db().query(`DELETE FROM waitlist WHERE slot_date < (now() AT TIME ZONE 'Asia/Manila')::date - 1`);
  return { ok: true, data: { id: Number(rows[0].id) } };
}

/** A court that can be used for `activity` and is free (not booked or reserved) for the whole time, if any. */
async function freeCourt(activity: string, date: string, start: number, end: number): Promise<number | null> {
  const [settings, blocks, courts, taken] = await Promise.all([
    getSettings(),
    blocksOn(date),
    db().query<{ id: number; sport: string }>(`SELECT id, sport FROM courts WHERE is_active`),
    db().query<{ court_id: number; slot_hour: number }>(`SELECT court_id, slot_hour::float8 AS slot_hour FROM booking_slots WHERE slot_date = $1`, [date]),
  ]);
  const busy = new Set(taken.rows.map((t) => `${t.court_id}:${t.slot_hour}`));
  const c = courts.rows.find((c) => {
    if (!courtAllowed(activity, c, settings.activity_courts)) return false;
    for (let h = start; h < end; h += 0.5) if (busy.has(`${c.id}:${h}`)) return false;
    return !findBlockConflict(blocks, c.id, date, start, end);
  });
  return c?.id ?? null;
}

type Entry = {
  id: string; activity: string; slot_date: string; start_hour: number; end_hour: number;
  email: string; endpoint: string | null; p256dh: string | null; auth: string | null;
};

/**
 * Tells everyone waiting for a time on `date` that has opened up. Each request is answered once
 * (then it's done); requests for times starting within RELEASE_MINUTES are skipped.
 */
export async function checkWaitlist(date: string): Promise<number> {
  const { rows: waiting } = await db().query<Entry>(
    `SELECT id, activity, slot_date, start_hour::float8 AS start_hour, end_hour::float8 AS end_hour, email, endpoint, p256dh, auth
       FROM waitlist WHERE slot_date = $1 AND notified_at IS NULL`,
    [date]
  );
  if (!waiting.length) return 0;
  const now = nowAtFacility();
  let sent = 0;
  for (const e of waiting) {
    if (minutesUntilStart(date, e.start_hour, now) <= RELEASE_MINUTES) continue;
    if ((await freeCourt(e.activity, date, e.start_hour, e.end_hour)) === null) continue;
    // Claim it first, so two servers never send the same message.
    const { rowCount } = await db().query(`UPDATE waitlist SET notified_at = now() WHERE id = $1 AND notified_at IS NULL`, [e.id]);
    if (!rowCount) continue;
    await notify(e);
    sent++;
  }
  return sent;
}

async function notify(e: Entry) {
  const what = `${sportEmoji(e.activity)} ${sportLabel(e.activity)}`.trim();
  const when = `${formatDateLong(e.slot_date)}, ${formatRange(e.start_hour, e.end_hour)}`;
  const path = `/?sport=${encodeURIComponent(e.activity)}&date=${e.slot_date}`;
  const title = "A court just opened up!";
  const body = `${what} · ${when} is free now — book it before someone else does.`;
  if (e.endpoint && e.p256dh && e.auth && setupVapid()) {
    try {
      await webpush.sendNotification(
        { endpoint: e.endpoint, keys: { p256dh: e.p256dh, auth: e.auth } },
        JSON.stringify({ title, body, url: path, tag: `nvbc-wait-${e.id}` }),
        { TTL: 3600 }
      );
    } catch (err) {
      console.error("waitlist push failed", (err as { statusCode?: number }).statusCode ?? err);
    }
  }
  if (e.email && emailSender()) {
    try {
      await sendEmail(
        e.email,
        `A court opened up: ${sportLabel(e.activity)}, ${formatRange(e.start_hour, e.end_hour)}`,
        `Hi!\n\nGood news — the time you were waiting for is free now:\n\n${what}\n${when}\n\n` +
          `Everyone on the waitlist was told at the same time, so book it soon:\n${siteOrigin()}${path}\n\nNV Badminton Center`
      );
    } catch (err) {
      console.error("waitlist email failed", err instanceof Error ? err.message : err);
    }
  }
}

/** After a booking is cancelled, released or moved: check the waitlist for that day (after the response). */
export function scheduleWaitlistCheck(...dates: (string | null | undefined)[]) {
  for (const d of new Set(dates.filter((x): x is string => !!x))) later(() => checkWaitlist(d));
}
