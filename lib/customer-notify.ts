import { after } from "next/server";
import webpush from "web-push";
import { db } from "./db";
import { emailSender, sendEmail } from "./mailer";
import { pushConfig, setupVapid } from "./notify";
import { customerNotice, isEmail, REMINDER_MINUTES, type CustomerNoticeKind, type NoticeBooking } from "./customer-messages";

// Notifications for customers about their own booking: payment confirmed, payment rejected, and
// "your court time is coming up". Sent by push (to devices that asked on the booking page) and by
// email (when the booking has an email address). Server only; never throws into the caller.

/** The site's address for links in emails. */
export function siteOrigin(): string {
  const url =
    process.env.SITE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return url.replace(/\/+$/, "");
}

/** The booking's page. The code goes after "#", so it never reaches server logs. */
export const bookingPath = (code: string) => `/my-booking#${code}`;

type Row = {
  id: string; code: string; name: string; court_name: string; date: string; start_hour: number; end_hour: number;
  amount: number; payment_status: string; payment_method: string; status: string; rejected_note: string;
  pay_by: string | null; customer_email: string;
};
const ROW_SQL = `b.id, b.cancel_code AS code, b.player_name AS name, c.name AS court_name, b.booking_date AS date,
  b.start_hour, b.end_hour, b.amount, b.payment_status, b.payment_method, b.status, b.rejected_note, b.pay_by, b.customer_email`;

const manilaClock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", hour12: true });

async function deliver(kind: CustomerNoticeKind, r: Row, extra: { message?: string; from?: string; email?: boolean } = {}): Promise<void> {
  const b: NoticeBooking = {
    code: r.code, name: r.name, courtName: r.court_name, date: r.date, startHour: r.start_hour, endHour: r.end_hour,
    amount: Number(r.amount), paymentStatus: r.payment_status, paymentMethod: r.payment_method, status: r.status,
    rejectedNote: r.rejected_note,
  };
  const n = customerNotice(kind, b, {
    link: siteOrigin() + bookingPath(r.code), payByClock: r.pay_by ? manilaClock(r.pay_by) : undefined, message: extra.message, from: extra.from,
  });

  const { rows: subs } = await db().query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM customer_push_subscriptions WHERE booking_id = $1`,
    [r.id]
  );
  if (subs.length && setupVapid()) {
    const payload = JSON.stringify({ title: n.title, body: n.body, url: bookingPath(r.code), tag: `nvbc-${r.code}` });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600 });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          // 404/410: the browser dropped the subscription — forget it.
          if (code === 404 || code === 410)
            await db().query(`DELETE FROM customer_push_subscriptions WHERE endpoint = $1`, [s.endpoint]);
          else console.error("customer push failed", code ?? e);
        }
      })
    );
  }
  if (r.customer_email && extra.email !== false && emailSender()) {
    try {
      await sendEmail(r.customer_email, n.subject, n.text);
    } catch (e) {
      console.error("customer email failed", e instanceof Error ? e.message : e);
    }
  }
}

/** Runs after the response is sent, so staff and players never wait on push or email. */
function later(job: () => Promise<unknown>) {
  const run = () => job().catch((e) => console.error("customer notification failed", e));
  try {
    after(run);
  } catch {
    void run(); // outside a request (shouldn't happen): best effort
  }
}

/** Tells the customer their payment was confirmed or rejected. */
export function notifyCustomer(bookingId: string, kind: "confirmed" | "rejected"): void {
  later(async () => {
    const { rows } = await db().query<Row>(`SELECT ${ROW_SQL} FROM bookings b JOIN courts c ON c.id = b.court_id WHERE b.id = $1`, [bookingId]);
    if (rows[0]) await deliver(kind, rows[0]);
  });
}

/**
 * Tells the customer staff sent them a message. Push every time; email only for the first of a
 * quick burst (no other staff message in the last few minutes), so a chat doesn't flood their inbox.
 */
export function notifyCustomerMessage(bookingId: string, messageId: number, from: string, message: string): void {
  later(async () => {
    const { rows } = await db().query<Row & { recent: number }>(
      `SELECT ${ROW_SQL},
              (SELECT count(*)::int FROM booking_messages m WHERE m.booking_id = b.id AND m.sender_kind = 'staff'
                  AND m.id <> $2 AND m.created_at > now() - interval '5 minutes') AS recent
         FROM bookings b JOIN courts c ON c.id = b.court_id WHERE b.id = $1`,
      [bookingId, messageId]
    );
    if (rows[0]) await deliver("message", rows[0], { message, from, email: rows[0].recent === 0 });
  });
}

/**
 * Sends "your court time is coming up" REMINDER_MINUTES before the start, once per booking, to
 * customers who turned on notifications or gave an email. Skips bookings made shortly before
 * their start (they just booked). Each booking is claimed with an UPDATE, so two servers never
 * send the same reminder. Runs when bookings are looked at (at most once a minute per server)
 * and from /api/cron/reminders.
 */
let lastReminders = 0;
export async function sendUpcomingReminders(force = false): Promise<number> {
  if (!force && Date.now() - lastReminders < 60_000) return 0;
  lastReminders = Date.now();
  const start = `((b.booking_date + make_interval(mins => (b.start_hour * 60)::int)) AT TIME ZONE 'Asia/Manila')`;
  const { rows } = await db().query<Row>(
    `UPDATE bookings b SET reminder_sent_at = now()
       FROM courts c
      WHERE c.id = b.court_id AND b.status <> 'cancelled' AND b.reminder_sent_at IS NULL
        AND b.booking_date BETWEEN (now() AT TIME ZONE 'Asia/Manila')::date - 1 AND (now() AT TIME ZONE 'Asia/Manila')::date + 1
        AND ${start} > now() AND ${start} <= now() + make_interval(mins => $1)
        AND b.created_at <= ${start} - make_interval(mins => $1 + 15)
        AND (b.customer_email <> '' OR EXISTS (SELECT 1 FROM customer_push_subscriptions s WHERE s.booking_id = b.id))
      RETURNING ${ROW_SQL}`,
    [REMINDER_MINUTES]
  );
  for (const r of rows) await deliver("upcoming", r);
  return rows.length;
}

/** Checks for due reminders after the response (throttled). */
export function scheduleReminders(): void {
  if (Date.now() - lastReminders < 60_000) return;
  later(() => sendUpcomingReminders());
}

// --- The customer's settings, by booking code (whoever has the code manages the booking) --------

async function bookingIdByCode(code: string): Promise<string | null> {
  const { rows } = await db().query<{ id: string }>(`SELECT id FROM bookings WHERE cancel_code = $1 AND status <> 'cancelled'`, [code]);
  return rows[0]?.id ?? null;
}

export async function customerAlerts(code: string, endpoint: unknown) {
  const { rows } = await db().query<{ id: string; customer_email: string }>(
    `SELECT id, customer_email FROM bookings WHERE cancel_code = $1`,
    [code]
  );
  if (!rows[0]) return null;
  const on =
    typeof endpoint === "string" && endpoint
      ? (await db().query(`SELECT 1 FROM customer_push_subscriptions WHERE booking_id = $1 AND endpoint = $2`, [rows[0].id, endpoint])).rowCount! > 0
      : false;
  return { email: rows[0].customer_email, pushOn: on, push: pushConfig(), emailReady: emailSender() !== null };
}

export async function saveCustomerPush(code: string, sub: unknown): Promise<string | null> {
  const s = (sub ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof s.endpoint === "string" ? s.endpoint : "";
  const p256dh = typeof s.keys?.p256dh === "string" ? s.keys.p256dh : "";
  const auth = typeof s.keys?.auth === "string" ? s.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100)
    return "This device couldn't be registered for notifications.";
  const id = await bookingIdByCode(code);
  if (!id) return "This booking can't get notifications (it may have been cancelled).";
  await db().query(
    `INSERT INTO customer_push_subscriptions (booking_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
     ON CONFLICT (booking_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [id, endpoint, p256dh, auth]
  );
  // At most 5 devices per booking: keep the newest.
  await db().query(
    `DELETE FROM customer_push_subscriptions WHERE booking_id = $1 AND endpoint NOT IN
       (SELECT endpoint FROM customer_push_subscriptions WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 5)`,
    [id]
  );
  return null;
}

export async function removeCustomerPush(code: string, endpoint: unknown): Promise<void> {
  if (typeof endpoint !== "string") return;
  await db().query(
    `DELETE FROM customer_push_subscriptions WHERE endpoint = $2 AND booking_id = (SELECT id FROM bookings WHERE cancel_code = $1)`,
    [code, endpoint]
  );
}

/** Sets (or clears, with "") the email for booking updates. */
export async function setCustomerEmail(code: string, raw: unknown): Promise<string | null> {
  const email = typeof raw === "string" ? raw.trim() : "";
  if (email && !isEmail(email)) return "Please enter a valid email address.";
  const { rowCount } = await db().query(
    `UPDATE bookings SET customer_email = $2 WHERE cancel_code = $1 AND status <> 'cancelled'`,
    [code, email]
  );
  return rowCount ? null : "This booking can't get updates (it may have been cancelled).";
}
