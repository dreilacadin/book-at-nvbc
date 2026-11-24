import { randomBytes } from "node:crypto";
import { after } from "next/server";
import type { PoolClient } from "pg";
import webpush from "web-push";
import { cleanRef, enabledMethods } from "./bookings";
import { siteOrigin } from "./customer-notify";
import { isEmail } from "./customer-messages";
import { db, getSettings, settingsChanged, type Settings } from "./db";
import { emailSender, sendEmail } from "./mailer";
import { notifyStaff, setupVapid } from "./notify";
import { formatPeso, hasPaymentProof, isPaymentMethod, isProofImage, paymentLabel, type PaymentMethod, type PaymentStatus } from "./pricing";
import {
  checkTurnaround,
  earliestPickup,
  MAX_GROMMETS,
  mergeSuggestions,
  normalizeMobile,
  POPULAR_RACKETS,
  POPULAR_STRINGS,
  racketPrice,
  readPrestretch,
  readTension,
  readyMessage,
  receivedMessage,
  stringColorName,
  colorStock,
  stringName,
  tagLabel,
  tensionLabel,
  thankYouMessage,
  trackingMessage,
  toStringingPrices,
  type RacketStatus,
  type StringingPrices,
  type StringItem,
} from "./stringing";
import { addDays, isValidDate, nowAtFacility } from "./time";

// Racket stringing (see lib/stringing.ts for prices, statuses and messages). Customers check in on
// /string, follow and pay on /string/<token>; staff and stringers work in Admin → Stringing. Server only.

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
/** Like text(), but keeps line breaks (at most one blank line in a row). */
const longText = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "";
const round2 = (n: number) => Math.round(n * 100) / 100;
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/** How stringing can be paid: cash at the desk, and the online methods switched on for bookings. */
export const stringingMethods = (s: Settings): PaymentMethod[] => ["cash", ...enabledMethods(s).filter((m) => m !== "cash")];

// ---- Rows ---------------------------------------------------------------------------------------

export type RacketRow = {
  id: string; order_id: string; tag: number; racket: string; string_id: number | null; string_name: string;
  string_color: string; own_string: boolean; tension_main: number; tension_cross: number; prestretch: number | null; remarks: string; rush: boolean; due_on: string;
  grommets_single: number; grommets_double: number; notes: string; labor_fee: number; rush_fee: number;
  string_price: number; grommet_fee: number; total: number; status: RacketStatus;
  received_by: string | null; received_at: string | null; started_by: string | null; started_at: string | null;
  done_by: string | null; done_at: string | null; picked_up_by: string | null; picked_up_at: string | null;
  cancelled_by: string | null; cancelled_at: string | null; created_at: string;
};

export type OrderRow = {
  id: string; token: string; name: string; mobile: string; email: string; total: number;
  payment_method: PaymentMethod; payment_status: PaymentStatus; payment_ref: string; has_proof: boolean;
  paid_amount_reported: number | null; payment_sent_at: string | null; paid_amount: number; paid_at: string | null;
  paid_by: string | null; rejected_note: string; created_by: string; created_at: string; thanked_at: string | null;
  feedback_rating: number | null; feedback_comment: string; feedback_at: string | null;
};

const ORDER_COLUMNS = `o.id, o.token, o.name, o.mobile, o.email, o.total, o.payment_method, o.payment_status, o.payment_ref,
  (o.payment_proof <> '') AS has_proof, o.paid_amount_reported, o.payment_sent_at, o.paid_amount, o.paid_at, o.paid_by,
  o.rejected_note, o.created_by, o.created_at, o.thanked_at, o.feedback_rating, o.feedback_comment, o.feedback_at`;

/** What's still to pay on an order. */
export const orderBalance = (o: Pick<OrderRow, "total" | "paid_amount" | "payment_status">) =>
  o.payment_status === "waived" ? 0 : round2(Math.max(0, Number(o.total) - (o.payment_status === "paid" ? Number(o.paid_amount) : 0)));

async function logEvent(q: PoolClient | ReturnType<typeof db>, orderId: string, actor: string, action: string, details = "") {
  await q.query(`INSERT INTO stringing_events (order_id, actor, action, details) VALUES ($1, $2, $3, $4)`,
    [orderId, actor.slice(0, 60) || "Staff", action, details.slice(0, 500)]);
}

async function recomputeTotal(q: PoolClient | ReturnType<typeof db>, orderId: string) {
  await q.query(
    `UPDATE stringing_orders SET total = (SELECT COALESCE(sum(total), 0) FROM stringing_rackets WHERE order_id = $1 AND status <> 'cancelled')
      WHERE id = $1`,
    [orderId]
  );
}

type StockKey = { id: number; color: string };
/**
 * Changes the stock of one colour of a string (−1 sold, +1 put back, +10 delivered) and logs it.
 * With `mustHave`, it won't go below zero (returns null instead).
 */
async function moveStock(c: PoolClient, k: StockKey, change: number, actor: string, reason: string, mustHave = false): Promise<number | null> {
  const { rows } = await c.query<{ stock: number }>(
    mustHave && change < 0
      ? `UPDATE stringing_stock SET stock = stock + $3 WHERE string_id = $1 AND color = $2 AND stock + $3 >= 0 RETURNING stock`
      : `INSERT INTO stringing_stock (string_id, color, stock) VALUES ($1, $2, $3)
         ON CONFLICT (string_id, color) DO UPDATE SET stock = stringing_stock.stock + EXCLUDED.stock RETURNING stock`,
    [k.id, k.color, change]
  );
  if (!rows[0]) return null;
  await c.query(`INSERT INTO stringing_stock_moves (string_id, color, actor, change, stock_after, reason) VALUES ($1, $2, $3, $4, $5, $6)`,
    [k.id, k.color, actor.slice(0, 60) || "Staff", change, rows[0].stock, reason.slice(0, 200)]);
  return rows[0].stock;
}
/** The NVBC string (and colour) a racket uses, whose stock it counts against; null for the customer's own. */
const boughtString = (r: { own_string: boolean; string_id: number | null; string_color: string | null }): StockKey | null =>
  !r.own_string && r.string_id ? { id: r.string_id, color: r.string_color ?? "" } : null;
const sameStock = (a: StockKey | null, b: StockKey | null) => a?.id === b?.id && a?.color === b?.color;

async function inTransaction<T>(fn: (c: PoolClient) => Promise<Result<T>>): Promise<Result<T>> {
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

/** Runs after the response is sent (notifications), without slowing the request down. */
function later(fn: () => Promise<void>) {
  const run = () => fn().catch((e) => console.error("stringing notice failed", e));
  try {
    after(run);
  } catch {
    void run();
  }
}

// ---- Strings and suggestions --------------------------------------------------------------------

const STRING_SELECT = `SELECT s.id, s.brand, s.model, s.colors, s.price::float8 AS price, s.active,
         COALESCE(st.total, 0)::int AS stock, COALESCE(st.per, '{}'::json) AS "stockBy"
    FROM stringing_strings s
    LEFT JOIN (SELECT string_id, sum(stock) AS total, json_object_agg(color, stock) AS per FROM stringing_stock GROUP BY string_id) st
      ON st.string_id = s.id`;
async function listStrings(activeOnly: boolean): Promise<StringItem[]> {
  const { rows } = await db().query<StringItem>(`${STRING_SELECT} ${activeOnly ? "WHERE s.active" : ""} ORDER BY s.active DESC, s.brand, s.model`);
  return rows;
}
async function oneString(q: PoolClient | ReturnType<typeof db>, id: number): Promise<StringItem | undefined> {
  return (await q.query<StringItem>(`${STRING_SELECT} WHERE s.id = $1`, [id])).rows[0];
}

export type StringingOptions = {
  strings: StringItem[]; // NVBC's strings, to buy
  rackets: string[]; // racket suggestions
  ownStrings: string[]; // suggestions for a customer's own string
  prices: StringingPrices;
  methods: PaymentMethod[];
  today: string;
};

/** What the check-in form needs: strings for sale, suggestions, prices and payment methods. */
export async function stringingOptions(): Promise<StringingOptions> {
  const [settings, strings, used] = await Promise.all([
    getSettings(),
    listStrings(true),
    db().query<{ racket: string[]; string: string[] }>(
      `SELECT ARRAY(SELECT racket FROM stringing_rackets GROUP BY racket ORDER BY count(*) DESC LIMIT 300) AS racket,
              ARRAY(SELECT string_name FROM stringing_rackets WHERE own_string GROUP BY string_name ORDER BY count(*) DESC LIMIT 200) AS string`
    ),
  ]);
  return {
    strings,
    rackets: mergeSuggestions(POPULAR_RACKETS, used.rows[0].racket),
    ownStrings: mergeSuggestions(strings.map(stringName), POPULAR_STRINGS, used.rows[0].string),
    prices: { ...settings.stringing, turnaroundChanged: null }, // who changed it is for staff
    methods: stringingMethods(settings),
    today: nowAtFacility().date,
  };
}

// ---- Checking in --------------------------------------------------------------------------------

type RacketFields = {
  racket: string; stringId: number | null; stringName: string; stringColor: string; ownString: boolean;
  tensionMain: number; tensionCross: number; prestretch: number | null; rush: boolean; dueOn: string; grommetsSingle: number;
  grommetsDouble: number; notes: string; price: ReturnType<typeof racketPrice>;
};

/**
 * One racket from the form, checked and priced. Staff may choose any collection date from today
 * (and keep a string that's no longer sold); customers from the earliest turnaround.
 */
function readRacket(
  v: unknown,
  ctx: { strings: StringItem[]; prices: StringingPrices; today: string; staff: boolean; keepStringId?: number | null }
): RacketFields | string {
  const r = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const racket = text(r.racket, 80);
  if (racket.length < 2) return "Enter the racket (brand and model).";
  let stringId: number | null = null;
  let name: string;
  let color = text(r.stringColor, 30);
  let stringPrice = 0;
  const ownString = r.ownString === true;
  if (ownString) {
    name = text(r.ownStringName, 80);
    if (name.length < 2) return `${racket}: enter the string you brought (e.g. Yonex BG66 Ultimax).`;
  } else {
    const s = ctx.strings.find((x) => x.id === Number(r.stringId) && (x.active || x.id === ctx.keepStringId));
    if (!s) return `${racket}: choose a string, or tick “I brought my own string”.`;
    if (s.colors.length && !s.colors.includes(color)) return `${racket}: choose the ${stringName(s)} colour.`;
    if (!s.colors.length) color = "";
    stringId = s.id;
    name = stringName(s);
    stringPrice = s.price;
  }
  const tensionMain = readTension(r.tensionMain);
  const tensionCross = r.tensionCross === undefined || r.tensionCross === null || r.tensionCross === "" ? tensionMain : readTension(r.tensionCross);
  if (tensionMain === null || tensionCross === null) return `${racket}: choose the tension (15–40 lbs).`;
  const prestretch = readPrestretch(r.prestretch);
  if (prestretch === undefined) return `${racket}: pre-stretch is 5%, 10%, 15% or 20% (or none).`;
  const rush = r.rush === true;
  const earliest = ctx.staff ? ctx.today : earliestPickup(ctx.today, rush, ctx.prices);
  const dueOn = isValidDate(r.dueOn) ? r.dueOn : "";
  if (!dueOn) return `${racket}: choose the collection date.`;
  if (dueOn < earliest) return `${racket}: the earliest collection date is ${earliest}${rush ? " (rush)" : ""}.`;
  if (dueOn > addDays(ctx.today, 60)) return `${racket}: choose a collection date within the next 60 days.`;
  const count = (x: unknown) => (x === undefined || x === null || x === "" ? 0 : Number(x));
  const grommetsSingle = count(r.grommetsSingle);
  const grommetsDouble = count(r.grommetsDouble);
  for (const g of [grommetsSingle, grommetsDouble])
    if (!Number.isInteger(g) || g < 0 || g > MAX_GROMMETS) return `${racket}: grommets must be a whole number from 0 to ${MAX_GROMMETS}.`;
  const price = racketPrice({ rush, stringPrice, grommetsSingle, grommetsDouble }, ctx.prices);
  return {
    racket, stringId, stringName: name, stringColor: color, ownString, tensionMain, tensionCross, prestretch, rush, dueOn,
    grommetsSingle, grommetsDouble, notes: text(r.notes, 200), price,
  };
}

const MAX_RACKETS = 10;

export type CheckIn = {
  name: unknown; mobile: unknown; email?: unknown; rackets: unknown;
  // Staff only: received at the desk right away (by the staff member logged in), and paid already (how).
  receive?: unknown; paidMethod?: unknown;
};

/**
 * A customer (or staff for them) checks in one or more rackets. Each gets a tag number. Staff can
 * mark them received and paid at once. Returns the status page token and the tags.
 */
export async function createStringingOrder(input: CheckIn, staffName: string | null): Promise<Result<{ id: string; token: string; tags: number[] }>> {
  const name = text(input.name, 80);
  if (name.length < 2) return fail(400, "Enter your name.");
  const mobile = normalizeMobile(input.mobile);
  if (!mobile) return fail(400, "Enter a mobile number like 0917 123 4567.");
  const email = text(input.email, 120).toLowerCase();
  if (email && !isEmail(email)) return fail(400, "Please check the email address (or leave it blank).");
  const list = Array.isArray(input.rackets) ? input.rackets : [];
  if (!list.length) return fail(400, "Add at least one racket.");
  if (list.length > MAX_RACKETS) return fail(400, `Up to ${MAX_RACKETS} rackets per check-in.`);
  const [settings, strings] = await Promise.all([getSettings(), listStrings(false)]);
  const ctx = { strings, prices: settings.stringing, today: nowAtFacility().date, staff: staffName !== null };
  const rackets: RacketFields[] = [];
  for (const [i, r] of list.entries()) {
    const f = readRacket(r, ctx);
    if (typeof f === "string") return fail(400, list.length > 1 ? `Racket ${i + 1} — ${f}` : f);
    rackets.push(f);
  }
  const receive = staffName !== null && input.receive === true;
  const receivedBy = staffName ?? ""; // always whoever is logged in
  const paidMethod = staffName !== null && isPaymentMethod(input.paidMethod) ? input.paidMethod : null;
  const total = round2(rackets.reduce((s, r) => s + r.price.total, 0));
  // Customers: check the stock first, so a refused check-in doesn't use up tag numbers (it's checked
  // again when the stock is taken off, below).
  const soldOut = (k: StockKey) => {
    const s = strings.find((x) => x.id === k.id);
    const left = s ? colorStock(s, k.color) : 0;
    return `Sorry — ${s ? stringColorName(s, k.color) : "that string"} ${left > 0 ? `has only ${left} left` : "is out of stock"}. Choose another string or colour, or bring your own.`;
  };
  // String and colour → how many rackets use it.
  const want = new Map<string, { k: StockKey; n: number }>();
  for (const f of rackets)
    if (!f.ownString && f.stringId) {
      const key = `${f.stringId}|${f.stringColor}`;
      want.set(key, { k: { id: f.stringId, color: f.stringColor }, n: (want.get(key)?.n ?? 0) + 1 });
    }
  if (staffName === null)
    for (const { k, n } of want.values()) {
      const s = strings.find((x) => x.id === k.id);
      if (!s || n > colorStock(s, k.color)) return fail(409, soldOut(k));
    }
  const token = randomBytes(18).toString("base64url");
  const r = await inTransaction<{ id: string; token: string; tags: number[] }>(async (c) => {
    const { rows: o } = await c.query<{ id: string }>(
      `INSERT INTO stringing_orders (token, name, mobile, email, total, created_by, payment_method, payment_status, paid_amount, paid_at, paid_by)
       VALUES ($1, $2, $3, $4, $5::numeric, $6, COALESCE($7::text, 'cash'), CASE WHEN $7::text IS NULL THEN 'unpaid' ELSE 'paid' END,
               CASE WHEN $7::text IS NULL THEN 0 ELSE $5::numeric END, CASE WHEN $7::text IS NULL THEN NULL ELSE now() END,
               CASE WHEN $7::text IS NULL THEN NULL ELSE $8 END)
       RETURNING id`,
      [token, name, mobile, email, total, staffName ?? "", paidMethod, staffName]
    );
    const id = o[0].id;
    const tags: number[] = [];
    for (const f of rackets) {
      const { rows } = await c.query<{ tag: number }>(
        `INSERT INTO stringing_rackets (order_id, racket, string_id, string_name, string_color, own_string, tension_main, tension_cross,
                                        prestretch, rush, due_on, grommets_single, grommets_double, notes, labor_fee, rush_fee, string_price,
                                        grommet_fee, total, status, received_by, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING tag`,
        [id, f.racket, f.stringId, f.stringName, f.stringColor, f.ownString, f.tensionMain, f.tensionCross, f.prestretch, f.rush, f.dueOn,
          f.grommetsSingle, f.grommetsDouble, f.notes, f.price.labor, f.price.rush, f.price.string, f.price.grommets, f.price.total,
          receive ? "received" : "checked_in", receive ? receivedBy : null, receive ? new Date().toISOString() : null]
      );
      tags.push(rows[0].tag);
    }
    const tagText = tags.map(tagLabel).join(", ");
    // Strings bought from NVBC come off the stock. Customers can't buy more than there is; staff can
    // (the count may be behind), and the stock then shows below zero until it's corrected.
    for (const { k } of want.values()) {
      const ts = tags.filter((_, i) => !rackets[i].ownString && rackets[i].stringId === k.id && rackets[i].stringColor === k.color);
      const left = await moveStock(c, k, -ts.length, staffName ?? name, `Sold · ${ts.map(tagLabel).join(", ")} · ${name}`, staffName === null);
      if (left === null) return fail(409, soldOut(k));
    }
    await logEvent(c, id, staffName ?? name, "Checked in", `${tags.length} racket${tags.length === 1 ? "" : "s"} · ${tagText} · ${formatPeso(total)}${staffName ? "" : " · by the customer"}`);
    if (receive) await logEvent(c, id, receivedBy, "Received", tagText);
    if (paidMethod) await logEvent(c, id, staffName!, "Paid", `${paymentLabel(paidMethod)} · ${formatPeso(total)}`);
    return { ok: true, data: { id, token, tags } };
  });
  if (r.ok && staffName === null)
    await notifyStaff([{
      kind: "stringing",
      title: `Stringing check-in — ${name} (${r.data.tags.map(tagLabel).join(", ")})`,
      pushTitle: `Stringing check-in — ${publicName(name)}`,
      body: `${rackets.length} racket${rackets.length === 1 ? "" : "s"} · ${formatPeso(total)} · bring ${rackets.length === 1 ? "it" : "them"} to the desk to receive`,
    }]);
  if (r.ok && receive) later(() => sendReceived(r.data.id, r.data.tags));
  return r;
}

/** "Juan D." — for push notifications that may show on a locked screen. */
const publicName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]}.` : first;
};

// ---- The customer's status page -----------------------------------------------------------------

export type PublicRacket = Pick<RacketRow,
  "tag" | "racket" | "string_name" | "string_color" | "own_string" | "tension_main" | "tension_cross" | "prestretch" | "rush" | "due_on" |
  "grommets_single" | "grommets_double" | "notes" | "remarks" | "labor_fee" | "rush_fee" | "string_price" | "grommet_fee" | "total" |
  "status" | "received_at" | "started_at" | "done_at" | "picked_up_at">;

export type StringingView = {
  name: string; mobile: string; email: string; total: number; balance: number; paidAmount: number;
  paymentMethod: PaymentMethod; paymentStatus: PaymentStatus; paymentRef: string; hasProof: boolean; rejectedNote: string;
  createdAt: string; rackets: PublicRacket[]; methods: PaymentMethod[];
  feedback: { rating: number; comment: string } | null; canGiveFeedback: boolean;
  /** Changes whenever anything here does (see stringingStamp). */
  stamp: string;
};

async function orderByToken(token: unknown): Promise<OrderRow | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const { rows } = await db().query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM stringing_orders o WHERE o.token = $1`, [token]);
  return rows[0] ?? null;
}

const RACKET_PUBLIC = `tag, racket, string_name, string_color, own_string, tension_main, tension_cross, prestretch, rush, due_on, grommets_single,
  grommets_double, notes, remarks, labor_fee, rush_fee, string_price, grommet_fee, total, status, received_at, started_at, done_at, picked_up_at`;

/** The customer's page (/string/<token>): their rackets and where each one is, payment, and feedback. */
export async function stringingView(token: unknown): Promise<Result<StringingView>> {
  const o = await orderByToken(token);
  if (!o) return fail(404, "This stringing check-in wasn't found. Please check the link, or ask the front desk.");
  // Read first: a change made while the rest loads then shows as news on the next check, not missed.
  const { rows: st } = await db().query<{ stamp: string }>(`SELECT COALESCE(max(id), 0)::text AS stamp FROM stringing_events WHERE order_id = $1`, [o.id]);
  const [{ rows }, settings] = await Promise.all([
    db().query<PublicRacket>(`SELECT ${RACKET_PUBLIC} FROM stringing_rackets WHERE order_id = $1 ORDER BY tag`, [o.id]),
    getSettings(),
  ]);
  return {
    ok: true,
    data: {
      name: o.name, mobile: o.mobile, email: o.email, total: Number(o.total), balance: orderBalance(o), paidAmount: Number(o.paid_amount),
      paymentMethod: o.payment_method, paymentStatus: o.payment_status, paymentRef: o.payment_ref, hasProof: o.has_proof,
      rejectedNote: o.rejected_note, createdAt: o.created_at, rackets: rows, methods: stringingMethods(settings),
      feedback: o.feedback_rating ? { rating: o.feedback_rating, comment: o.feedback_comment } : null,
      canGiveFeedback: rows.some((r) => r.status === "picked_up"),
      stamp: st[0].stamp,
    },
  };
}

/**
 * A marker that changes whenever anything on the customer's page does (every change is logged as an
 * event), so the open page can check for news cheaply and only load it all when there is some.
 * null: no such check-in.
 */
export async function stringingStamp(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const { rows } = await db().query<{ stamp: string | null }>(
    `SELECT (SELECT COALESCE(max(e.id), 0)::text FROM stringing_events e WHERE e.order_id = o.id) AS stamp FROM stringing_orders o WHERE o.token = $1`, [token]
  );
  return rows[0]?.stamp ?? null;
}

/**
 * The customer pays online (reference number and/or screenshot, checked by staff), or says
 * they'll pay cash at the desk.
 */
export async function submitStringingPayment(token: unknown, input: Record<string, unknown>): Promise<Result<{ paymentStatus: PaymentStatus }>> {
  const o = await orderByToken(token);
  if (!o) return fail(404, "This stringing check-in wasn't found.");
  if (!["unpaid", "for_verification", "rejected"].includes(o.payment_status)) return fail(400, "This is already paid.");
  if (Number(o.total) <= 0) return fail(400, "There's nothing to pay.");
  const method = input.method;
  const settings = await getSettings();
  if (!isPaymentMethod(method) || !stringingMethods(settings).includes(method)) return fail(400, "Choose a payment method.");
  if (method === "cash") {
    await db().query(`UPDATE stringing_orders SET payment_method = 'cash' WHERE id = $1 AND payment_status <> 'paid'`, [o.id]);
    return { ok: true, data: { paymentStatus: o.payment_status } };
  }
  const ref = cleanRef(input.reference);
  const proof = input.proof === undefined || input.proof === null || input.proof === "" ? "" : input.proof;
  if (proof !== "" && !isProofImage(proof)) return fail(400, "The payment screenshot must be a PNG, JPG or WebP image under 700 KB.");
  if (!hasPaymentProof(ref, proof as string)) return fail(400, "Enter the reference number or upload a screenshot of your payment receipt.");
  if (ref && !/^[A-Za-z0-9][A-Za-z0-9 \-]{3,}$/.test(ref)) return fail(400, "Please enter the reference number from your payment receipt.");
  const paid = typeof input.amountPaid === "string" ? input.amountPaid.replace(/,/g, "").trim() : input.amountPaid;
  const reported = paid === undefined || paid === null || paid === "" ? null : Number(paid);
  if (reported !== null && (!Number.isFinite(reported) || reported <= 0 || reported >= 1_000_000))
    return fail(400, "Please check the amount you paid (or leave it blank).");
  const { rowCount } = await db().query(
    `UPDATE stringing_orders SET payment_method = $2,
            payment_ref = CASE WHEN $3 = '' THEN payment_ref ELSE $3 END,
            payment_proof = CASE WHEN $4 = '' THEN payment_proof ELSE $4 END,
            payment_proof_hash = CASE WHEN $4 = '' THEN payment_proof_hash ELSE md5($4) END,
            paid_amount_reported = COALESCE($5, paid_amount_reported),
            payment_status = 'for_verification', payment_sent_at = now(), rejected_note = ''
      WHERE id = $1 AND payment_status IN ('unpaid', 'for_verification', 'rejected')`,
    [o.id, method, ref, proof, reported === null ? null : round2(reported)]
  );
  if (!rowCount) return fail(400, "This is already paid.");
  await logEvent(db(), o.id, o.name, "Payment sent", `${paymentLabel(method)}${ref ? ` · ref ${ref}` : ""}${proof ? " · screenshot" : ""}`);
  await notifyStaff([{
    kind: "stringing",
    title: `Stringing payment sent — ${o.name}`,
    pushTitle: `Stringing payment sent — ${publicName(o.name)}`,
    body: `${paymentLabel(method)}${ref ? ` ref ${ref}` : ""} · ${formatPeso(Number(o.total))} — please verify`,
  }]);
  return { ok: true, data: { paymentStatus: "for_verification" } };
}

/** 1–5 stars and a comment, once at least one racket has been picked up. Can be changed. */
export async function submitStringingFeedback(token: unknown, rating: unknown, comment: unknown): Promise<Result<{ ok: true }>> {
  const o = await orderByToken(token);
  if (!o) return fail(404, "This stringing check-in wasn't found.");
  const n = Number(rating);
  if (!Number.isInteger(n) || n < 1 || n > 5) return fail(400, "Tap 1 to 5 stars.");
  const note = typeof comment === "string" ? comment.trim().slice(0, 1000) : "";
  const { rowCount } = await db().query(
    `UPDATE stringing_orders SET feedback_rating = $2, feedback_comment = $3, feedback_at = now()
      WHERE id = $1 AND EXISTS (SELECT 1 FROM stringing_rackets WHERE order_id = $1 AND status = 'picked_up')`,
    [o.id, n, note]
  );
  if (!rowCount) return fail(400, "You can rate the stringing once you've picked up your racket.");
  if (!o.feedback_rating)
    await notifyStaff([{
      kind: "stringing",
      title: `Stringing feedback — ${o.name}: ${"★".repeat(n)}${"☆".repeat(5 - n)}`,
      pushTitle: `Stringing feedback: ${"★".repeat(n)}${"☆".repeat(5 - n)}`,
      body: note.slice(0, 200) || "No comment",
    }]);
  return { ok: true, data: { ok: true } };
}

export async function setStringingEmail(token: unknown, email: unknown): Promise<Result<{ email: string }>> {
  const o = await orderByToken(token);
  if (!o) return fail(404, "This stringing check-in wasn't found.");
  const e = text(email, 120).toLowerCase();
  if (e && !isEmail(e)) return fail(400, "Please check the email address.");
  await db().query(`UPDATE stringing_orders SET email = $2 WHERE id = $1`, [o.id, e]);
  return { ok: true, data: { email: e } };
}

/** Turns "tell me when it's ready" on (subscription) or off for this device. */
export async function setStringingPush(token: unknown, on: boolean, sub: unknown): Promise<Result<{ on: boolean }>> {
  const o = await orderByToken(token);
  if (!o) return fail(404, "This stringing check-in wasn't found.");
  const s = (sub ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof s.endpoint === "string" ? s.endpoint : "";
  if (!on) {
    await db().query(`DELETE FROM stringing_push_subscriptions WHERE order_id = $1 AND endpoint = $2`, [o.id, endpoint]);
    return { ok: true, data: { on: false } };
  }
  const p256dh = typeof s.keys?.p256dh === "string" ? s.keys.p256dh : "";
  const auth = typeof s.keys?.auth === "string" ? s.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100)
    return fail(400, "This device couldn't be registered for notifications.");
  await db().query(
    `INSERT INTO stringing_push_subscriptions (order_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [o.id, endpoint, p256dh, auth]
  );
  await db().query(
    `DELETE FROM stringing_push_subscriptions WHERE order_id = $1 AND endpoint NOT IN
       (SELECT endpoint FROM stringing_push_subscriptions WHERE order_id = $1 ORDER BY created_at DESC LIMIT 5)`,
    [o.id]
  );
  return { ok: true, data: { on: true } };
}

/** Whether this device gets notifications for the order. */
export async function stringingPushOn(token: unknown, endpoint: unknown): Promise<boolean> {
  const o = await orderByToken(token);
  if (!o || typeof endpoint !== "string") return false;
  const { rowCount } = await db().query(`SELECT 1 FROM stringing_push_subscriptions WHERE order_id = $1 AND endpoint = $2`, [o.id, endpoint]);
  return !!rowCount;
}

// ---- Notices to the customer --------------------------------------------------------------------

const statusLink = (token: string) => `${siteOrigin()}/string/${token}`;

/** Push to the customer's devices, and email them if they gave an address. */
async function tellCustomer(orderId: string, n: { title: string; body: string; subject: string; email: string }): Promise<void> {
  const { rows } = await db().query<{ token: string; email: string }>(`SELECT token, email FROM stringing_orders WHERE id = $1`, [orderId]);
  const o = rows[0];
  if (!o) return;
  const { rows: subs } = await db().query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM stringing_push_subscriptions WHERE order_id = $1`, [orderId]
  );
  if (subs.length && setupVapid()) {
    const payload = JSON.stringify({ title: n.title, body: n.body, url: `/string/${o.token}`, tag: `nvbc-string-${orderId}` });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600 });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db().query(`DELETE FROM stringing_push_subscriptions WHERE endpoint = $1`, [s.endpoint]);
        else console.error("stringing push failed", code ?? e);
      }
    }));
  }
  if (o.email && emailSender()) {
    try {
      await sendEmail(o.email, n.subject, n.email);
    } catch (e) {
      console.error("stringing email failed", e instanceof Error ? e.message : e);
    }
  }
}

async function orderForNotice(orderId: string) {
  const { rows } = await db().query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM stringing_orders o WHERE o.id = $1`, [orderId]);
  const { rows: rackets } = await db().query<Pick<RacketRow, "tag" | "racket" | "status" | "due_on">>(
    `SELECT tag, racket, status, due_on FROM stringing_rackets WHERE order_id = $1 ORDER BY tag`, [orderId]
  );
  return rows[0] ? { o: rows[0], rackets } : null;
}

async function sendReceived(orderId: string, tags: number[]) {
  const x = await orderForNotice(orderId);
  if (!x) return;
  const mine = x.rackets.filter((r) => tags.includes(r.tag));
  if (!mine.length) return;
  const dueOn = mine.map((r) => r.due_on).sort().at(-1)!;
  await tellCustomer(orderId, receivedMessage({ name: x.o.name, rackets: mine, dueOn, link: statusLink(x.o.token) }));
}

async function sendReady(orderId: string, tags: number[]) {
  const x = await orderForNotice(orderId);
  if (!x) return;
  const mine = x.rackets.filter((r) => tags.includes(r.tag));
  const waiting = x.rackets.filter((r) => ["checked_in", "received", "in_progress"].includes(r.status)).length;
  const m = readyMessage({ name: x.o.name, rackets: mine, waiting, balance: orderBalance(x.o), link: statusLink(x.o.token) });
  await tellCustomer(orderId, { ...m, body: m.body });
}

async function sendThankYou(orderId: string) {
  const x = await orderForNotice(orderId);
  if (!x) return;
  await tellCustomer(orderId, thankYouMessage({ name: x.o.name, link: statusLink(x.o.token) + "#feedback" }));
}

/** The "ready" and "thank you" texts for staff to send by SMS themselves. */
export async function smsTemplates(orderId: string): Promise<Result<{ mobile: string; link: string; track: string; ready: string; thanks: string }>> {
  const x = isId(orderId) ? await orderForNotice(orderId) : null;
  if (!x) return fail(404, "Check-in not found.");
  const done = x.rackets.filter((r) => r.status === "done" || r.status === "picked_up");
  const waiting = x.rackets.filter((r) => ["checked_in", "received", "in_progress"].includes(r.status)).length;
  const link = statusLink(x.o.token);
  return {
    ok: true,
    data: {
      mobile: x.o.mobile,
      link,
      track: trackingMessage({
        name: x.o.name,
        rackets: x.rackets.filter((r) => r.status !== "cancelled"),
        dueOn: x.rackets.filter((r) => ["checked_in", "received", "in_progress"].includes(r.status)).map((r) => r.due_on).sort().at(-1) ?? null,
        link,
      }),
      ready: readyMessage({ name: x.o.name, rackets: done.length ? done : x.rackets.filter((r) => r.status !== "cancelled"), waiting, balance: orderBalance(x.o), link }).sms,
      thanks: thankYouMessage({ name: x.o.name, link: link + "#feedback" }).sms,
    },
  };
}

// ---- Staff: the queue ---------------------------------------------------------------------------

export type QueueRacket = RacketRow & {
  name: string; mobile: string; token: string; payment_status: PaymentStatus; payment_method: PaymentMethod;
  order_total: number; balance: number; has_proof: boolean; order_rackets: number;
};

export const QUEUE_VIEWS = ["to_receive", "waiting", "in_progress", "ready", "picked_up", "cancelled"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];
const VIEW_SQL: Record<QueueView, { where: string; order: string }> = {
  to_receive: { where: "r.status = 'checked_in'", order: "r.created_at, r.tag" },
  waiting: { where: "r.status = 'received'", order: "r.rush DESC, r.due_on, r.tag" },
  in_progress: { where: "r.status = 'in_progress'", order: "r.rush DESC, r.due_on, r.tag" },
  ready: { where: "r.status = 'done'", order: "r.done_at, r.tag" },
  picked_up: { where: "r.status = 'picked_up' AND r.picked_up_at > now() - interval '30 days'", order: "r.picked_up_at DESC" },
  cancelled: { where: "r.status = 'cancelled' AND r.cancelled_at > now() - interval '30 days'", order: "r.cancelled_at DESC" },
};
const STRINGER_VIEWS: QueueView[] = ["waiting", "in_progress", "ready"];

/**
 * The rackets in one step of the queue (or matching a search: a tag number, name or mobile), and
 * how many are in each step. Stringers see only waiting, in progress and ready, without payments.
 */
export type QueueTurnaround = Pick<StringingPrices, "standardDays" | "rushDays" | "turnaroundChanged">;
export async function stringingQueue(view: unknown, q: unknown, stringer: boolean): Promise<{ rackets: QueueRacket[]; counts: Record<QueueView, number>; tagQr: boolean; turnaround: QueueTurnaround }> {
  const search = text(q, 60);
  const v: QueueView = QUEUE_VIEWS.includes(view as QueueView) && (!stringer || STRINGER_VIEWS.includes(view as QueueView)) ? (view as QueueView) : "waiting";
  const tag = /^#?\s*\d{1,7}$/.test(search) ? Number(search.replace(/\D/g, "")) : null;
  const digits = search.replace(/\D/g, "");
  const where = search
    ? `(r.tag = $1 OR o.name ILIKE '%' || $2 || '%' OR (length($3) >= 4 AND o.mobile LIKE '%' || $3 || '%') OR r.racket ILIKE '%' || $2 || '%')
       ${stringer ? "AND r.status IN ('received', 'in_progress', 'done')" : ""}`
    : VIEW_SQL[v].where;
  const [{ rows }, counts, settings] = await Promise.all([
    db().query<QueueRacket>(
      `SELECT r.*, o.name, o.mobile, o.token, o.payment_status, o.payment_method, o.total AS order_total, o.paid_amount,
              (o.payment_proof <> '') AS has_proof,
              (SELECT count(*)::int FROM stringing_rackets x WHERE x.order_id = o.id AND x.status <> 'cancelled') AS order_rackets
         FROM stringing_rackets r JOIN stringing_orders o ON o.id = r.order_id
        WHERE ${where}
        ORDER BY ${search ? "(r.status IN ('picked_up', 'cancelled')), r.tag DESC" : VIEW_SQL[v].order}
        LIMIT 200`,
      search ? [tag ?? -1, search, digits] : []
    ),
    db().query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM stringing_rackets
        WHERE status IN ('checked_in', 'received', 'in_progress', 'done')
           OR (status = 'picked_up' AND picked_up_at > now() - interval '30 days')
           OR (status = 'cancelled' AND cancelled_at > now() - interval '30 days')
        GROUP BY status`
    ),
    getSettings(),
  ]);
  const c = (s: string) => counts.rows.find((x) => x.status === s)?.n ?? 0;
  const list = rows.map((r) => {
    const balance = orderBalance({ total: r.order_total, paid_amount: (r as unknown as { paid_amount: number }).paid_amount, payment_status: r.payment_status });
    return stringer
      ? { ...r, mobile: "", token: "", payment_status: "unpaid" as PaymentStatus, payment_method: "cash" as PaymentMethod, order_total: 0, balance: 0, has_proof: false }
      : { ...r, balance };
  });
  return {
    rackets: list,
    counts: {
      to_receive: c("checked_in"), waiting: c("received"), in_progress: c("in_progress"), ready: c("done"),
      picked_up: c("picked_up"), cancelled: c("cancelled"),
    },
    tagQr: settings.stringing.tagQr,
    turnaround: {
      standardDays: settings.stringing.standardDays, rushDays: settings.stringing.rushDays,
      turnaroundChanged: stringer ? null : settings.stringing.turnaroundChanged,
    },
  };
}

export type PaymentReuse = { kind: "booking" | "stringing"; code: string; name: string; date: string; status: string; same_ref: boolean; same_proof: boolean };
export type StringingEvent = { at: string; actor: string; action: string; details: string };
export type OrderDetail = { order: OrderRow & { balance: number }; rackets: RacketRow[]; events: StringingEvent[]; reuse: PaymentReuse[] };

/** One check-in with all its rackets, its history, and other payments with the same reference or screenshot. */
export async function stringingOrder(id: string): Promise<Result<OrderDetail>> {
  if (!isId(id)) return fail(400, "Invalid check-in.");
  const { rows } = await db().query<OrderRow & { ref_key: string; proof_hash: string }>(
    `SELECT ${ORDER_COLUMNS}, o.payment_ref_key AS ref_key, o.payment_proof_hash AS proof_hash FROM stringing_orders o WHERE o.id = $1`, [id]
  );
  const o = rows[0];
  if (!o) return fail(404, "Check-in not found.");
  const [rackets, events, reuse] = await Promise.all([
    db().query<RacketRow>(`SELECT * FROM stringing_rackets WHERE order_id = $1 ORDER BY tag`, [id]),
    db().query<StringingEvent>(`SELECT at, actor, action, details FROM stringing_events WHERE order_id = $1 ORDER BY at DESC, id DESC`, [id]),
    o.ref_key || o.proof_hash
      ? db().query<PaymentReuse>(
          `SELECT 'booking' AS kind, b.cancel_code AS code, b.player_name AS name, b.booking_date::text AS date, b.status,
                  ($1 <> '' AND b.payment_ref_key = $1) AS same_ref, ($2 <> '' AND b.payment_proof_hash = $2) AS same_proof
             FROM bookings b
            WHERE b.group_id IS NULL AND (($1 <> '' AND b.payment_ref_key = $1) OR ($2 <> '' AND b.payment_proof_hash = $2))
           UNION ALL
           SELECT 'stringing', (SELECT string_agg('#' || tag, ', ' ORDER BY tag) FROM stringing_rackets WHERE order_id = x.id), x.name,
                  (x.created_at AT TIME ZONE 'Asia/Manila')::date::text, x.payment_status,
                  ($1 <> '' AND x.payment_ref_key = $1), ($2 <> '' AND x.payment_proof_hash = $2)
             FROM stringing_orders x
            WHERE x.id <> $3 AND (($1 <> '' AND x.payment_ref_key = $1) OR ($2 <> '' AND x.payment_proof_hash = $2))
            LIMIT 20`,
          [o.ref_key, o.proof_hash, id]
        )
      : Promise.resolve({ rows: [] as PaymentReuse[] }),
  ]);
  const { ref_key: _r, proof_hash: _p, ...order } = o;
  return { ok: true, data: { order: { ...order, balance: orderBalance(order) }, rackets: rackets.rows, events: events.rows, reuse: reuse.rows } };
}

/** The order a racket belongs to (from its tag, e.g. a scanned tag). */
export async function orderIdForTag(tag: number): Promise<string | null> {
  const { rows } = await db().query<{ order_id: string }>(`SELECT order_id FROM stringing_rackets WHERE tag = $1`, [tag]);
  return rows[0]?.order_id ?? null;
}

// ---- Staff and stringers: moving rackets along --------------------------------------------------

export type StepAction = "receive" | "start" | "done" | "pickup" | "undo" | "cancel";
const FROM: Record<Exclude<StepAction, "undo">, RacketStatus[]> = {
  receive: ["checked_in"],
  start: ["received"],
  done: ["received", "in_progress"],
  pickup: ["done"],
  cancel: ["checked_in", "received", "in_progress", "done"],
};
const UNDO: Partial<Record<RacketStatus, { to: RacketStatus; clear: string }>> = {
  received: { to: "checked_in", clear: "received_by = NULL, received_at = NULL" },
  in_progress: { to: "received", clear: "started_by = NULL, started_at = NULL" },
  done: { to: "in_progress", clear: "done_by = NULL, done_at = NULL" },
  picked_up: { to: "done", clear: "picked_up_by = NULL, picked_up_at = NULL" },
  cancelled: { to: "checked_in", clear: "cancelled_by = NULL, cancelled_at = NULL" },
};
/** Where a cancelled racket was before it was cancelled (from the steps it had done). */
const beforeCancel = (r: RacketRow): RacketStatus =>
  r.done_at ? "done" : r.started_at ? "in_progress" : r.received_at ? "received" : "checked_in";

const ACTION_LABEL: Record<StepAction, string> = {
  receive: "Received", start: "Started stringing", done: "Done (ready for pickup)", pickup: "Picked up", undo: "Undone", cancel: "Cancelled",
};

/**
 * Moves rackets to their next step: receive (at the desk: who received them), start and finish
 * stringing, hand back (picked up), cancel, or undo the last step. Stringers may only start,
 * finish, and undo those. The customer is told when rackets are received and ready, and thanked
 * once everything is picked up.
 */
export async function stepRackets(
  ids: unknown,
  action: unknown,
  me: { name: string; stringer: boolean; strings?: boolean },
  extra: { paidMethod?: unknown } = {}
): Promise<Result<{ tags: number[] }>> {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(isId);
  if (!list.length) return fail(400, "Choose the rackets.");
  if (!["receive", "start", "done", "pickup", "undo", "cancel"].includes(action as string)) return fail(400, "Unknown action.");
  const a = action as StepAction;
  if (me.stringer && !["start", "done", "undo"].includes(a)) return fail(403, "Only the front desk can do this.");
  // A Scholar who isn't also a stringer does the desk side only.
  const strings = me.strings !== false;
  if (!strings && (a === "start" || a === "done")) return fail(403, "Only stringers can start or finish stringing.");
  const receivedBy = me.name; // always whoever is logged in
  const paidMethod = a === "receive" && isPaymentMethod(extra.paidMethod) ? extra.paidMethod : null;
  const touched = new Map<string, number[]>(); // order → tags
  const r = await inTransaction<{ tags: number[] }>(async (c) => {
    const { rows } = await c.query<RacketRow>(`SELECT * FROM stringing_rackets WHERE id = ANY($1::uuid[]) ORDER BY tag FOR UPDATE`, [list]);
    if (rows.length !== list.length) return fail(404, "Some of those rackets weren't found.");
    for (const x of rows) {
      if (a === "undo") {
        const u = UNDO[x.status];
        if (!u) return fail(400, `${tagLabel(x.tag)} has nothing to undo.`);
        if (me.stringer && !["in_progress", "done"].includes(x.status)) return fail(403, "Only the front desk can undo this.");
        if (!strings && ["in_progress", "done"].includes(x.status)) return fail(403, "Only stringers can undo stringing.");
        await c.query(`UPDATE stringing_rackets SET status = $2, ${u.clear} WHERE id = $1`, [x.id, x.status === "cancelled" ? beforeCancel(x) : u.to]);
        const sid = boughtString(x);
        if (x.status === "cancelled" && sid) await moveStock(c, sid, -1, me.name, `Cancel undone · ${tagLabel(x.tag)}`);
      } else {
        if (!FROM[a].includes(x.status)) return fail(409, `${tagLabel(x.tag)} is already “${x.status.replace("_", " ")}” — refresh to see the latest.`);
        const set =
          a === "receive" ? `status = 'received', received_by = $2, received_at = now()`
          : a === "start" ? `status = 'in_progress', started_by = $2, started_at = now()`
          : a === "done" ? `status = 'done', done_by = $2, done_at = now(), started_by = COALESCE(started_by, $2), started_at = COALESCE(started_at, now())`
          : a === "pickup" ? `status = 'picked_up', picked_up_by = $2, picked_up_at = now()`
          : `status = 'cancelled', cancelled_by = $2, cancelled_at = now()`;
        await c.query(`UPDATE stringing_rackets SET ${set} WHERE id = $1`, [x.id, a === "receive" ? receivedBy : me.name]);
        const sid = boughtString(x);
        if (a === "cancel" && sid) await moveStock(c, sid, 1, me.name, `Put back · ${tagLabel(x.tag)} cancelled`);
      }
      touched.set(x.order_id, [...(touched.get(x.order_id) ?? []), x.tag]);
    }
    for (const [orderId, tags] of touched) {
      if (a === "cancel" || (a === "undo" && rows.some((x) => x.order_id === orderId && x.status === "cancelled"))) await recomputeTotal(c, orderId);
      const undone = a === "undo"
        ? ` (${rows.filter((x) => x.order_id === orderId).map((x) => `${tagLabel(x.tag)} back to ${(x.status === "cancelled" ? beforeCancel(x) : UNDO[x.status]!.to).replace("_", " ")}`).join(", ")})`
        : "";
      await logEvent(c, orderId, a === "receive" ? receivedBy : me.name, ACTION_LABEL[a], tags.map(tagLabel).join(", ") + undone);
      if (paidMethod) {
        const { rowCount } = await c.query(
          `UPDATE stringing_orders SET payment_status = 'paid', payment_method = $2, paid_amount = total, paid_at = now(), paid_by = $3, payment_proof = ''
            WHERE id = $1 AND payment_status <> 'paid'`,
          [orderId, paidMethod, me.name]
        );
        if (rowCount) await logEvent(c, orderId, me.name, "Paid", paymentLabel(paidMethod));
      }
    }
    return { ok: true, data: { tags: rows.map((x) => x.tag) } };
  });
  if (!r.ok) return r;
  for (const [orderId, tags] of touched) {
    if (a === "receive") later(() => sendReceived(orderId, tags));
    if (a === "done") later(() => sendReady(orderId, tags));
    if (a === "pickup")
      later(async () => {
        // Everything picked up (or cancelled): thank them once, with the feedback link.
        const { rowCount } = await db().query(
          `UPDATE stringing_orders SET thanked_at = now()
            WHERE id = $1 AND thanked_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM stringing_rackets WHERE order_id = $1 AND status NOT IN ('picked_up', 'cancelled'))`,
          [orderId]
        );
        if (rowCount) await sendThankYou(orderId);
      });
  }
  return r;
}

/** Staff correct a racket's details (racket, string, tension, rush, date, grommets, notes); its price is worked out again. */
export async function editRacket(id: string, input: Record<string, unknown>, by: string): Promise<Result<{ total: number }>> {
  if (!isId(id)) return fail(400, "Invalid racket.");
  const [settings, strings] = await Promise.all([getSettings(), listStrings(false)]);
  return inTransaction(async (c) => {
    const { rows } = await c.query<RacketRow>(`SELECT * FROM stringing_rackets WHERE id = $1 FOR UPDATE`, [id]);
    const cur = rows[0];
    if (!cur) return fail(404, "Racket not found.");
    const f = readRacket(input, { strings, prices: settings.stringing, today: nowAtFacility().date, staff: true, keepStringId: cur.string_id });
    if (typeof f === "string") return fail(400, f);
    // A string bought earlier keeps its price unless the string changed.
    const stringPrice = !f.ownString && f.stringId === cur.string_id ? Number(cur.string_price) : f.price.string;
    const price = racketPrice({ rush: f.rush, stringPrice, grommetsSingle: f.grommetsSingle, grommetsDouble: f.grommetsDouble }, settings.stringing);
    await c.query(
      `UPDATE stringing_rackets SET racket = $2, string_id = $3, string_name = $4, string_color = $5, own_string = $6, tension_main = $7,
              tension_cross = $8, rush = $9, due_on = $10, grommets_single = $11, grommets_double = $12, notes = $13, labor_fee = $14,
              rush_fee = $15, string_price = $16, grommet_fee = $17, total = $18, prestretch = $19
        WHERE id = $1`,
      [id, f.racket, f.stringId, f.stringName, f.stringColor, f.ownString, f.tensionMain, f.tensionCross, f.rush, f.dueOn,
        f.grommetsSingle, f.grommetsDouble, f.notes, price.labor, price.rush, price.string, price.grommets, price.total, f.prestretch]
    );
    // A different NVBC string or colour: the old one goes back into stock and the new one comes off.
    const was = boughtString(cur);
    const now = boughtString({ own_string: f.ownString, string_id: f.stringId, string_color: f.stringColor });
    if (!sameStock(was, now) && cur.status !== "cancelled") {
      const what = was && now && was.id === now.id ? "colour" : "string";
      if (was) await moveStock(c, was, 1, by, `Put back · ${tagLabel(cur.tag)} changed ${what}`);
      if (now) await moveStock(c, now, -1, by, `Sold · ${tagLabel(cur.tag)} (edited)`);
    }
    await recomputeTotal(c, cur.order_id);
    const changes = [
      cur.racket !== f.racket && `racket ${f.racket}`,
      (cur.string_name !== f.stringName || cur.string_color !== f.stringColor) && `string ${f.stringName}${f.stringColor ? ` (${f.stringColor})` : ""}`,
      (Number(cur.tension_main) !== f.tensionMain || Number(cur.tension_cross) !== f.tensionCross) && `tension ${tensionLabel(f.tensionMain, f.tensionCross)}`,
      (cur.prestretch ?? null) !== f.prestretch && (f.prestretch ? `pre-stretch ${f.prestretch}%` : "no pre-stretch"),
      cur.rush !== f.rush && (f.rush ? "rush" : "not rush"),
      cur.due_on !== f.dueOn && `collection ${f.dueOn}`,
      (cur.grommets_single !== f.grommetsSingle || cur.grommets_double !== f.grommetsDouble) && `grommets ${f.grommetsSingle} single, ${f.grommetsDouble} double`,
      cur.notes !== f.notes && "notes",
      Number(cur.total) !== price.total && `${formatPeso(Number(cur.total))} → ${formatPeso(price.total)}`,
    ].filter(Boolean);
    if (changes.length) await logEvent(c, cur.order_id, by, `Edited ${tagLabel(cur.tag)}`, changes.join(" · "));
    return { ok: true, data: { total: price.total } };
  });
}

/** The stringer (or the desk) notes what they noticed about a racket; "" removes it. The customer sees it. */
export async function setRemarks(id: string, input: unknown, by: string): Promise<Result<{ remarks: string }>> {
  if (!isId(id)) return fail(400, "Invalid racket.");
  const remarks = longText(input, 500);
  const { rows } = await db().query<{ order_id: string; tag: number; remarks: string }>(
    `SELECT order_id, tag, remarks FROM stringing_rackets WHERE id = $1`, [id]
  );
  const cur = rows[0];
  if (!cur) return fail(404, "Racket not found.");
  if (cur.remarks === remarks) return { ok: true, data: { remarks } };
  await db().query(`UPDATE stringing_rackets SET remarks = $2 WHERE id = $1`, [id, remarks]);
  await logEvent(db(), cur.order_id, by, `Remarks on ${tagLabel(cur.tag)}`, remarks || "removed");
  return { ok: true, data: { remarks } };
}

/** Staff correct the customer's name, mobile or email. */
export async function editCustomer(id: string, input: Record<string, unknown>, by: string): Promise<Result<{ id: string }>> {
  if (!isId(id)) return fail(400, "Invalid check-in.");
  const name = text(input.name, 80);
  const mobile = normalizeMobile(input.mobile);
  const email = text(input.email, 120).toLowerCase();
  if (name.length < 2) return fail(400, "Enter the customer's name.");
  if (!mobile) return fail(400, "Enter a mobile number like 0917 123 4567.");
  if (email && !isEmail(email)) return fail(400, "Please check the email address (or leave it blank).");
  const { rowCount } = await db().query(`UPDATE stringing_orders SET name = $2, mobile = $3, email = $4 WHERE id = $1`, [id, name, mobile, email]);
  if (!rowCount) return fail(404, "Check-in not found.");
  await logEvent(db(), id, by, "Customer details edited", `${name} · ${mobile}${email ? ` · ${email}` : ""}`);
  return { ok: true, data: { id } };
}

/**
 * Staff record the payment: paid (how, and the reference if any), not paid yet, no charge, or
 * rejected (the screenshot or reference didn't check out; the customer is told why).
 */
export async function setStringingPayment(id: string, input: Record<string, unknown>, by: string): Promise<Result<{ id: string }>> {
  if (!isId(id)) return fail(400, "Invalid check-in.");
  const status = input.status;
  if (!["paid", "unpaid", "waived", "rejected"].includes(status as string)) return fail(400, "Unknown payment status.");
  const method = isPaymentMethod(input.method) ? input.method : null;
  const ref = input.reference === undefined ? null : cleanRef(input.reference);
  const note = text(input.note, 200);
  if (status === "rejected" && note.length < 3) return fail(400, "Say why the payment was rejected (the customer sees it).");
  const { rows } = await db().query<{ name: string; token: string; payment_method: PaymentMethod; total: number }>(
    `UPDATE stringing_orders SET payment_status = $2, payment_method = COALESCE($3, payment_method), payment_ref = COALESCE($4, payment_ref),
            paid_amount = CASE WHEN $2 = 'paid' THEN total ELSE 0 END,
            paid_at = CASE WHEN $2 = 'paid' THEN now() END, paid_by = CASE WHEN $2 IN ('paid', 'waived') THEN $5 END,
            rejected_note = CASE WHEN $2 = 'rejected' THEN $6 ELSE '' END,
            -- Checked (or rejected): the screenshot isn't kept; its fingerprint stays, to spot reuse.
            payment_proof = CASE WHEN $2 IN ('paid', 'waived', 'rejected') THEN '' ELSE payment_proof END
      WHERE id = $1 RETURNING name, token, payment_method, total`,
    [id, status, method, ref, by.slice(0, 60), note]
  );
  if (!rows[0]) return fail(404, "Check-in not found.");
  const o = rows[0];
  await logEvent(db(), id, by, { paid: "Paid", unpaid: "Set to not paid", waived: "No charge", rejected: "Payment rejected" }[status as string]!,
    `${paymentLabel(o.payment_method)} · ${formatPeso(Number(o.total))}${ref ? ` · ref ${ref}` : ""}${note ? ` · ${note}` : ""}`);
  if (status === "rejected")
    later(() => tellCustomer(id, {
      title: "We couldn't confirm your stringing payment",
      body: note,
      subject: "We couldn't confirm your stringing payment",
      email: `Hi ${o.name.split(/\s+/)[0]},\n\nWe couldn't confirm your payment for racket stringing: ${note}\n\nPlease send it again or pay at the front desk: ${statusLink(o.token)}\n\nNV Badminton Center`,
    }));
  return { ok: true, data: { id } };
}

/** Owner/manager: delete a check-in made by mistake (with its rackets and history). */
export async function deleteStringingOrder(id: string, by: string): Promise<Result<{ id: string }>> {
  if (!isId(id)) return fail(400, "Invalid check-in.");
  return inTransaction<{ id: string }>(async (c) => {
    const { rows: rackets } = await c.query<RacketRow>(`SELECT * FROM stringing_rackets WHERE order_id = $1 AND status <> 'cancelled' FOR UPDATE`, [id]);
    for (const x of rackets) {
      const sid = boughtString(x);
      if (sid) await moveStock(c, sid, 1, by, `Put back · ${tagLabel(x.tag)} check-in deleted`);
    }
    const { rows } = await c.query<{ name: string }>(`DELETE FROM stringing_orders WHERE id = $1 RETURNING name`, [id]);
    if (!rows[0]) return fail(404, "Check-in not found.");
    console.log(`Stringing check-in for ${rows[0].name} deleted by ${by}`);
    return { ok: true, data: { id } };
  });
}

/** The proof screenshot (data: URL), for staff. */
export async function stringingProof(id: string): Promise<string> {
  if (!isId(id)) return "";
  const { rows } = await db().query<{ payment_proof: string }>(`SELECT payment_proof FROM stringing_orders WHERE id = $1`, [id]);
  return rows[0]?.payment_proof ?? "";
}

/** Staff check-in: the customer's name and email, and their rackets from earlier check-ins (by mobile). */
export async function customerByMobile(raw: unknown): Promise<{ name: string; email: string; rackets: Partial<RacketRow>[] } | null> {
  const mobile = normalizeMobile(raw);
  if (!mobile) return null;
  const { rows } = await db().query<{ name: string; email: string }>(
    `SELECT name, email FROM stringing_orders WHERE mobile = $1 ORDER BY created_at DESC LIMIT 1`, [mobile]
  );
  if (!rows[0]) return null;
  const { rows: rackets } = await db().query<Partial<RacketRow>>(
    `SELECT DISTINCT ON (lower(r.racket)) r.racket, r.string_id, r.string_name, r.string_color, r.own_string, r.tension_main, r.tension_cross, r.prestretch
       FROM stringing_rackets r JOIN stringing_orders o ON o.id = r.order_id
      WHERE o.mobile = $1 AND r.status <> 'cancelled'
      ORDER BY lower(r.racket), r.created_at DESC LIMIT 10`,
    [mobile]
  );
  return { ...rows[0], rackets };
}

// ---- Strings and stock (all staff); prices and the stringer report (owner/managers) -------------

export const allStrings = () => listStrings(false);

/** Sets per colour from a form: {"Black": "5", …} (or a plain number for a string without colours). */
function readCounts(raw: unknown, colors: string[], allowNegative: boolean): Map<string, number> | string {
  const out = new Map<string, number>();
  const keys = colors.length ? colors : [""];
  const entries: [string, unknown][] =
    raw && typeof raw === "object" && !Array.isArray(raw) ? Object.entries(raw as Record<string, unknown>)
    : raw === undefined || raw === null || raw === "" ? [] : [["", raw]];
  for (const [given, v] of entries) {
    if (v === "" || v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || Math.abs(n) > 10_000 || (!allowNegative && n < 0)) return "Enter a whole number of sets for each colour.";
    // Match the colour ignoring case and spacing; one no longer on the list can still be counted.
    const color = keys.find((k) => k.toLowerCase() === given.trim().toLowerCase()) ?? text(given, 30);
    out.set(color, (out.get(color) ?? 0) + n);
  }
  return out;
}

/**
 * Adds a string ({brand, model, colors, price, stock: {colour: sets}}) or changes one
 * ({id, …, active}; its stock is changed with adjustStock).
 */
export async function saveString(input: Record<string, unknown>, by: string): Promise<Result<StringItem>> {
  const brand = text(input.brand, 40);
  const model = text(input.model, 60);
  if (brand.length < 2 || model.length < 1) return fail(400, "Enter the brand and model.");
  const raw = Array.isArray(input.colors) ? input.colors : typeof input.colors === "string" ? input.colors.split(",") : [];
  const colors = mergeSuggestions(raw.map((c) => text(c, 30))).slice(0, 30);
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0 || price > 100_000) return fail(400, "Enter the string's price (₱0 if it's free).");
  const active = input.active !== false;
  if (input.id) {
    const { rowCount } = await db().query(
      `UPDATE stringing_strings SET brand = $2, model = $3, colors = $4, price = $5, active = $6 WHERE id = $1`,
      [Number(input.id), brand, model, colors, round2(price), active]
    );
    const saved = rowCount ? await oneString(db(), Number(input.id)) : undefined;
    return saved ? { ok: true, data: saved } : fail(404, "String not found.");
  }
  const counts = readCounts(input.stock, colors, false);
  if (typeof counts === "string") return fail(400, counts);
  return inTransaction<StringItem>(async (c) => {
    const { rows } = await c.query<{ id: number }>(
      `INSERT INTO stringing_strings (brand, model, colors, price, active) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [brand, model, colors, round2(price), active]
    );
    for (const [color, n] of counts) if (n) await moveStock(c, { id: rows[0].id, color }, n, by, "Starting stock");
    return { ok: true, data: (await oneString(c, rows[0].id))! };
  });
}

/**
 * Staff add a delivery ({mode: "add", counts: {Black: 10, White: 5}}) or set the count after counting
 * ({mode: "set", counts: {Black: 7}}), per colour, with an optional note.
 */
export async function adjustStock(id: unknown, input: Record<string, unknown>, by: string): Promise<Result<StringItem>> {
  const n = Number(id);
  if (!Number.isInteger(n)) return fail(400, "Invalid string.");
  const note = text(input.note, 120);
  const mode = input.mode === "set" ? "set" : input.mode === "add" ? "add" : null;
  if (!mode) return fail(400, "Choose whether to add a delivery or set the count.");
  return inTransaction<StringItem>(async (c) => {
    const { rows } = await c.query<{ colors: string[] }>(`SELECT colors FROM stringing_strings WHERE id = $1 FOR UPDATE`, [n]);
    if (!rows[0]) return fail(404, "String not found.");
    const counts = readCounts(input.counts, rows[0].colors, mode === "add");
    if (typeof counts === "string") return fail(400, counts);
    if (![...counts.values()].some((v) => mode === "set" || v !== 0)) return fail(400, mode === "add" ? "Enter how many sets came in." : "Enter the counts.");
    const { rows: now } = await c.query<{ color: string; stock: number }>(`SELECT color, stock FROM stringing_stock WHERE string_id = $1`, [n]);
    for (const [color, v] of counts) {
      const change = mode === "add" ? v : v - (now.find((x) => x.color === color)?.stock ?? 0);
      if (!change) continue;
      const reason = mode === "add" ? (v > 0 ? "Added" : "Taken off") : `Counted: ${v}`;
      await moveStock(c, { id: n, color }, change, by, note ? `${reason} · ${note}` : reason);
    }
    return { ok: true, data: (await oneString(c, n))! };
  });
}

export type StockMove = { at: string; actor: string; color: string; change: number; stock_after: number; reason: string };

/** A string's latest stock changes (all colours), newest first. */
export async function stockMoves(id: unknown): Promise<StockMove[]> {
  const n = Number(id);
  if (!Number.isInteger(n)) return [];
  const { rows } = await db().query<StockMove>(
    `SELECT at, actor, color, change, stock_after, reason FROM stringing_stock_moves WHERE string_id = $1 ORDER BY at DESC, id DESC LIMIT 50`, [n]
  );
  return rows;
}

/** Removes a string. One already used on a racket is switched off instead (so old rackets keep it). */
export async function deleteString(id: unknown): Promise<Result<{ deleted: boolean }>> {
  const n = Number(id);
  if (!Number.isInteger(n)) return fail(400, "Invalid string.");
  const { rows } = await db().query<{ used: boolean }>(`SELECT EXISTS (SELECT 1 FROM stringing_rackets WHERE string_id = $1) AS used`, [n]);
  if (rows[0].used) {
    await db().query(`UPDATE stringing_strings SET active = FALSE WHERE id = $1`, [n]);
    return { ok: true, data: { deleted: false } };
  }
  await db().query(`DELETE FROM stringing_strings WHERE id = $1`, [n]);
  return { ok: true, data: { deleted: true } };
}

/** Owner/managers: prices and the tag setting (the turnaround is saveTurnaround, from the queue). */
export async function saveStringingPrices(input: unknown): Promise<Result<StringingPrices>> {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const p = toStringingPrices(o);
  // toStringingPrices falls back to defaults; here a bad value is an error instead.
  for (const k of ["labor", "rush", "grommetSingle", "grommetDouble"] as const)
    if (Number(o[k]) !== p[k]) return fail(400, "Enter prices from ₱0 to ₱100,000.");
  if (o.tagQr !== undefined && typeof o.tagQr !== "boolean") return fail(400, "Invalid tag setting.");
  const { labor, rush, grommetSingle, grommetDouble, tagQr } = p;
  return saveStringingSettings({ labor, rush, grommetSingle, grommetDouble, tagQr });
}

/** Staff at the desk: the Standard and Rush turnaround, which changes with how busy the stringers are. */
export async function saveTurnaround(input: Record<string, unknown>, by: string): Promise<Result<StringingPrices>> {
  const t = checkTurnaround(input);
  if (typeof t === "string") return fail(400, t);
  return saveStringingSettings({ ...t, turnaroundChanged: { by, at: new Date().toISOString() } });
}

// Merged into what's saved, so a price save and a turnaround change at the same time don't undo each other.
async function saveStringingSettings(changes: Partial<StringingPrices>): Promise<Result<StringingPrices>> {
  const { rows } = await db().query<{ stringing: unknown }>(
    `UPDATE settings SET stringing = COALESCE(stringing, '{}'::jsonb) || $1::jsonb WHERE id = 1 RETURNING stringing`,
    [JSON.stringify(changes)]
  );
  settingsChanged();
  return { ok: true, data: toStringingPrices(rows[0]?.stringing) };
}

export type StringerReport = {
  from: string; to: string;
  stringers: { name: string; rackets: number; rush: number; grommets: number }[];
  rackets: { tag: number; racket: string; done_by: string; done_at: string; rush: boolean; total: number }[];
  feedback: { count: number; average: number | null };
};

/** Rackets each stringer finished (marked done) from `from` to `to` (Manila dates), e.g. to pay them per racket. */
export async function stringerReport(from: unknown, to: unknown): Promise<Result<StringerReport>> {
  if (!isValidDate(from) || !isValidDate(to) || to < from) return fail(400, "Choose the dates.");
  const range = `(r.done_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2 AND r.status IN ('done', 'picked_up')`;
  const [stringers, rackets, feedback] = await Promise.all([
    db().query<StringerReport["stringers"][number]>(
      `SELECT r.done_by AS name, count(*)::int AS rackets, count(*) FILTER (WHERE r.rush)::int AS rush,
              sum(r.grommets_single + r.grommets_double)::int AS grommets
         FROM stringing_rackets r WHERE ${range} GROUP BY r.done_by ORDER BY count(*) DESC, r.done_by`,
      [from, to]
    ),
    db().query<StringerReport["rackets"][number]>(
      `SELECT r.tag, r.racket, r.done_by, r.done_at, r.rush, r.total FROM stringing_rackets r WHERE ${range} ORDER BY r.done_at LIMIT 2000`,
      [from, to]
    ),
    db().query<{ count: number; average: number | null }>(
      `SELECT count(*)::int AS count, round(avg(feedback_rating), 1)::float8 AS average FROM stringing_orders
        WHERE feedback_rating IS NOT NULL AND (feedback_at AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2`,
      [from, to]
    ),
  ]);
  return { ok: true, data: { from, to, stringers: stringers.rows, rackets: rackets.rows, feedback: feedback.rows[0] } };
}

export type FeedbackRow = { id: string; name: string; rating: number; comment: string; at: string; tags: string };

/** Recent feedback from customers, newest first. */
export async function recentFeedback(): Promise<FeedbackRow[]> {
  const { rows } = await db().query<FeedbackRow>(
    `SELECT o.id, o.name, o.feedback_rating AS rating, o.feedback_comment AS comment, o.feedback_at AS at,
            (SELECT string_agg('#' || tag, ', ' ORDER BY tag) FROM stringing_rackets WHERE order_id = o.id) AS tags
       FROM stringing_orders o WHERE o.feedback_rating IS NOT NULL ORDER BY o.feedback_at DESC LIMIT 100`
  );
  return rows;
}

export type TagRacket = Pick<RacketRow, "id" | "tag" | "racket" | "string_name" | "string_color" | "own_string" | "tension_main" |
  "tension_cross" | "rush" | "due_on" | "grommets_single" | "grommets_double" | "notes" | "status" | "received_by" | "received_at"> & {
  name: string; mobile: string; paid: boolean;
};

/** Rackets to print tags for: by racket ids, or all of a check-in's rackets (not cancelled). */
export async function racketsForTags(ids: string[], orderId: string | null): Promise<TagRacket[]> {
  const list = ids.filter(isId).slice(0, 200);
  if (!list.length && !(orderId && isId(orderId))) return [];
  const { rows } = await db().query<TagRacket>(
    `SELECT r.id, r.tag, r.racket, r.string_name, r.string_color, r.own_string, r.tension_main, r.tension_cross, r.rush, r.due_on,
            r.grommets_single, r.grommets_double, r.notes, r.status, r.received_by, r.received_at, o.name, o.mobile,
            (o.payment_status IN ('paid', 'waived') AND o.paid_amount >= o.total OR o.payment_status = 'waived') AS paid
       FROM stringing_rackets r JOIN stringing_orders o ON o.id = r.order_id
      WHERE ${list.length ? "r.id = ANY($1::uuid[])" : "r.order_id = $1::uuid AND r.status <> 'cancelled'"}
      ORDER BY r.tag`,
    [list.length ? list : orderId]
  );
  return rows;
}
