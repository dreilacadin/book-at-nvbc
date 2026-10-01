import { db } from "./db";
import { notifyCustomerMessage } from "./customer-notify";
import { notifyStaff } from "./notify";
import { publicName } from "./format";

// Messages between a customer and staff about one booking. Customers are identified by the
// booking code (like everything else on My booking); staff by their login. Server only.

export const MAX_MESSAGE = 1000;

export type Message = { id: number; from: "customer" | "staff"; name: string; body: string; at: string; read: boolean };

type Row = { id: string; sender_kind: "customer" | "staff"; sender_name: string; body: string; created_at: string; read_at: string | null };
const toMessage = (r: Row): Message => ({
  id: Number(r.id), from: r.sender_kind, name: r.sender_name, body: r.body, at: r.created_at, read: r.read_at !== null,
});

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

function cleanBody(raw: unknown): string | Fail {
  const body = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : "";
  if (!body) return fail(400, "Type a message first.");
  if (body.length > MAX_MESSAGE) return fail(400, `Messages can be up to ${MAX_MESSAGE} characters.`);
  return body;
}

async function thread(bookingId: string): Promise<Message[]> {
  const { rows } = await db().query<Row>(
    `SELECT id, sender_kind, sender_name, body, created_at, read_at FROM booking_messages WHERE booking_id = $1 ORDER BY id`,
    [bookingId]
  );
  return rows.map(toMessage);
}

async function byCode(code: string) {
  const { rows } = await db().query<{ id: string; player_name: string }>(
    `SELECT id, player_name FROM bookings WHERE cancel_code = $1`,
    [code]
  );
  return rows[0] ?? null;
}

/** The customer's view: the whole thread. Marks staff messages as read by them. */
export async function customerThread(code: string): Promise<{ ok: true; data: { messages: Message[] } } | Fail> {
  const b = await byCode(code);
  if (!b) return fail(404, "No booking found with that code.");
  await db().query(
    `UPDATE booking_messages SET read_at = now() WHERE booking_id = $1 AND sender_kind = 'staff' AND read_at IS NULL`,
    [b.id]
  );
  return { ok: true, data: { messages: await thread(b.id) } };
}

/** A customer sends a message about their booking. Staff are notified. */
export async function customerSend(code: string, raw: unknown): Promise<{ ok: true; data: { messages: Message[] } } | Fail> {
  const body = cleanBody(raw);
  if (typeof body !== "string") return body;
  const b = await byCode(code);
  if (!b) return fail(404, "No booking found with that code.");
  // Keep it a conversation: at most 10 messages from the customer in 10 minutes.
  const { rows: recent } = await db().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM booking_messages
      WHERE booking_id = $1 AND sender_kind = 'customer' AND created_at > now() - interval '10 minutes'`,
    [b.id]
  );
  if (recent[0].n >= 10) return fail(429, "You've sent several messages — please wait a few minutes for staff to reply.");
  await db().query(
    `INSERT INTO booking_messages (booking_id, sender_kind, sender_name, body) VALUES ($1, 'customer', $2, $3)`,
    [b.id, b.player_name, body]
  );
  const short = body.length > 160 ? `${body.slice(0, 157)}…` : body;
  await notifyStaff([{
    kind: "message",
    title: `Message — ${b.player_name} (${code})`,
    pushTitle: `Message — ${publicName(b.player_name)}`,
    body: short,
    bookingCode: code,
  }]);
  return { ok: true, data: { messages: await thread(b.id) } };
}

/** Staff view of a booking's thread. Marks the customer's messages as read. */
export async function staffThread(bookingId: string): Promise<{ ok: true; data: { messages: Message[] } } | Fail> {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return fail(400, "Invalid booking id.");
  await db().query(
    `UPDATE booking_messages SET read_at = now() WHERE booking_id = $1 AND sender_kind = 'customer' AND read_at IS NULL`,
    [bookingId]
  );
  return { ok: true, data: { messages: await thread(bookingId) } };
}

/** Staff reply (or start a conversation). The customer is notified by push and/or email. */
export async function staffSend(bookingId: string, raw: unknown, by: string): Promise<{ ok: true; data: { messages: Message[] } } | Fail> {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return fail(400, "Invalid booking id.");
  const body = cleanBody(raw);
  if (typeof body !== "string") return body;
  const { rows } = await db().query<{ id: string }>(
    `INSERT INTO booking_messages (booking_id, sender_kind, sender_name, body)
     SELECT id, 'staff', $2, $3 FROM bookings WHERE id = $1 RETURNING id`,
    [bookingId, by.slice(0, 60) || "Staff", body]
  );
  if (!rows[0]) return fail(404, "Booking not found.");
  // Answering counts as reading what the customer wrote.
  await db().query(
    `UPDATE booking_messages SET read_at = now() WHERE booking_id = $1 AND sender_kind = 'customer' AND read_at IS NULL`,
    [bookingId]
  );
  notifyCustomerMessage(bookingId, Number(rows[0].id), by, body);
  return { ok: true, data: { messages: await thread(bookingId) } };
}
