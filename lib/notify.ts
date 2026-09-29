import { after } from "next/server";
import webpush from "web-push";
import { db } from "./db";
import { ALL_KINDS, isNotifyKind, pushSummary, type AdminEvent, type NotifyKind } from "./notify-kinds";

// Staff notifications: events are stored for the admin panel's bell, and pushed to the phones /
// computers of staff who turned push notifications on. Server only.

export type NewEvent = {
  kind: NotifyKind;
  title: string; // shown in the admin panel (staff only)
  pushTitle: string; // shown on devices, maybe on a locked screen: first name + last initial only
  body: string;
  bookingCode?: string | null;
  membershipId?: string | null;
};

/** "owner" or the staff account id — whose read position / preferences / devices. */
export const whoOf = (session: { id: number | null }) => (session.id === null ? "owner" : String(session.id));

export function pushConfig(): { publicKey: string } | null {
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  return pub && priv ? { publicKey: pub } : null;
}

/**
 * Records events for staff and sends push notifications after the response is sent. Never throws:
 * a notification problem must not break a booking.
 */
export async function notifyStaff(events: NewEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const { rows } = await db().query<{ id: number }>(
      `INSERT INTO admin_events (kind, title, push_title, body, booking_code, membership_id)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::uuid[]) RETURNING id`,
      [
        events.map((e) => e.kind), events.map((e) => e.title.slice(0, 160)), events.map((e) => e.pushTitle.slice(0, 120)),
        events.map((e) => e.body.slice(0, 300)), events.map((e) => e.bookingCode ?? null), events.map((e) => e.membershipId ?? null),
      ]
    );
    const ids = rows.map((r) => r.id);
    const send = () => sendPushes(ids).catch((e) => console.error("push failed", e));
    try {
      after(send); // runs after the response, without slowing the player down
    } catch {
      void send(); // outside a request (shouldn't happen): best effort
    }
    // Keep the table small: drop events older than 60 days now and then.
    if (Math.random() < 0.02) await db().query(`DELETE FROM admin_events WHERE created_at < now() - interval '60 days'`);
  } catch (e) {
    console.error("notifyStaff failed", e);
  }
}

async function sendPushes(eventIds: number[]): Promise<void> {
  const cfg = pushConfig();
  if (!cfg || eventIds.length === 0) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || "mailto:admin@example.com",
    cfg.publicKey,
    process.env.VAPID_PRIVATE_KEY!.trim()
  );
  const { rows: events } = await db().query<{ kind: string; push_title: string; body: string; booking_code: string | null; membership_id: string | null }>(
    `SELECT kind, push_title, body, booking_code, membership_id::text FROM admin_events WHERE id = ANY($1::bigint[]) ORDER BY id`,
    [eventIds]
  );
  // Devices of staff who are still allowed in (owner, or an active account), with their kinds.
  const { rows: subs } = await db().query<{ endpoint: string; p256dh: string; auth: string; kinds: string[] }>(
    `SELECT s.endpoint, s.p256dh, s.auth, COALESCE(n.kinds, $1::text[]) AS kinds
       FROM push_subscriptions s
       LEFT JOIN admin_notify_state n ON n.who = s.who
      WHERE s.who = 'owner' OR s.who IN (SELECT id::text FROM admin_users WHERE is_active)`,
    [ALL_KINDS]
  );
  await Promise.all(
    subs.map(async (s) => {
      const wanted = events.filter((e) => s.kinds.includes(e.kind));
      const msg = pushSummary(wanted);
      if (!msg) return;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 3600 });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // 404/410: the device unsubscribed or the browser dropped it — forget it.
        if (code === 404 || code === 410) await db().query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [s.endpoint]);
        else console.error("push to one device failed", code ?? e);
      }
    })
  );
}

/** Latest notifications for one staff member, and their settings. A first visit starts "all read". */
export async function getNotifications(who: string) {
  await db().query(
    `INSERT INTO admin_notify_state (who, last_seen_id)
     SELECT $1, COALESCE((SELECT max(id) FROM admin_events), 0)
     ON CONFLICT (who) DO NOTHING`,
    [who]
  );
  const { rows: state } = await db().query<{ last_seen_id: string; kinds: string[] }>(
    `SELECT last_seen_id, kinds FROM admin_notify_state WHERE who = $1`,
    [who]
  );
  const lastSeen = Number(state[0].last_seen_id);
  const kinds = state[0].kinds.filter(isNotifyKind);
  const { rows } = await db().query<AdminEvent & { id: string }>(
    `SELECT id, kind, title, body, booking_code, membership_id, created_at FROM admin_events
      WHERE kind = ANY($1::text[]) ORDER BY id DESC LIMIT 30`,
    [kinds]
  );
  const events = rows.map((r) => ({ ...r, id: Number(r.id) }));
  const unread = (
    await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM admin_events WHERE id > $1 AND kind = ANY($2::text[])`, [lastSeen, kinds])
  ).rows[0].n;
  const devices = (await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM push_subscriptions WHERE who = $1`, [who])).rows[0].n;
  return { events, unread, lastSeen, kinds, devices, push: pushConfig() };
}

export async function markSeen(who: string, upTo: unknown) {
  const n = Number(upTo);
  if (!Number.isFinite(n)) return;
  await db().query(`UPDATE admin_notify_state SET last_seen_id = GREATEST(last_seen_id, $2) WHERE who = $1`, [who, n]);
}

export async function setKinds(who: string, kinds: unknown) {
  const list = Array.isArray(kinds) ? [...new Set(kinds.filter(isNotifyKind))] : [];
  await db().query(
    `INSERT INTO admin_notify_state (who, kinds) VALUES ($1, $2::text[])
     ON CONFLICT (who) DO UPDATE SET kinds = EXCLUDED.kinds`,
    [who, list]
  );
  return list;
}

type Sub = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

export async function savePushSubscription(who: string, sub: unknown, device: unknown): Promise<string | null> {
  const s = (sub ?? {}) as Sub;
  const endpoint = typeof s.endpoint === "string" ? s.endpoint : "";
  const p256dh = typeof s.keys?.p256dh === "string" ? s.keys.p256dh : "";
  const auth = typeof s.keys?.auth === "string" ? s.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return "That device couldn't be registered.";
  // The same device re-subscribing (or a different staff member logging in on it) takes it over.
  await db().query(
    `INSERT INTO push_subscriptions (who, endpoint, p256dh, auth, device) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET who = EXCLUDED.who, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, device = EXCLUDED.device`,
    [who, endpoint, p256dh, auth, typeof device === "string" ? device.slice(0, 120) : ""]
  );
  return null;
}

export async function deletePushSubscription(who: string, endpoint: unknown) {
  if (typeof endpoint !== "string") return;
  await db().query(`DELETE FROM push_subscriptions WHERE who = $1 AND endpoint = $2`, [who, endpoint]);
}

/** Sends a test push to this staff member's devices. */
export async function testPush(who: string): Promise<{ sent: number; error?: string }> {
  const cfg = pushConfig();
  if (!cfg) return { sent: 0, error: "Push notifications aren't set up on the server (VAPID keys)." };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || "mailto:admin@example.com", cfg.publicKey, process.env.VAPID_PRIVATE_KEY!.trim());
  const { rows } = await db().query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE who = $1`,
    [who]
  );
  let sent = 0;
  for (const s of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: "NVBC notifications are on ✓", body: "You'll be notified here about bookings and payments.", url: "/admin", tag: "nvbc-test" })
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db().query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [s.endpoint]);
    }
  }
  return { sent };
}
