import { randomInt, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "./db";
import { logBooking, type Actor } from "./booking-history";
import { activeBookingStatus, type PaymentMethod, type PaymentStatus } from "./pricing";
import { allActivities, isActivity } from "./sports";
import { addDays, isPastSlot, isValidDate, nowAtFacility } from "./time";
import {
  defaultTerms,
  formatVoucherCode,
  hasBalance,
  isVoucherKind,
  isVoucherStatus,
  normalizeVoucherCode,
  splitDiscount,
  VOUCHER_CODE_ALPHABET_SIZE,
  voucherKindLabel,
  voucherProblem,
  voucherState,
  voucherValueLabel,
  type BookingVoucherInfo,
  type Voucher,
  type VoucherCourt,
  type VoucherKind,
  type VoucherState,
  type VoucherStatus,
} from "./voucher";

// Vouchers (Admin → Vouchers): creating and changing them, the public voucher page, and taking a
// voucher off a booking's price. Giving a voucher back when a booking is cancelled happens in the
// database (trigger bookings_voucher_on_status in db/schema.sql), so every way of cancelling does it.

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/[ \t]+/g, " ").slice(0, max) : "");
const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { maximumFractionDigits: 2 });

type Row = {
  id: string; code: string; kind: VoucherKind; value: string; max_discount: string | null; balance: string;
  max_uses: number; uses: number; status: VoucherStatus; valid_from: string | null; expires_on: string | null;
  sports: string[]; title: string; issued_to: string; note: string; terms: string; batch: string;
  created_by: string; created_at: string; updated_at: string;
};

export type AdminVoucher = Voucher & {
  id: string; note: string; batch: string; createdBy: string; createdAt: string; updatedAt: string;
  state: VoucherState;
  given: number; // pesos taken off bookings so far (not counting given back)
};

const toVoucher = (r: Row): Voucher => ({
  code: r.code, kind: r.kind, value: Number(r.value), maxDiscount: r.max_discount === null ? null : Number(r.max_discount),
  balance: Number(r.balance), maxUses: r.max_uses, uses: r.uses, status: r.status, validFrom: r.valid_from,
  expiresOn: r.expires_on, sports: r.sports ?? [], title: r.title, issuedTo: r.issued_to, terms: r.terms,
});

const toAdmin = (r: Row & { given?: string | null }, today: string): AdminVoucher => {
  const v = toVoucher(r);
  return {
    ...v, id: r.id, note: r.note, batch: r.batch, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    state: voucherState(v, today), given: Number(r.given ?? 0),
  };
};

const GIVEN_SQL = `(SELECT COALESCE(sum(u.amount), 0) FROM voucher_uses u WHERE u.voucher_id = v.id AND u.restored_at IS NULL AND NOT u.dropped) AS given`;

async function logVoucher(id: string, by: string, action: string, details = "", client?: PoolClient) {
  await (client ?? db()).query(
    `INSERT INTO voucher_events (voucher_id, actor, action, details) VALUES ($1, $2, $3, $4)`,
    [id, by.slice(0, 60) || "Staff", action, details.slice(0, 500)]
  );
}

// ---- Staff ------------------------------------------------------------------------------------

/** Vouchers for the admin list, newest first. `q`: a code, title, name or note. */
export async function listVouchers(q: unknown): Promise<AdminVoucher[]> {
  const search = text(q, 80);
  const code = normalizeVoucherCode(search);
  const { rows } = await db().query<Row & { given: string }>(
    `SELECT v.*, ${GIVEN_SQL} FROM vouchers v
      WHERE $1 = '' OR v.code = $2 OR v.title ILIKE '%' || $1 || '%' OR v.issued_to ILIKE '%' || $1 || '%'
         OR v.note ILIKE '%' || $1 || '%' OR v.batch = $1
      ORDER BY v.created_at DESC, v.code LIMIT 500`,
    [search, code ?? ""]
  );
  const today = nowAtFacility().date;
  return rows.map((r) => toAdmin(r, today));
}

/** Several vouchers by id (e.g. to print them), in the order given. */
export async function vouchersByIds(ids: string[]): Promise<AdminVoucher[]> {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  if (!valid.length) return [];
  const { rows } = await db().query<Row & { given: string }>(`SELECT v.*, ${GIVEN_SQL} FROM vouchers v WHERE v.id = ANY($1::uuid[])`, [valid]);
  const today = nowAtFacility().date;
  return valid.map((id) => rows.find((r) => r.id === id)).filter((r): r is Row & { given: string } => !!r).map((r) => toAdmin(r, today));
}

export type VoucherUse = {
  id: number; bookingCode: string; bookingId: string | null; date: string | null; court: string | null;
  amount: number; hours: number; usedBy: string; usedAt: string; restoredAt: string | null; removed: boolean; dropped: boolean;
  bookingStatus: string | null;
};
export type VoucherEvent = { at: string; actor: string; action: string; details: string };

/** One voucher with the bookings it was used on and its change history. */
export async function voucherDetail(id: string): Promise<Result<{ voucher: AdminVoucher; uses: VoucherUse[]; events: VoucherEvent[] }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid voucher.");
  const { rows } = await db().query<Row & { given: string }>(`SELECT v.*, ${GIVEN_SQL} FROM vouchers v WHERE v.id = $1`, [id]);
  if (!rows[0]) return fail(404, "Voucher not found.");
  const [uses, events] = await Promise.all([
    db().query<VoucherUse>(
      `SELECT u.id, u.booking_code AS "bookingCode", u.booking_id AS "bookingId", b.booking_date AS date, c.name AS court,
              u.amount::float8 AS amount, u.hours::float8 AS hours, u.used_by AS "usedBy", u.used_at AS "usedAt",
              u.restored_at AS "restoredAt", u.removed, u.dropped, b.status AS "bookingStatus"
         FROM voucher_uses u LEFT JOIN bookings b ON b.id = u.booking_id LEFT JOIN courts c ON c.id = b.court_id
        WHERE u.voucher_id = $1 ORDER BY u.used_at DESC, u.id`,
      [id]
    ),
    db().query<VoucherEvent>(`SELECT at, actor, action, details FROM voucher_events WHERE voucher_id = $1 ORDER BY at DESC, id DESC`, [id]),
  ]);
  return { ok: true, data: { voucher: toAdmin(rows[0], nowAtFacility().date), uses: uses.rows, events: events.rows } };
}

type Fields = {
  title: string; issuedTo: string; note: string; terms: string; validFrom: string | null; expiresOn: string | null;
  sports: string[]; maxUses: number; maxDiscount: number | null;
};

/** The editable fields, checked. `kind` decides which apply. */
function readFields(input: Record<string, unknown>, kind: VoucherKind): Fields | string {
  const date = (v: unknown) => (v === "" || v === null || v === undefined ? null : isValidDate(v) ? v : undefined);
  const validFrom = date(input.validFrom);
  const expiresOn = date(input.expiresOn);
  if (validFrom === undefined || expiresOn === undefined) return "Please enter valid dates.";
  if (validFrom && expiresOn && expiresOn < validFrom) return "The expiry date must be on or after the start date.";
  const sports = Array.isArray(input.sports) ? [...new Set(input.sports.filter(isActivity))] : [];
  const maxUses = kind === "fixed" || kind === "percent" ? Number(input.maxUses ?? 1) : 1;
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) return "Uses must be a whole number from 1 to 1,000.";
  const cap = input.maxDiscount === "" || input.maxDiscount === null || input.maxDiscount === undefined ? null : Number(input.maxDiscount);
  if (cap !== null && (!Number.isFinite(cap) || cap <= 0 || cap > 100_000)) return "Enter a valid maximum discount, or leave it blank.";
  const terms = typeof input.terms === "string" ? input.terms.replace(/\r/g, "").trim().slice(0, 2000) : "";
  return {
    title: text(input.title, 60), issuedTo: text(input.issuedTo, 80), note: text(input.note, 300),
    terms: terms || defaultTerms(kind), validFrom, expiresOn,
    sports: sports.length === allActivities().length ? [] : sports, // all of them: any sport (and new ones later)
    maxUses, maxDiscount: kind === "percent" ? (cap === null ? null : round2(cap)) : null,
  };
}

/** What a voucher of this kind is worth, checked: hours in half hours, pesos, or a percent. */
function readValue(kind: VoucherKind, raw: unknown): number | string {
  const n = Number(raw);
  if (kind === "free_hours")
    return Number.isFinite(n) && n >= 0.5 && n <= 100 && Number.isInteger(n * 2) ? n : "Free hours must be 0.5 to 100, in half hours.";
  if (kind === "percent") return Number.isFinite(n) && n >= 1 && n <= 100 ? round2(n) : "The percentage must be from 1 to 100.";
  return Number.isFinite(n) && n >= 1 && n <= 100_000 ? round2(n) : "Enter an amount from ₱1 to ₱100,000.";
}

/** Creates `quantity` vouchers with the same settings (each with its own code). */
export async function createVouchers(input: Record<string, unknown>, by: string): Promise<Result<{ ids: string[] }>> {
  const kind = input.kind;
  if (!isVoucherKind(kind)) return fail(400, "Choose the kind of voucher.");
  const value = readValue(kind, input.value);
  if (typeof value === "string") return fail(400, value);
  const f = readFields(input, kind);
  if (typeof f === "string") return fail(400, f);
  if (f.expiresOn && f.expiresOn < nowAtFacility().date) return fail(400, "The expiry date has already passed.");
  const quantity = Number(input.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return fail(400, "You can create 1 to 100 vouchers at a time.");
  const balance = hasBalance(kind) ? value : 0;
  const batch = quantity > 1 ? `B-${formatVoucherCode(Array.from({ length: 8 }, () => randomInt(VOUCHER_CODE_ALPHABET_SIZE))).slice(4)}` : "";
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const ids: string[] = [];
    while (ids.length < quantity) {
      const code = formatVoucherCode(Array.from({ length: 8 }, () => randomInt(VOUCHER_CODE_ALPHABET_SIZE)));
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO vouchers (code, kind, value, max_discount, balance, max_uses, valid_from, expires_on, sports, title,
                               issued_to, note, terms, batch, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10, $11, $12, $13, $14, $15)
         ON CONFLICT (code) DO NOTHING RETURNING id`,
        [code, kind, value, f.maxDiscount, balance, f.maxUses, f.validFrom, f.expiresOn, f.sports, f.title, f.issuedTo,
          f.note, f.terms, batch, by.slice(0, 60) || "Staff"]
      );
      if (!rows[0]) continue; // the same code already exists (very unlikely): draw another
      ids.push(rows[0].id);
      await logVoucher(rows[0].id, by, "Created",
        `${voucherKindLabel(kind)} · ${voucherValueLabel({ kind, value, maxDiscount: f.maxDiscount })}${batch ? ` · batch ${batch} (${quantity})` : ""}`, client);
    }
    await client.query("COMMIT");
    return { ok: true, data: { ids } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

const dateText = (d: string | null) => d ?? "none";

/**
 * Staff change a voucher: its details, dates, sports, uses or cap, its terms, or (free hours and
 * cash) its balance. Each change is logged.
 */
export async function updateVoucher(id: string, input: Record<string, unknown>, by: string): Promise<Result<{ id: string }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid voucher.");
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<Row>(`SELECT * FROM vouchers WHERE id = $1 FOR UPDATE`, [id]);
    const cur = rows[0];
    if (!cur) {
      await client.query("ROLLBACK");
      return fail(404, "Voucher not found.");
    }
    // Fields not sent keep their current value.
    const f = readFields({
      title: cur.title, issuedTo: cur.issued_to, note: cur.note, terms: cur.terms, validFrom: cur.valid_from, expiresOn: cur.expires_on,
      sports: cur.sports, maxUses: cur.max_uses, maxDiscount: cur.max_discount,
      ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    }, cur.kind);
    if (typeof f === "string") {
      await client.query("ROLLBACK");
      return fail(400, f);
    }
    if ((cur.kind === "fixed" || cur.kind === "percent") && f.maxUses < cur.uses) {
      await client.query("ROLLBACK");
      return fail(400, `It's already on ${cur.uses} booking(s), so it needs at least ${cur.uses} uses.`);
    }
    let balance = Number(cur.balance);
    if (hasBalance(cur.kind) && input.balance !== undefined && input.balance !== "" && Number(input.balance) !== balance) {
      const b = Number(input.balance);
      const ok = cur.kind === "free_hours" ? Number.isInteger(b * 2) && b >= 0 && b <= 100 : Number.isFinite(b) && b >= 0 && b <= 100_000;
      if (!ok) {
        await client.query("ROLLBACK");
        return fail(400, cur.kind === "free_hours" ? "Hours left must be 0 to 100, in half hours." : "Enter a valid balance.");
      }
      balance = round2(b);
    }
    await client.query(
      `UPDATE vouchers SET title = $2, issued_to = $3, note = $4, terms = $5, valid_from = $6, expires_on = $7, sports = $8::text[],
              max_uses = $9, max_discount = $10, balance = $11, updated_at = now()
        WHERE id = $1`,
      [id, f.title, f.issuedTo, f.note, f.terms, f.validFrom, f.expiresOn, f.sports, f.maxUses, f.maxDiscount, balance]
    );
    const changes: [string, string][] = [];
    if (cur.title !== f.title) changes.push(["Title", `“${cur.title}” → “${f.title}”`]);
    if (cur.issued_to !== f.issuedTo) changes.push(["Issued to", `“${cur.issued_to}” → “${f.issuedTo}”`]);
    if (cur.valid_from !== f.validFrom) changes.push(["Valid from", `${dateText(cur.valid_from)} → ${dateText(f.validFrom)}`]);
    if (cur.expires_on !== f.expiresOn) changes.push(["Expiry", `${dateText(cur.expires_on)} → ${dateText(f.expiresOn)}`]);
    if ((cur.sports ?? []).join(",") !== f.sports.join(",")) changes.push(["Sports", f.sports.length ? f.sports.join(", ") : "any"]);
    if (cur.max_uses !== f.maxUses) changes.push(["Uses", `${cur.max_uses} → ${f.maxUses}`]);
    if ((cur.max_discount === null ? null : Number(cur.max_discount)) !== f.maxDiscount)
      changes.push(["Max discount", `${cur.max_discount ? peso(Number(cur.max_discount)) : "none"} → ${f.maxDiscount ? peso(f.maxDiscount) : "none"}`]);
    if (Number(cur.balance) !== balance) {
      const reason = text(input.balanceReason, 120);
      const fmt = (n: number) => (cur.kind === "free_hours" ? `${n} h` : peso(n));
      changes.push(["Balance", `${fmt(Number(cur.balance))} → ${fmt(balance)}${reason ? ` (${reason})` : ""}`]);
    }
    if (cur.terms !== f.terms) changes.push(["Terms", "updated"]);
    if (cur.note !== f.note) changes.push(["Note", "updated"]);
    if (changes.length) await logVoucher(id, by, "Edited", changes.map(([k, v]) => `${k}: ${v}`).join(" · "), client);
    await client.query("COMMIT");
    return { ok: true, data: { id } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Active, paused (can't be used for now) or void (blocked, e.g. lost). */
export async function setVoucherStatus(id: string, status: unknown, by: string, reason: unknown): Promise<Result<{ id: string }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid voucher.");
  if (!isVoucherStatus(status)) return fail(400, "Unknown status.");
  const { rows } = await db().query<{ old: VoucherStatus }>(
    `UPDATE vouchers v SET status = $2, updated_at = now() FROM vouchers o WHERE v.id = $1 AND o.id = v.id RETURNING o.status AS old`,
    [id, status]
  );
  if (!rows[0]) return fail(404, "Voucher not found.");
  if (rows[0].old !== status) {
    const why = text(reason, 200);
    await logVoucher(id, by, { active: "Activated", paused: "Paused", void: "Voided" }[status], why);
  }
  return { ok: true, data: { id } };
}

/**
 * Deletes vouchers for good (e.g. made by mistake). One still on a booking (not cancelled, or
 * already played) is kept, so the booking's price stays explained — void it instead. Bookings
 * that were cancelled lose their link to it.
 */
export async function deleteVouchers(rawIds: unknown, by: string): Promise<Result<{ deleted: string[]; kept: { code: string; bookings: number }[] }>> {
  const ids = (Array.isArray(rawIds) ? rawIds : []).filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return fail(400, "Choose the vouchers to delete.");
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string; code: string; on_bookings: number }>(
      `SELECT v.id, v.code,
              (SELECT count(*)::int FROM voucher_uses u WHERE u.voucher_id = v.id AND u.restored_at IS NULL AND NOT u.dropped) AS on_bookings
         FROM vouchers v WHERE v.id = ANY($1::uuid[]) FOR UPDATE OF v`,
      [ids]
    );
    const kept = rows.filter((r) => r.on_bookings > 0).map((r) => ({ code: r.code, bookings: r.on_bookings }));
    const gone = rows.filter((r) => r.on_bookings === 0);
    if (gone.length) await client.query(`DELETE FROM vouchers WHERE id = ANY($1::uuid[])`, [gone.map((r) => r.id)]);
    await client.query("COMMIT");
    if (gone.length) console.log(`Vouchers deleted by ${by}: ${gone.map((r) => r.code).join(", ")}`);
    return { ok: true, data: { deleted: gone.map((r) => r.code), kept } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---- Public: the voucher page ------------------------------------------------------------------

export type PublicVoucher = Omit<Voucher, "issuedTo"> & { state: VoucherState };

/** What anyone holding the code sees on the voucher page (not who it was issued to, or staff notes). */
export async function publicVoucher(raw: unknown): Promise<Result<PublicVoucher>> {
  const code = normalizeVoucherCode(raw);
  if (!code) return fail(400, "Voucher codes look like VCH-ABCD-2345.");
  const { rows } = await db().query<Row>(`SELECT * FROM vouchers WHERE code = $1`, [code]);
  if (!rows[0]) return fail(404, "No voucher found with that code. Please check it and try again.");
  const { issuedTo: _, ...v } = toVoucher(rows[0]);
  return { ok: true, data: { ...v, state: voucherState(v as Voucher, nowAtFacility().date) } };
}

// ---- Using a voucher on a booking --------------------------------------------------------------

export type TakenVoucher = {
  id: string; code: string; kind: VoucherKind; split: ReturnType<typeof splitDiscount>;
  info: Omit<BookingVoucherInfo, "discount" | "id">; // shown on the booking
};

/**
 * Locks the voucher (so two bookings can't spend the same value) and works out what it takes off
 * each court. Call inside a transaction. A message when it can't be used (404: no such voucher).
 */
export async function takeVoucher(
  client: PoolClient,
  raw: unknown,
  b: { date: string; activity: string },
  courts: VoucherCourt[]
): Promise<TakenVoucher | { status: number; error: string }> {
  const code = normalizeVoucherCode(raw);
  if (!code) return { status: 400, error: "Voucher codes look like VCH-ABCD-2345. Please check the code." };
  const { rows } = await client.query<Row>(`SELECT * FROM vouchers WHERE code = $1 FOR UPDATE`, [code]);
  if (!rows[0]) return { status: 404, error: "No voucher found with that code. Please check it and try again." };
  const v = toVoucher(rows[0]);
  const problem = voucherProblem(v, { today: nowAtFacility().date, date: b.date, activity: b.activity });
  if (problem) return { status: 400, error: problem };
  const split = splitDiscount(v, courts);
  if (split.total <= 0) return { status: 400, error: "This voucher doesn't take anything off this booking." };
  return {
    id: rows[0].id, code, kind: v.kind, split,
    info: { code, title: v.title, kind: v.kind, value: v.value, maxDiscount: v.maxDiscount, validFrom: v.validFrom, expiresOn: v.expiresOn },
  };
}

/**
 * Records a voucher on the courts it was taken off (same order as the courts given to takeVoucher)
 * and spends it: free hours or pesos off its balance, and one use. Same transaction as takeVoucher.
 */
export async function spendVoucher(client: PoolClient, t: TakenVoucher, bookings: { id: string; code: string }[], by: string): Promise<void> {
  const application = randomUUID();
  for (const [i, b] of bookings.entries()) {
    const s = t.split.shares[i];
    if (!s || (s.amount <= 0 && s.hours <= 0)) continue;
    await client.query(
      `INSERT INTO voucher_uses (voucher_id, application, booking_id, booking_code, amount, hours, used_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [t.id, application, b.id, b.code, s.amount, s.hours, by.slice(0, 60)]
    );
  }
  await client.query(
    `UPDATE vouchers SET balance = GREATEST(0, balance - $2), uses = uses + 1, updated_at = now() WHERE id = $1`,
    [t.id, t.kind === "free_hours" ? t.split.hours : t.kind === "cash" ? t.split.total : 0]
  );
}

type GroupRow = {
  id: string; cancel_code: string; root: string; status: string; payment_status: PaymentStatus; payment_method: PaymentMethod;
  amount: string; hourly_rate: string; start_hour: string; end_hour: string; booking_date: string; activity: string;
  voucher_id: string | null; voucher_code: string | null;
};

/** The courts still booked under a booking's code (its group), first court first, locked. */
async function lockGroup(client: PoolClient, where: "id" | "code", value: string): Promise<GroupRow[]> {
  const { rows } = await client.query<GroupRow>(
    `SELECT b.id, b.cancel_code, COALESCE(b.group_id, b.id) AS root, b.status, b.payment_status, b.payment_method, b.amount,
            b.hourly_rate, b.start_hour, b.end_hour, b.booking_date, COALESCE(b.activity, c.sport) AS activity, b.voucher_id,
            (SELECT code FROM vouchers WHERE id = b.voucher_id) AS voucher_code
       FROM bookings b JOIN courts c ON c.id = b.court_id
      WHERE COALESCE(b.group_id, b.id) = (SELECT COALESCE(group_id, id) FROM bookings WHERE ${where === "id" ? "id = $1::uuid" : "cancel_code = $1"})
        AND b.status <> 'cancelled'
      ORDER BY (b.group_id IS NULL) DESC, b.created_at, b.id
      FOR UPDATE OF b`,
    [value]
  );
  return rows;
}

/**
 * Puts a voucher on a booking that's already made (all its courts), before it's paid: by staff
 * (any time), or by the customer on My booking (before it starts). A booking fully covered by the
 * voucher is confirmed.
 */
export async function applyVoucherToBooking(
  where: { id: string } | { code: string },
  voucherCode: unknown,
  actor: Actor
): Promise<Result<{ discount: number; amount: number; code: string }>> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const rows = "id" in where
      ? /^[0-9a-f-]{36}$/i.test(where.id) ? await lockGroup(client, "id", where.id) : []
      : await lockGroup(client, "code", where.code);
    const stop = async (status: number, error: string) => {
      await client.query("ROLLBACK");
      return fail(status, error);
    };
    if (!rows.length) {
      const { rows: any } = await client.query(
        `SELECT 1 FROM bookings WHERE ${"id" in where ? "id::text = $1" : "cancel_code = $1"}`, ["id" in where ? where.id : where.code]
      );
      return stop(any.length ? 400 : 404, any.length ? "This booking is cancelled." : "No booking found with that code.");
    }
    const first = rows[0];
    if (rows.some((r) => r.voucher_id))
      return stop(400, `This booking already has a voucher (${rows.find((r) => r.voucher_code)?.voucher_code ?? "voucher"}). Only one voucher can be used per booking.`);
    if (rows.some((r) => r.payment_status !== "unpaid" && r.payment_status !== "rejected"))
      return stop(400, actor.kind === "staff"
        ? "A payment was already sent or recorded for this booking. Set the payment back to Unpaid first, or settle the difference at the desk."
        : "A payment was already sent for this booking, so a voucher can't be added now. Please ask the front desk.");
    if (actor.kind !== "staff" && isPastSlot(first.booking_date, Number(first.start_hour)))
      return stop(400, "This booking has already started. Please show your voucher at the front desk.");
    const courts = rows.map((r) => ({ hours: Number(r.end_hour) - Number(r.start_hour), rate: Number(r.hourly_rate), amount: Number(r.amount) }));
    const t = await takeVoucher(client, voucherCode, { date: first.booking_date, activity: first.activity }, courts);
    if ("error" in t) return stop(t.status, t.error);
    const total = round2(rows.reduce((s, r, i) => s + Number(r.amount) - t.split.shares[i].amount, 0));
    for (const [i, r] of rows.entries()) {
      const share = t.split.shares[i].amount;
      const amount = round2(Number(r.amount) - share);
      // Nothing left to pay on the whole booking: confirmed, and no payment window.
      const status = total <= 0 ? activeBookingStatus(r.payment_method, r.payment_status, 0) : r.status;
      await client.query(
        `UPDATE bookings SET amount = $2, voucher_id = $3, voucher_discount = voucher_discount + $4, status = $5,
                pay_by = CASE WHEN $6 THEN NULL ELSE pay_by END
          WHERE id = $1`,
        [r.id, amount, t.id, share, status, total <= 0]
      );
    }
    await spendVoucher(client, t, rows.map((r) => ({ id: r.id, code: r.cancel_code })), actor.name);
    await client.query("COMMIT");
    await logBooking({ id: first.root }, actor, "Voucher applied", `${t.code} · −${peso(t.split.total)}${t.split.hours ? ` (${t.split.hours} free h)` : ""} · now ${peso(total)}`);
    return { ok: true, data: { discount: t.split.total, amount: total, code: t.code } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Staff take a voucher off a booking (e.g. applied by mistake): the booking goes back to its full
 * price and the voucher gets its value back, even if it has expired since.
 */
export async function removeVoucherFromBooking(id: string, by: Actor): Promise<Result<{ amount: number }>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, "Invalid booking id.");
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const rows = await lockGroup(client, "id", id);
    if (!rows.some((r) => r.voucher_id)) {
      await client.query("ROLLBACK");
      return fail(400, "This booking has no voucher.");
    }
    const { rows: uses } = await client.query<{ id: number; voucher_id: string; booking_id: string; amount: string; hours: string; kind: VoucherKind }>(
      `SELECT u.id, u.voucher_id, u.booking_id, u.amount, u.hours, v.kind
         FROM voucher_uses u JOIN vouchers v ON v.id = u.voucher_id
        WHERE u.booking_id = ANY($1::uuid[]) AND u.restored_at IS NULL AND NOT u.dropped
        FOR UPDATE OF u, v`,
      [rows.map((r) => r.id)]
    );
    const code = rows.find((r) => r.voucher_code)?.voucher_code ?? "";
    let total = 0;
    for (const r of rows) {
      const back = round2(uses.filter((u) => u.booking_id === r.id).reduce((s, u) => s + Number(u.amount), 0));
      const amount = round2(Number(r.amount) + back);
      total += amount;
      // Charged again: not confirmed until paid.
      const status = r.status === "confirmed" && amount > 0 && back > 0 ? activeBookingStatus(r.payment_method, r.payment_status, amount) : r.status;
      await client.query(
        `UPDATE bookings SET amount = $2, voucher_id = NULL, voucher_discount = 0, status = $3 WHERE id = $1`,
        [r.id, amount, status]
      );
    }
    for (const vid of new Set(uses.map((u) => u.voucher_id))) {
      const mine = uses.filter((u) => u.voucher_id === vid);
      const back = mine[0].kind === "free_hours" ? mine.reduce((s, u) => s + Number(u.hours), 0)
        : mine[0].kind === "cash" ? mine.reduce((s, u) => s + Number(u.amount), 0) : 0;
      await client.query(`UPDATE vouchers SET balance = balance + $2, uses = GREATEST(0, uses - 1), updated_at = now() WHERE id = $1`, [vid, round2(back)]);
      await client.query(`UPDATE voucher_uses SET restored_at = now(), removed = TRUE WHERE id = ANY($1::bigint[])`, [mine.map((u) => u.id)]);
      await logVoucher(vid, by.name, "Removed from a booking", `${rows[0].cancel_code} · value given back`, client);
    }
    await client.query("COMMIT");
    await logBooking({ id: rows[0].root }, by, "Voucher removed", `${code} · back to ${peso(round2(total))}`);
    return { ok: true, data: { amount: round2(total) } };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Default expiry for new promotional vouchers (cash vouchers default to none). */
export const defaultExpiry = () => addDays(nowAtFacility().date, 90);
