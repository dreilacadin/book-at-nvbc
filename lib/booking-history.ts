import { db } from "./db";

// Booking history: who changed a booking, and when. Server only. Writing never throws — a log
// problem must not undo or block the change itself.

export type Actor = { name: string; kind: "staff" | "customer" | "system" };
export const CUSTOMER: Actor = { name: "Customer", kind: "customer" };
export const SYSTEM: Actor = { name: "System", kind: "system" };
export const staff = (name: string): Actor => ({ name: name.slice(0, 60) || "Staff", kind: "staff" });

export type HistoryEntry = {
  id: number; booking_code: string; at: string; actor: string; actor_kind: Actor["kind"]; action: string; details: string;
};

/** Records one change to a booking, found by its id or its code. */
export async function logBooking(where: { id: string } | { code: string }, actor: Actor, action: string, details = ""): Promise<void> {
  try {
    const byId = "id" in where;
    await db().query(
      `INSERT INTO booking_history (booking_id, booking_code, actor, actor_kind, action, details)
       SELECT id, cancel_code, $2, $3, $4, $5 FROM bookings WHERE ${byId ? "id = $1::uuid" : "cancel_code = $1"}`,
      [byId ? where.id : where.code, actor.name, actor.kind, action.slice(0, 60), details.slice(0, 1000)]
    );
  } catch (e) {
    console.error("booking history not saved", e);
  }
}

/** Records the same change for several bookings (e.g. automatic releases). */
export async function logBookings(ids: string[], actor: Actor, action: string, details = ""): Promise<void> {
  if (!ids.length) return;
  try {
    await db().query(
      `INSERT INTO booking_history (booking_id, booking_code, actor, actor_kind, action, details)
       SELECT id, cancel_code, $2, $3, $4, $5 FROM bookings WHERE id = ANY($1::uuid[])`,
      [ids, actor.name, actor.kind, action, details]
    );
  } catch (e) {
    console.error("booking history not saved", e);
  }
}

/** One booking's history, oldest first. */
export async function bookingHistory(bookingId: string): Promise<HistoryEntry[]> {
  const { rows } = await db().query<HistoryEntry & { id: string }>(
    `SELECT id, booking_code, at, actor, actor_kind, action, details FROM booking_history WHERE booking_id = $1 ORDER BY at, id`,
    [bookingId]
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/** Recent staff actions across all bookings (newest first), optionally by one staff member. */
export async function staffActivity(actor: string | null, limit = 100) {
  const { rows } = await db().query<HistoryEntry & { id: string; player_name: string | null; deleted: boolean }>(
    `SELECT h.id, h.booking_code, h.at, h.actor, h.actor_kind, h.action, h.details,
            b.player_name, (h.booking_id IS NULL) AS deleted
       FROM booking_history h LEFT JOIN bookings b ON b.id = h.booking_id
      WHERE h.actor_kind = 'staff' AND ($1::text IS NULL OR h.actor = $1)
      ORDER BY h.at DESC, h.id DESC LIMIT $2`,
    [actor, Math.min(Math.max(limit, 1), 500)]
  );
  const { rows: actors } = await db().query<{ actor: string }>(
    `SELECT actor FROM booking_history WHERE actor_kind = 'staff' GROUP BY actor ORDER BY max(at) DESC`
  );
  return { entries: rows.map((r) => ({ ...r, id: Number(r.id) })), actors: actors.map((a) => a.actor) };
}
