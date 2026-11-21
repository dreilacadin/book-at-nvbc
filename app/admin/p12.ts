// The Marklife P12 label printer over Web Bluetooth (Chrome on Android; Chrome or Edge on a
// computer; not iPhone or iPad). Connects once and stays connected while the staff page is open;
// prints racket tags as labels. The protocol itself is in lib/label-printer.ts.

import QRCode from "qrcode";
import {
  DEFAULT_LABEL_SETTINGS,
  P12,
  PROBLEM_TEXT,
  labelBitmap,
  labelSize,
  mmToDots,
  printJob,
  readReply,
  toLabelSettings,
  type Bitmap,
  type LabelPrinterSettings,
  type LabelSize,
  type PrinterReply,
} from "@/lib/label-printer";
import { shortName, tagLabel } from "@/lib/stringing";

// ---- Web Bluetooth (not in TypeScript's DOM types yet) ------------------------------------------

type Characteristic = EventTarget & {
  value?: DataView;
  startNotifications(): Promise<unknown>;
  writeValueWithoutResponse(v: BufferSource): Promise<void>;
};
type Device = EventTarget & {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Characteristic> }> }>;
    disconnect(): void;
  };
};
type Bluetooth = {
  requestDevice(o: { filters: { namePrefix: string }[]; optionalServices: string[] }): Promise<Device>;
  getDevices?(): Promise<Device[]>;
};
const bluetooth = () => (typeof navigator === "undefined" ? undefined : (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth);

/** Whether this browser can talk to a Bluetooth label printer. */
export const labelPrinterSupported = () => !!bluetooth();

// ---- Settings (this device only) ---------------------------------------------------------------

const KEY = "nvbc.labelPrinter";
const listeners = new Set<() => void>();
export function getLabelSettings(): LabelPrinterSettings {
  try {
    return toLabelSettings(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return DEFAULT_LABEL_SETTINGS;
  }
}
export function saveLabelSettings(s: LabelPrinterSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: this visit only */ }
  memory = s;
  listeners.forEach((f) => f());
}
let memory: LabelPrinterSettings | null = null;
const current = () => memory ?? getLabelSettings();
/** Print tags on the label printer on this device (instead of the A4 page)? */
export const labelPrinterOn = () => labelPrinterSupported() && current().on;

// ---- The connection -----------------------------------------------------------------------------

type Link = {
  dev: Device;
  tx: Characteristic;
  credits: number;
  lastCredit: number;
  packetSize: number;
  /** The last problem it reported during this label (no labels, cover open, too hot). */
  problem: string | null;
  onReply: Set<(r: NonNullable<PrinterReply>) => void>;
};
let device: Device | null = null;
let link: Link | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms: number) {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await sleep(20);
}

async function open(dev: Device): Promise<Link> {
  if (!dev.gatt) throw new Error("This Bluetooth device can't be used as a label printer.");
  const server = await dev.gatt.connect();
  const service = await server.getPrimaryService(P12.service).catch(() => {
    throw new Error(`“${dev.name ?? "That device"}” isn't a Marklife P12. Choose the P12 in the Bluetooth list.`);
  });
  const [tx, rx, cx] = await Promise.all([service.getCharacteristic(P12.tx), service.getCharacteristic(P12.rx), service.getCharacteristic(P12.cx)]);
  const l: Link = { dev, tx, credits: 0, lastCredit: Date.now(), packetSize: P12.packetSize, problem: null, onReply: new Set() };
  const heard = (e: Event) => {
    const v = (e.target as Characteristic).value;
    const r = v && readReply(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    if (!r) return;
    if (r.type === "credit") {
      l.credits += r.n;
      l.lastCredit = Date.now();
    } else if (r.type === "mtu" && r.n > 3) l.packetSize = Math.min(r.n - 3, P12.packetSize);
    else if (r.type === "problem" && r.problem !== "low_battery") l.problem = PROBLEM_TEXT[r.problem];
    l.onReply.forEach((f) => f(r));
  };
  for (const c of [rx, cx]) {
    c.addEventListener("characteristicvaluechanged", heard);
    await c.startNotifications();
  }
  // The printer grants its first credits just after connecting.
  await until(() => l.credits > 0, 3000);
  device = dev;
  try { localStorage.setItem(`${KEY}.name`, dev.name ?? ""); } catch { /* fine */ }
  return l;
}

/** Choose the printer from the browser's Bluetooth list (needs a tap) and connect. Returns its name. */
export async function choosePrinter(): Promise<string> {
  const bt = bluetooth();
  if (!bt) throw new Error("This browser can't use Bluetooth printers. Use Chrome on Android, or Chrome or Edge on a computer.");
  const dev = await bt.requestDevice({ filters: P12.namePrefixes.map((namePrefix) => ({ namePrefix })), optionalServices: [P12.service] })
    .catch((e: unknown) => {
      throw new Error(e instanceof Error && e.name === "NotFoundError" ? "No printer chosen." : friendly(e));
    });
  if (link && link.dev !== dev) disconnectPrinter();
  link = await open(dev);
  return dev.name ?? "P12";
}

/** The connected printer, reconnecting if it went to sleep; or choosing it if this is the first time. */
async function connected(): Promise<Link> {
  if (link?.dev.gatt?.connected) return link;
  link = null;
  if (device) return (link = await open(device));
  // Chrome may remember the printer from an earlier visit.
  const bt = bluetooth();
  const name = (() => { try { return localStorage.getItem(`${KEY}.name`); } catch { return null; } })();
  const known = name && bt?.getDevices ? (await bt.getDevices().catch(() => [])).find((d) => d.name === name) : undefined;
  if (known) {
    try { return (link = await open(known)); } catch { /* fall through to choosing it */ }
  }
  await choosePrinter();
  return link!;
}

export function connectedPrinterName(): string | null {
  return link?.dev.gatt?.connected ? link.dev.name ?? "P12" : null;
}
export function disconnectPrinter() {
  link?.dev.gatt?.disconnect();
  link = null;
}

/** Send bytes the way the printer wants them: one packet per tick, only while it has granted credits. */
async function send(l: Link, data: Uint8Array) {
  let off = 0;
  l.lastCredit = Date.now();
  while (off < data.length) {
    if (l.problem) throw new Error(l.problem);
    if (!l.dev.gatt?.connected) throw new Error("The label printer disconnected. Is it switched on?");
    if (l.credits <= 0 && Date.now() - l.lastCredit >= P12.starvationMs) {
      l.credits = 1;
      l.lastCredit = Date.now();
    }
    if (l.credits > 0) {
      const chunk = data.slice(off, off + l.packetSize);
      await l.tx.writeValueWithoutResponse(chunk);
      l.credits--;
      off += chunk.length;
      if (off >= data.length) break;
    }
    await sleep(P12.tickMs);
  }
}

/** Print one label; resolves when the printer says it's printed. */
async function printOne(l: Link, b: Bitmap, s: LabelPrinterSettings) {
  const job = printJob(b, s);
  l.problem = null;
  await send(l, job.setup);
  // Let the credits refill while it warms up, so the image goes through without gaps.
  await until(() => l.credits >= 3, 1000);
  await send(l, job.body);
  if (l.problem) throw new Error(l.problem);
  await new Promise<void>((resolve, reject) => {
    const done = (fn: () => void) => { clearTimeout(timer); l.onReply.delete(on); l.dev.removeEventListener("gattserverdisconnected", gone); fn(); };
    const on = (r: NonNullable<PrinterReply>) => {
      if (r.type === "printed") done(resolve);
      else if (r.type === "problem" && r.problem !== "low_battery") done(() => reject(new Error(PROBLEM_TEXT[r.problem])));
    };
    // It sometimes switches off right after printing: everything was sent, so that's printed.
    const gone = () => done(resolve);
    const timer = setTimeout(() => done(() => reject(new Error("The label printer didn't answer. Check it and try again."))), 30_000);
    l.onReply.add(on);
    l.dev.addEventListener("gattserverdisconnected", gone);
  });
}

const friendly = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (e instanceof Error && e.name === "SecurityError") return "Tap 🏷 Label printer → Connect first, then try again.";
  if (/User cancelled|chooser/i.test(m)) return "No printer chosen.";
  if (/GATT|Bluetooth|connect/i.test(m)) return "Couldn't reach the label printer. Is it on and nearby? Then try again.";
  return m;
};

// ---- Racket tags ---------------------------------------------------------------------------------

export type TagLabel = { tag: number; name: string; rush: boolean; paid: boolean };

/**
 * Draws a racket tag on a label: the QR code (opens the racket), the tag number, the name, and
 * RUSH / PAID, centred as one block. `shift` (mm) moves it all, for a printer that prints a little
 * off: x along the label, y across it.
 */
export function drawTagLabel(t: TagLabel, size: LabelSize, origin: string, shift = { x: 0, y: 0 }): HTMLCanvasElement {
  const W = mmToDots(size.w), H = mmToDots(size.h);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#fff";
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#000";
  c.translate(mmToDots(shift.x), mmToDots(shift.y));
  const font = (px: number, weight = 800) => (c.font = `${weight} ${px}px system-ui, Roboto, Arial, sans-serif`);

  // QR code: the short link (/t/127), with whole dots per module so it stays sharp. Lower error
  // correction if that's what keeps the modules at 3 dots (0.375 mm) or more, for phone cameras.
  const pad = 6, gap = 8;
  const url = `${origin}/t/${t.tag}`;
  let qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  if (Math.floor((H - 2 * pad) / qr.modules.size) < 3) qr = QRCode.create(url, { errorCorrectionLevel: "L" });
  const n = qr.modules.size;
  const m = Math.max(1, Math.floor((H - 2 * pad) / n));
  const q = m * n, qy = Math.floor((H - q) / 2);

  // The text beside it, each line as big as fits: measured first, so the whole block can be centred.
  const room = W - 2 * pad - q - gap;
  const fit = (text: string, max: number, weight = 800) => {
    let px = max;
    do font(px, weight); while (c.measureText(text).width > room && --px > 8);
    return { text, px, weight, w: c.measureText(text).width };
  };
  const hasText = room >= 24;
  const num = hasText ? fit(tagLabel(t.tag), Math.round(H * 0.46)) : null;
  const who = hasText && shortName(t.name) ? fit(shortName(t.name), Math.round(H * 0.19), 700) : null;
  const markPx = Math.max(10, Math.round(H * 0.15));
  font(markPx);
  let marks = (hasText ? [t.rush && "RUSH", t.paid && "PAID"].filter(Boolean) as string[] : []).map((text) => ({ text, w: c.measureText(text).width + 8 }));
  // Only the marks that fit on one line.
  let used = 0;
  marks = marks.filter((x) => (used += x.w + (used ? 6 : 0)) <= room);
  const textW = Math.ceil(Math.max(num?.w ?? 0, who?.w ?? 0, marks.reduce((a, x, i) => a + x.w + (i ? 6 : 0), 0)));
  const left = Math.max(pad, Math.floor((W - (q + (textW ? gap + textW : 0))) / 2));

  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (qr.modules.data[y * n + x]) c.fillRect(left + x * m, qy + y * m, m, m);
  if (!num) return canvas;

  const x0 = left + q + gap;
  c.textBaseline = "alphabetic";
  font(num.px, num.weight);
  let y = Math.round(pad + num.px * 0.86);
  c.fillText(num.text, x0, y);
  if (who) {
    font(who.px, who.weight);
    y += Math.round(who.px * 1.15);
    c.fillText(who.text, x0, y);
  }
  // Marks along the bottom: RUSH in a black box, PAID with a box around it.
  font(markPx);
  const bh = markPx + 6, by = H - pad - bh;
  let bx = x0;
  for (const mark of marks) {
    if (mark.text === "RUSH") {
      c.fillRect(bx, by, mark.w, bh);
      c.fillStyle = "#fff";
      c.fillText(mark.text, bx + 4, by + bh - 4);
      c.fillStyle = "#000";
    } else {
      c.lineWidth = 2;
      c.strokeRect(bx + 1, by + 1, mark.w - 2, bh - 2);
      c.fillText(mark.text, bx + 4, by + bh - 4);
    }
    bx += mark.w + 6;
  }
  return canvas;
}

function toBitmap(canvas: HTMLCanvasElement): Bitmap {
  const img = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  return labelBitmap(img.data, canvas.width, canvas.height);
}

// ---- Printing, one job at a time, with a status everyone can show --------------------------------

export type LabelStatus = { state: "printing" | "done" | "error"; text: string } | null;
let status: LabelStatus = null;
const statusListeners = new Set<(s: LabelStatus) => void>();
let clearTimer: ReturnType<typeof setTimeout> | undefined;
function setStatus(s: LabelStatus) {
  status = s;
  clearTimeout(clearTimer);
  if (s && s.state !== "printing") clearTimer = setTimeout(() => setStatus(null), s.state === "done" ? 4000 : 12000);
  statusListeners.forEach((f) => f(s));
}
export function onLabelStatus(f: (s: LabelStatus) => void) {
  statusListeners.add(f);
  f(status);
  return () => { statusListeners.delete(f); };
}
export function onLabelSettings(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

let queue: Promise<unknown> = Promise.resolve();

/** Prints racket tags on the label printer, one label each. Shows its progress through onLabelStatus. */
export function printTagLabels(
  which: TagLabel[] | (() => Promise<TagLabel[]>),
  settings: LabelPrinterSettings = current()
): Promise<boolean> {
  const run = async () => {
    setStatus({ state: "printing", text: "Printing…" });
    try {
      const tags = typeof which === "function" ? await which() : which;
      if (!tags.length) throw new Error("No tags to print.");
      const what = tags.length === 1 ? tagLabel(tags[0].tag) : `${tags.length} tags`;
      setStatus({ state: "printing", text: `Printing ${what}…` });
      const l = await connected();
      const size = labelSize(settings);
      for (const [i, t] of tags.entries()) {
        if (tags.length > 1) setStatus({ state: "printing", text: `Printing ${tagLabel(t.tag)} (${i + 1} of ${tags.length})…` });
        await printOne(l, toBitmap(drawTagLabel(t, size, window.location.origin, { x: settings.shiftX, y: settings.shiftY })), settings);
      }
      setStatus({ state: "done", text: `Printed ${tags.length === 1 ? what : tags.map((t) => tagLabel(t.tag)).join(", ")}.` });
      return true;
    } catch (e) {
      setStatus({ state: "error", text: friendly(e) });
      return false;
    }
  };
  const p = queue.then(run, run);
  queue = p;
  return p;
}
