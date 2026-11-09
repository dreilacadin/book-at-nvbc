import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { db } from "./db";
import { clientIp, recordHit, tooMany } from "./throttle";
import { isValidDate, nowAtFacility } from "./time";
import {
  isOnDeckSport,
  normalizeVoucherCode,
  onDeckProblem,
  onDeckSessionName,
  renderTerms,
  voucherState,
  type OnDeckSport,
  type VoucherKind,
  type VoucherState,
} from "./voucher";
import { logVoucher, toVoucher, type Row } from "./vouchers";

// NVBC On Deck (ondeck.nvbc.app), the sister app that runs open play and queueing, checks and
// redeems On Deck vouchers here, so every voucher lives in one place. Its server calls
// /api/ondeck/vouchers with the shared key in ONDECK_API_KEY. See docs/ondeck-vouchers.md.

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const sha = (s: string) => createHash("sha256").update(s).digest();

// A caller that sends this many wrong keys in 15 minutes is refused for a while.
const KEY_MISSES = 10;

/**
 * Checks On Deck's key (Authorization: Bearer <ONDECK_API_KEY>). A response to send back when it
 * isn't right, or null when it is.
 */
export async function onDeckAuthError(req: NextRequest): Promise<Response | null> {
  const key = process.env.ONDECK_API_KEY?.trim();
  if (!key || key.length < 24) return Response.json({ error: "The On Deck link isn't set up (ONDECK_API_KEY)." }, { status: 503 });
  const ip = clientIp(req);
  if (await tooMany("ondeck-key", ip, KEY_MISSES, 15)) return Response.json({ error: "Too many wrong keys. Try again later." }, { status: 429 });
  const sent = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (!sent || !timingSafeEqual(sha(sent), sha(key))) {
    await recordHit("ondeck-key", ip);
    return Response.json({ error: "Wrong or missing key." }, { status: 401 });
  }
  return null;
}

/** A voucher as On Deck sees it. `usable`: it can be redeemed for a session on the date asked about. */
export type OnDeckVoucher = {
  code: string;
  kind: VoucherKind; // only "ondeck_session" vouchers can be used at On Deck
  sport: OnDeckSport | null; // what it's for: "badminton" (queueing) or "pickleball" (open play)
  session: string | null; // "Pickleball Open Play Session"
  sessions: number; // sessions it was worth
  sessionsLeft: number;
  state: VoucherState;
  usable: boolean;
  problem: string | null; // why it can't be used, ready to show staff and players
  title: string;
  issuedTo: string;
  validFrom: string | null;
  expiresOn: string | null;
  terms: string[];
};

function forOnDeck(r: Row, s: { date: string; sport: string | null }): OnDeckVoucher {
  const v = toVoucher(r);
  const today = nowAtFacility().date;
  const ondeck = v.kind === "ondeck_session";
  const sport = ondeck && isOnDeckSport(v.sports[0]) ? v.sports[0] : null;
  const problem = onDeckProblem(v, { today, date: s.date, sport: s.sport });
  return {
    code: v.code, kind: v.kind, sport, session: ondeck ? onDeckSessionName(sport ?? undefined) : null,
    sessions: ondeck ? v.value : 0, sessionsLeft: ondeck ? v.balance : 0, state: voucherState(v, today),
    usable: !problem, problem, title: v.title, issuedTo: v.issuedTo, validFrom: v.validFrom, expiresOn: v.expiresOn,
    terms: ondeck ? renderTerms(v, "courts.nvbc.app") : [],
  };
}

/** The session's date ("YYYY-MM-DD", today if not given) and sport (optional), checked. */
function readSession(input: Record<string, unknown>): { date: string; sport: OnDeckSport | null } | string {
  const date = input.date === undefined || input.date === null || input.date === "" ? nowAtFacility().date : input.date;
  if (!isValidDate(date)) return "date must be a day like 2026-11-10.";
  const sport = input.sport === undefined || input.sport === null || input.sport === "" ? null : input.sport;
  if (sport !== null && !isOnDeckSport(sport)) return 'sport must be "badminton" or "pickleball".';
  return { date: date as string, sport };
}

const NOT_FOUND = "No voucher found with that code. Please check it and try again.";
const BAD_CODE = "Voucher codes look like VCH-ABCD-2345.";

/** { code, date?, sport? }: the voucher, and whether it can be used for that session. Changes nothing. */
export async function checkOnDeckVoucher(input: Record<string, unknown>): Promise<Result<{ voucher: OnDeckVoucher }>> {
  const code = normalizeVoucherCode(input.code);
  if (!code) return fail(400, BAD_CODE);
  const s = readSession(input);
  if (typeof s === "string") return fail(400, s);
  const { rows } = await db().query<Row>(`SELECT * FROM vouchers WHERE code = $1`, [code]);
  if (!rows[0]) return fail(404, NOT_FOUND);
  return { ok: true, data: { voucher: forOnDeck(rows[0], s) } };
}

/** On Deck's own id for a redemption (e.g. its check-in id): what makes retrying it safe. */
const readRef = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(v.trim()) ? v.trim() : null);
const BAD_REF = "ref is required: On Deck's own id for this redemption (letters, digits, . _ : -, up to 100).";

async function inTransaction<T>(fn: (client: PoolClient) => Promise<Result<T>>): Promise<Result<T>> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query(r.ok ? "COMMIT" : "ROLLBACK");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

type UseRow = { id: string; restored_at: string | null; used_at: string };
export type Redemption = { id: string; ref: string; redeemedAt: string; alreadyRedeemed: boolean };

/**
 * { code, ref, date?, sport?, player?, by? }: uses one session of the voucher. Sending the same
 * `ref` again doesn't use another session; it answers with the first redemption
 * (alreadyRedeemed: true), so On Deck can safely retry after a timeout.
 */
export async function redeemOnDeckVoucher(input: Record<string, unknown>): Promise<Result<{ redemption: Redemption; voucher: OnDeckVoucher }>> {
  const code = normalizeVoucherCode(input.code);
  if (!code) return fail(400, BAD_CODE);
  const ref = readRef(input.ref);
  if (!ref) return fail(400, BAD_REF);
  const s = readSession(input);
  if (typeof s === "string") return fail(400, s);
  const player = text(input.player, 80);
  const by = text(input.by, 50);
  return inTransaction<{ redemption: Redemption; voucher: OnDeckVoucher }>(async (client) => {
    const { rows } = await client.query<Row>(`SELECT * FROM vouchers WHERE code = $1 FOR UPDATE`, [code]);
    const row = rows[0];
    if (!row) return fail(404, NOT_FOUND);
    const { rows: prior } = await client.query<UseRow>(
      `SELECT id::text, restored_at, used_at FROM voucher_uses WHERE voucher_id = $1 AND ref = $2`, [row.id, ref]
    );
    if (prior[0] && !prior[0].restored_at)
      return { ok: true, data: { redemption: { id: prior[0].id, ref, redeemedAt: prior[0].used_at, alreadyRedeemed: true }, voucher: forOnDeck(row, s) } };
    const problem = onDeckProblem(toVoucher(row), { today: nowAtFacility().date, ...s });
    if (problem) return fail(409, problem);
    const sport = row.sports[0];
    const details = [onDeckSessionName(sport), s.date, player].filter(Boolean).join(" · ");
    const usedBy = by ? `${by} (On Deck)` : "On Deck";
    const { rows: use } = await client.query<UseRow>(
      prior[0]
        ? // The same redemption again after it was undone: it counts again.
          `UPDATE voucher_uses SET restored_at = NULL, removed = FALSE, used_at = now(), used_by = $3, details = $4
            WHERE id = $2 AND voucher_id = $1 RETURNING id::text, restored_at, used_at`
        : `INSERT INTO voucher_uses (voucher_id, application, source, sessions, ref, used_by, details)
           VALUES ($1, $5, 'ondeck', 1, $2, $3, $4) RETURNING id::text, restored_at, used_at`,
      prior[0] ? [row.id, prior[0].id, usedBy, details] : [row.id, ref, usedBy, details, randomUUID()]
    );
    const { rows: after } = await client.query<Row>(
      `UPDATE vouchers SET balance = balance - 1, updated_at = now() WHERE id = $1 RETURNING *`, [row.id]
    );
    await logVoucher(row.id, usedBy, "Used at On Deck", `${details} · ref ${ref}`, client);
    return { ok: true, data: { redemption: { id: use[0].id, ref, redeemedAt: use[0].used_at, alreadyRedeemed: false }, voucher: forOnDeck(after[0], s) } };
  });
}

/**
 * { code, ref, by?, reason? }: gives back a session On Deck redeemed (e.g. by mistake, or the
 * session was cancelled), even if the voucher has expired since. Undoing it twice is fine.
 */
export async function undoOnDeckRedemption(input: Record<string, unknown>): Promise<Result<{ undone: boolean; voucher: OnDeckVoucher }>> {
  const code = normalizeVoucherCode(input.code);
  if (!code) return fail(400, BAD_CODE);
  const ref = readRef(input.ref);
  if (!ref) return fail(400, BAD_REF);
  const by = text(input.by, 50);
  const reason = text(input.reason, 200);
  const today = { date: nowAtFacility().date, sport: null };
  return inTransaction<{ undone: boolean; voucher: OnDeckVoucher }>(async (client) => {
    const { rows } = await client.query<Row>(`SELECT * FROM vouchers WHERE code = $1 FOR UPDATE`, [code]);
    const row = rows[0];
    if (!row) return fail(404, NOT_FOUND);
    const { rows: use } = await client.query<{ id: string; restored_at: string | null; sessions: number }>(
      `SELECT id::text, restored_at, sessions FROM voucher_uses WHERE voucher_id = $1 AND ref = $2 AND source = 'ondeck' FOR UPDATE`,
      [row.id, ref]
    );
    if (!use[0]) return fail(404, "This voucher has no On Deck redemption with that ref.");
    if (use[0].restored_at) return { ok: true, data: { undone: false, voucher: forOnDeck(row, today) } };
    await client.query(`UPDATE voucher_uses SET restored_at = now(), removed = TRUE WHERE id = $1`, [use[0].id]);
    const { rows: after } = await client.query<Row>(
      `UPDATE vouchers SET balance = balance + $2, updated_at = now() WHERE id = $1 RETURNING *`, [row.id, use[0].sessions]
    );
    const usedBy = by ? `${by} (On Deck)` : "On Deck";
    await logVoucher(row.id, usedBy, "On Deck use undone", `ref ${ref} · session given back${reason ? ` · ${reason}` : ""}`, client);
    return { ok: true, data: { undone: true, voucher: forOnDeck(after[0], today) } };
  });
}
