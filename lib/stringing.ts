// Racket stringing: prices, tensions, statuses, suggestions and the messages customers get. Shared
// by the server and the browser (no Node imports), so it can be tested.
import { formatDateLong } from "./format.ts";
import { addDays } from "./time.ts";

// ---- Prices and turnaround (Stringing → Strings & prices) ---------------------------------------

export type StringingPrices = {
  labor: number; // stringing labour, per racket
  rush: number; // added for a rush job
  grommetSingle: number; // per single grommet changed
  grommetDouble: number; // per double grommet changed
  standardDays: [number, number]; // usual turnaround, e.g. 3–5 days
  rushDays: [number, number]; // rush turnaround, e.g. 1–2 days
  tagQr: boolean; // print QR codes on tags (for a label printer); off = simple tags with a big number
  /** Who last changed the turnaround, and when (staff only; customers get null). */
  turnaroundChanged: { by: string; at: string } | null;
};

export const DEFAULT_STRINGING_PRICES: StringingPrices = {
  labor: 200, rush: 150, grommetSingle: 10, grommetDouble: 20, standardDays: [3, 5], rushDays: [1, 2], tagQr: false,
  turnaroundChanged: null,
};

const peso = (v: unknown, fallback: number) => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) && n >= 0 && n <= 100_000 ? Math.round(n * 100) / 100 : fallback;
};
const days = (v: unknown, fallback: [number, number]): [number, number] => {
  if (!Array.isArray(v) || v.length !== 2) return fallback;
  const [a, b] = v.map(Number);
  return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a && b <= 60 ? [a, b] : fallback;
};

/** The saved prices, with defaults for anything missing or invalid. */
export function toStringingPrices(v: unknown): StringingPrices {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const d = DEFAULT_STRINGING_PRICES;
  return {
    labor: peso(o.labor, d.labor), rush: peso(o.rush, d.rush), grommetSingle: peso(o.grommetSingle, d.grommetSingle),
    grommetDouble: peso(o.grommetDouble, d.grommetDouble), standardDays: days(o.standardDays, d.standardDays),
    rushDays: days(o.rushDays, d.rushDays), tagQr: o.tagQr === true,
    turnaroundChanged: changed(o.turnaroundChanged),
  };
}
const changed = (v: unknown): StringingPrices["turnaroundChanged"] => {
  const c = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  return c && typeof c.by === "string" && typeof c.at === "string" ? { by: c.by, at: c.at } : null;
};

/**
 * A new turnaround (Admin → Stringing, at the top of the queue): whole days from 0 to 60, each
 * "from" not more than its "to", and rush not slower than standard. A message if it isn't.
 */
export function checkTurnaround(o: { standardDays?: unknown; rushDays?: unknown }): Pick<StringingPrices, "standardDays" | "rushDays"> | string {
  const read = (v: unknown) => (Array.isArray(v) && v.length === 2 && v.every((x) => x !== "" && x !== null) ? days(v, [-1, -1]) : [-1, -1]);
  const standardDays = read(o.standardDays) as [number, number];
  const rushDays = read(o.rushDays) as [number, number];
  if (standardDays[0] < 0 || rushDays[0] < 0) return "Turnaround days are whole numbers from 0 to 60, the first not more than the second.";
  if (rushDays[0] > standardDays[0] || rushDays[1] > standardDays[1]) return "Rush can't take longer than standard.";
  return { standardDays, rushDays };
}

/** "3–5 days", "1 day". */
export const daysText = ([a, b]: [number, number]) => (a === b ? `${a} day${a === 1 ? "" : "s"}` : `${a}–${b} days`);

/** The earliest collection date for a racket checked in `today`. */
export const earliestPickup = (today: string, rush: boolean, p: StringingPrices) =>
  addDays(today, rush ? p.rushDays[0] : p.standardDays[0]);

export const MAX_GROMMETS = 40;

/** What one racket costs: labour, rush, the string (if bought from NVBC) and grommets. */
export function racketPrice(
  r: { rush: boolean; stringPrice: number; grommetsSingle: number; grommetsDouble: number },
  p: StringingPrices
): { labor: number; rush: number; string: number; grommets: number; total: number } {
  const rush = r.rush ? p.rush : 0;
  const grommets = Math.round((r.grommetsSingle * p.grommetSingle + r.grommetsDouble * p.grommetDouble) * 100) / 100;
  const total = Math.round((p.labor + rush + r.stringPrice + grommets) * 100) / 100;
  return { labor: p.labor, rush, string: r.stringPrice, grommets, total };
}

/** A racket's price as receipt lines (only what applies), e.g. Stringing ₱200, String ₱730, Grommets ₱20. */
export function priceLines(p: { labor: number; rush: number; string: number; grommets: number }, grommetCount = 0): { label: string; amount: number }[] {
  return [
    { label: "Stringing", amount: p.labor },
    { label: "Rush", amount: p.rush },
    { label: "String", amount: p.string },
    { label: grommetCount ? `Grommets (${grommetCount})` : "Grommets", amount: p.grommets },
  ].filter((l, i) => i === 0 || l.amount > 0);
}

// ---- Tension ------------------------------------------------------------------------------------

export const TENSION_PRESETS = [24, 25, 26, 27, 28, 29, 30] as const;
export const MIN_TENSION = 15;
export const MAX_TENSION = 40;

/** A tension in lbs (15–40, in half pounds), or null. */
export function readTension(v: unknown): number | null {
  const n = Number(typeof v === "string" ? v.replace(/lbs?|#/gi, "").trim() : v);
  return v !== null && v !== "" && Number.isFinite(n) && n >= MIN_TENSION && n <= MAX_TENSION && Number.isInteger(n * 2) ? n : null;
}

/** "26 lbs", or "24 × 26 lbs" when the mains and crosses differ. */
export const tensionLabel = (main: number, cross: number) => (main === cross ? `${main} lbs` : `${main} × ${cross} lbs`);

/** Pre-stretch choices (% the string is stretched before it's tensioned); none is the default. */
export const PRESTRETCH_OPTIONS = [5, 10, 15, 20] as const;
/** A pre-stretch % (5, 10, 15 or 20), null for none, or undefined if it isn't one of those. */
export function readPrestretch(v: unknown): number | null | undefined {
  if (v === undefined || v === null || v === "" || v === 0 || v === "0") return null;
  const n = Number(v);
  return (PRESTRETCH_OPTIONS as readonly number[]).includes(n) ? n : undefined;
}
/** "26 lbs · pre-stretch 10%" — the tension with the pre-stretch, if any. */
export const setupLabel = (main: number, cross: number, prestretch: number | null | undefined) =>
  tensionLabel(main, cross) + (prestretch ? ` · pre-stretch ${prestretch}%` : "");

// ---- Statuses -----------------------------------------------------------------------------------

export const RACKET_STATUSES = [
  { id: "checked_in", label: "Checked in", step: "Bring it to the front desk" },
  { id: "received", label: "Received", step: "At NVBC, waiting for the stringer" },
  { id: "in_progress", label: "Stringing", step: "Being strung now" },
  { id: "done", label: "Ready for pickup", step: "Ready — pick it up at the front desk" },
  { id: "picked_up", label: "Picked up", step: "Picked up" },
  { id: "cancelled", label: "Cancelled", step: "Cancelled" },
] as const;
export type RacketStatus = (typeof RACKET_STATUSES)[number]["id"];
export const isRacketStatus = (v: unknown): v is RacketStatus => RACKET_STATUSES.some((s) => s.id === v);
export const racketStatusLabel = (s: string) => RACKET_STATUSES.find((x) => x.id === s)?.label ?? s;

/** The steps a racket goes through, in order (cancelled is off to the side). */
export const RACKET_STEPS: RacketStatus[] = ["checked_in", "received", "in_progress", "done", "picked_up"];

/** What staff (or a stringer) can do next with a racket in this status. */
export type RacketAction = "receive" | "start" | "done" | "pickup";
export const NEXT_ACTION: Partial<Record<RacketStatus, { action: RacketAction; label: string }>> = {
  checked_in: { action: "receive", label: "Receive" },
  received: { action: "start", label: "Start stringing" },
  in_progress: { action: "done", label: "Done" },
  done: { action: "pickup", label: "Picked up" },
};

/** The racket's tag number as printed and written: "#127". */
export const tagLabel = (tag: number) => `#${tag}`;

/** "#127", or a typed "127" / "# 127" / "tag 127" / the tag's QR link → 127. */
export function readTag(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const m = v.match(/(?:tag=|\/t\/|#|^\s*(?:tag\s*)?)(\d{1,7})\s*$/i);
  return m ? Number(m[1]) : null;
}

// ---- Customers ----------------------------------------------------------------------------------

/** A Philippine mobile number as 09XXXXXXXXX, or null. Accepts +63, 63, spaces and dashes. */
export function normalizeMobile(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = v.replace(/\D/g, "");
  const local = d.startsWith("639") && d.length === 12 ? "0" + d.slice(2) : d.startsWith("9") && d.length === 10 ? "0" + d : d;
  return /^09\d{9}$/.test(local) ? local : null;
}

/** "•••• 4567" — a mobile number on a printed tag. */
export const mobileTail = (m: string) => (m.length >= 4 ? `•••• ${m.slice(-4)}` : m);

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";
/** "Ana Santos Reyes" → "Ana R." (for a tag). */
export function shortName(name: string): string {
  const [first = "", ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${first} ${rest.at(-1)![0]}.` : first;
}

// ---- Suggestions --------------------------------------------------------------------------------

/** Rackets suggested when typing (with every racket NVBC has strung before). */
export const POPULAR_RACKETS = [
  "Yonex Astrox 77 Pro", "Yonex Astrox 88D Pro", "Yonex Astrox 88S Pro", "Yonex Astrox 99 Pro", "Yonex Astrox 100ZZ",
  "Yonex Astrox 100 Game", "Yonex Nanoflare 800 Pro", "Yonex Nanoflare 1000Z", "Yonex Nanoflare 700 Pro",
  "Yonex Arcsaber 11 Pro", "Yonex Arcsaber 7 Pro", "Yonex Duora 10", "Yonex Voltric Z-Force II",
  "Li-Ning Axforce 80", "Li-Ning Axforce 90", "Li-Ning Axforce 100", "Li-Ning Halbertec 8000", "Li-Ning Bladex 900",
  "Li-Ning Aeronaut 9000", "Li-Ning Turbo Charging 75", "Li-Ning Tectonic 7",
  "Victor Thruster Ryuga II", "Victor Thruster K Falcon", "Victor Auraspeed 90K II", "Victor Jetspeed S 12 II",
  "Victor Brave Sword 12", "Apacs Z-Ziggler", "Apacs Feather Weight 55",
];

/** Strings suggested for "I brought my own string" (with NVBC's own list and strings used before). */
export const POPULAR_STRINGS = [
  "Yonex BG65", "Yonex BG65 Titanium", "Yonex BG66 Ultimax", "Yonex BG80", "Yonex BG80 Power", "Yonex Aerobite",
  "Yonex Aerobite Boost", "Yonex Exbolt 63", "Yonex Exbolt 65", "Yonex Exbolt 68", "Yonex Nanogy 95", "Yonex Nanogy 98",
  "Yonex Aerosonic", "Li-Ning No.1", "Li-Ning No.5", "Victor VBS-63", "Victor VBS-66N", "Victor VBS-70",
];

/**
 * A string NVBC sells (Stringing → Strings & stock). `stockBy`: sets in stock (one per racket) per
 * colour ("" for a string without colours); `stock`: all of them together.
 */
export type StringItem = {
  id: number; brand: string; model: string; colors: string[]; price: number; active: boolean;
  stock: number; stockBy: Record<string, number>;
};
export const stringName = (s: Pick<StringItem, "brand" | "model">) => `${s.brand} ${s.model}`.trim();
/** "Yonex BG 80 (Black)", or just the name for a string without colours. */
export const stringColorName = (s: Pick<StringItem, "brand" | "model">, color: string) => `${stringName(s)}${color ? ` (${color})` : ""}`;
/** Sets in stock of one colour ("" for a string without colours). */
export const colorStock = (s: Pick<StringItem, "stockBy">, color: string) => s.stockBy[color] ?? 0;
/**
 * The stock lines to show staff: each colour on offer (or "" for a string without colours), then any
 * other colour that still has stock counted (one taken off the list, or renamed).
 */
export function stockLines(s: Pick<StringItem, "colors" | "stockBy">): { color: string; stock: number; listed: boolean }[] {
  const listed = s.colors.length ? s.colors : [""];
  return [
    ...listed.map((color) => ({ color, stock: colorStock(s, color), listed: true })),
    ...Object.entries(s.stockBy).filter(([c, n]) => n !== 0 && !listed.includes(c)).map(([color, stock]) => ({ color, stock, listed: false })),
  ];
}
/** Whether a customer can buy this string: some colour on offer is in stock. */
export const inStock = (s: Pick<StringItem, "colors" | "stockBy">) => (s.colors.length ? s.colors : [""]).some((c) => colorStock(s, c) > 0);

/** Merges suggestion lists: no duplicates (ignoring case and spacing), first spelling wins, sorted. */
export function mergeSuggestions(...lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const list of lists)
    for (const raw of list) {
      const v = raw.trim().replace(/\s+/g, " ");
      const key = v.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (v && key && !seen.has(key)) seen.set(key, v);
    }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// ---- Messages to customers ----------------------------------------------------------------------

export type MessageRacket = { tag: number; racket: string };

const racketsText = (rs: MessageRacket[]) => rs.map((r) => `${tagLabel(r.tag)} ${r.racket}`).join(", ");

/** "Your racket is ready" (push title/body, email, and an SMS staff can copy). */
export function readyMessage(o: { name: string; rackets: MessageRacket[]; waiting: number; balance: number; link: string }) {
  const one = o.rackets.length === 1;
  const what = one ? `Your racket ${racketsText(o.rackets)} is` : `Your rackets ${racketsText(o.rackets)} are`;
  const pay = o.balance > 0 ? ` Please pay the balance of ₱${o.balance.toLocaleString("en-PH")} at pickup.` : "";
  const more = o.waiting > 0 ? ` (${o.waiting} more still being strung — we'll tell you when ${o.waiting === 1 ? "it's" : "they're"} ready.)` : "";
  return {
    title: one ? "Your racket is ready 🏸" : "Your rackets are ready 🏸",
    body: `${what} ready for pickup at the NVBC front desk.${pay}`,
    subject: one ? "Your racket is ready for pickup" : "Your rackets are ready for pickup",
    email: [
      `Hi ${firstName(o.name)},`,
      "",
      `${what} restrung and ready for pickup at the NVBC front desk.${more}${pay}`,
      "",
      `Just give your name or tag number at the desk. See the details here: ${o.link}`,
      "",
      "Thank you!",
      "NV Badminton Center",
    ].join("\n"),
    sms: `Hi ${firstName(o.name)}! ${what} ready for pickup at NVBC.${pay} Just give your name or tag no. at the front desk. Thank you! - NVBC`,
  };
}

/** "Thank you" after pickup, with the feedback link. */
export function thankYouMessage(o: { name: string; link: string }) {
  return {
    title: "Thanks for stringing with NVBC 🏸",
    body: "How did we do? Rate your stringing in a few seconds.",
    subject: "Thank you — how was our stringing service?",
    email: [
      `Hi ${firstName(o.name)},`,
      "",
      "Thank you for having your racket strung at NV Badminton Center! We hope it plays great.",
      "",
      `Could you tell us how we did? It takes a few seconds: ${o.link}`,
      "",
      "See you on court!",
      "NV Badminton Center",
    ].join("\n"),
    sms: `Hi ${firstName(o.name)}! Thank you for stringing with NVBC. We hope it plays great! Tell us how we did: ${o.link} - NVBC`,
  };
}

/** "We have your racket" (sent when staff receive it at the desk). */
export function receivedMessage(o: { name: string; rackets: MessageRacket[]; dueOn: string; link: string }) {
  const one = o.rackets.length === 1;
  return {
    title: one ? "We received your racket" : "We received your rackets",
    body: `${racketsText(o.rackets)} — ready by ${formatDateLong(o.dueOn)}. We'll tell you when ${one ? "it's" : "they're"} done.`,
    subject: one ? "We received your racket for stringing" : "We received your rackets for stringing",
    email: [
      `Hi ${firstName(o.name)},`,
      "",
      `NVBC received ${one ? "your racket" : "your rackets"} for stringing: ${racketsText(o.rackets)}.`,
      `${one ? "It should be" : "They should be"} ready by ${formatDateLong(o.dueOn)}. We'll message you as soon as ${one ? "it's" : "they're"} done.`,
      "",
      `Follow the progress here: ${o.link}`,
      "",
      "NV Badminton Center",
    ].join("\n"),
  };
}
