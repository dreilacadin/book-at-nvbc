// Label printers for racket tags: the Marklife P12 and the Clabel 221B over Bluetooth, or any label
// printer on this computer (USB, through its driver and the browser's print dialog). Label sizes,
// the 1-bit image they print and the bytes that print it. No browser or Node APIs here, so it can be
// tested; app/admin/p12.ts and app/admin/clabel.ts talk to the printers over Web Bluetooth.
//
// The protocol (Marklife "L11": service, characteristics, commands, credit flow control and
// pacing) comes from thermoprint by tomLadder, MIT licence:
// https://github.com/tomLadder/thermoprint (packages/core: device/profiles/p12.ts,
// protocol/l11, transport/flow-control.ts, and REVERSE_ENGINEERING.md).

// ---- The printer --------------------------------------------------------------------------------

export const P12 = {
  service: "0000ff00-0000-1000-8000-00805f9b34fb",
  /** We write commands and the image here. */
  tx: "0000ff02-0000-1000-8000-00805f9b34fb",
  /** Status and "printed" replies. */
  rx: "0000ff01-0000-1000-8000-00805f9b34fb",
  /** Flow control: credits (how many packets we may send) and the link's MTU. */
  cx: "0000ff03-0000-1000-8000-00805f9b34fb",
  /** Bluetooth names it advertises (P11/LP90 are the same printer under other names). */
  namePrefixes: ["P12", "LP90", "P11"],
  /** Bytes per write; more and the printer's buffer can't keep up. */
  packetSize: 90,
  /** One packet every 30 ms, as the Marklife app does; faster and it stops granting credits. */
  tickMs: 30,
  /** No credits for this long: send one packet anyway (the Marklife app does the same). */
  starvationMs: 1000,
} as const;

/** 203 dpi: 8 dots per mm. */
export const DOTS_PER_MM = 8;
export const mmToDots = (mm: number) => Math.round(mm * DOTS_PER_MM);

export type PaperType = "gap" | "continuous";
export type Density = 1 | 2 | 3;
/** Label width (along the roll) × height (across it), in mm. */
export type LabelSize = { w: number; h: number };

/** The P12's label sizes, as in the Marklife app. */
export const LABEL_SIZES: Record<PaperType, LabelSize[]> = {
  gap: [
    { w: 22, h: 12 }, { w: 22, h: 14 }, { w: 26, h: 15 }, { w: 30, h: 12 }, { w: 30, h: 14 },
    { w: 30, h: 15 }, { w: 40, h: 12 }, { w: 40, h: 14 }, { w: 40, h: 15 }, { w: 50, h: 15 },
  ],
  continuous: [
    { w: 22, h: 12 }, { w: 22, h: 14 }, { w: 26, h: 15 }, { w: 30, h: 12 }, { w: 30, h: 14 },
    { w: 30, h: 15 }, { w: 40, h: 12 }, { w: 40, h: 15 }, { w: 50, h: 15 },
  ],
};
export const sizeKey = (s: LabelSize) => `${s.w}x${s.h}`;
export const sizeLabel = (s: LabelSize) => `${s.w} × ${s.h} mm`;

/**
 * Which printer: the Marklife P12 or the Clabel 221B over Bluetooth, or "usb": a label printer on this
 * computer, printed through its driver from the browser's print dialog.
 */
export type PrinterKind = "p12" | "clabel" | "usb";
export const PRINTER_KINDS: PrinterKind[] = ["p12", "clabel", "usb"];
/** The commands a Bluetooth printer other than the P12 understands. Most 2-inch label printers speak TSPL. */
export type PrinterLanguage = "tspl" | "escpos";

/**
 * 2-inch label printers (the Clabel 221B, and labels printed over USB): width across the printer ×
 * height along the roll, in mm, up to 50 mm wide. Printed as drawn (no turning).
 */
export const WIDE_LABEL_SIZES: LabelSize[] = [
  { w: 40, h: 30 }, { w: 30, h: 20 }, { w: 40, h: 20 }, { w: 40, h: 40 }, { w: 50, h: 25 }, { w: 50, h: 30 }, { w: 50, h: 40 }, { w: 50, h: 50 },
];

/** The sizes a printer takes (the P12's depend on the paper type). */
export function sizesFor(printer: PrinterKind, paper: PaperType): LabelSize[] {
  return printer === "p12" ? LABEL_SIZES[paper] : WIDE_LABEL_SIZES;
}

/** This device's label printer settings (kept in the browser). */
/** `shiftX` / `shiftY`: mm to move the print along / across the label, for a printer that prints a little off. */
export type LabelPrinterSettings = {
  on: boolean; printer: PrinterKind; paper: PaperType; size: string; density: Density; shiftX: number; shiftY: number;
  /** Clabel over Bluetooth: its command language, and whether to print the other way round. */
  language: PrinterLanguage; flip: boolean;
  /** 2-inch labels: how big the print is, % of the label (smaller if a printer cuts the edges off). */
  scale: number;
  /** Labels printed for each racket (e.g. one for the racket and one for its bag): chosen at each
   * Print tags, and kept as the number offered next time. */
  copies: number;
};
/** How far the print can be moved, and in what steps (mm). */
export const SHIFT_MAX = 3, SHIFT_STEP = 0.5;
/** Print sizes for 2-inch labels (%), and the usual one: 90% fits the Clabel 221B's 40 × 30 labels. */
export const SCALES = [100, 95, 90, 85, 80, 75, 70];
export const defaultScale = (printer: PrinterKind) => (printer === "p12" ? 100 : 90);
/** Labels per racket: 1 to MAX_COPIES. */
export const MAX_COPIES = 10;
export const DEFAULT_SIZE = "30x12"; // tested on the P12 at NVBC
/** The usual size for each printer: 30 × 12 on the P12, 40 × 30 (NVBC's Clabel labels) otherwise. */
export const defaultSize = (printer: PrinterKind) => (printer === "p12" ? DEFAULT_SIZE : "40x30");
export const DEFAULT_LABEL_SETTINGS: LabelPrinterSettings = {
  on: false, printer: "p12", paper: "gap", size: DEFAULT_SIZE, density: 2, shiftX: 0, shiftY: 0, language: "tspl", flip: false, scale: 100, copies: 1,
};

/** Saved settings, with defaults for anything missing or not a size that printer takes. */
export function toLabelSettings(v: unknown): LabelPrinterSettings {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const printer: PrinterKind = PRINTER_KINDS.includes(o.printer as PrinterKind) ? (o.printer as PrinterKind) : "p12";
  // Only the P12 has continuous rolls here.
  const paper: PaperType = printer === "p12" && o.paper === "continuous" ? "continuous" : "gap";
  const size = typeof o.size === "string" && sizesFor(printer, paper).some((s) => sizeKey(s) === o.size) ? o.size : defaultSize(printer);
  const density: Density = o.density === 1 || o.density === 3 ? o.density : 2;
  const shift = (v: unknown) =>
    typeof v === "number" && Math.abs(v) <= SHIFT_MAX && Number.isInteger(v / SHIFT_STEP) ? v || 0 : 0;
  return {
    on: o.on === true, printer, paper, size, density, shiftX: shift(o.shiftX), shiftY: shift(o.shiftY),
    language: o.language === "escpos" ? "escpos" : "tspl", flip: o.flip === true,
    scale: SCALES.includes(o.scale as number) ? (o.scale as number) : defaultScale(printer),
    copies: Number.isInteger(o.copies) && (o.copies as number) >= 1 && (o.copies as number) <= MAX_COPIES ? (o.copies as number) : 1,
  };
}
export function labelSize(s: LabelPrinterSettings): LabelSize {
  return sizesFor(s.printer, s.paper).find((x) => sizeKey(x) === s.size) ?? (s.printer === "p12" ? { w: 30, h: 12 } : { w: 40, h: 30 });
}

// ---- The image ----------------------------------------------------------------------------------

/** A 1-bit image: rows of bits, most significant bit first, 1 = black. */
export type Bitmap = { width: number; height: number; bytesPerRow: number; data: Uint8Array };

/**
 * Turns a drawn label (RGBA, `width` × `height`, as a canvas gives it) into what the printer prints.
 * The printer feeds the label lengthwise, so the image is turned a quarter clockwise: each printed
 * row runs across the label. Grey becomes black or white at `cutoff` (no dithering, so QR codes
 * stay sharp); transparent counts as white.
 */
export function labelBitmap(rgba: ArrayLike<number>, width: number, height: number, cutoff = 160, turn = true): Bitmap {
  // Turned: the new width is the label's height, and new row y is the label's column x.
  const outW = turn ? height : width, outH = turn ? width : height;
  const bytesPerRow = Math.ceil(outW / 8);
  const data = new Uint8Array(bytesPerRow * outH);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      const lum = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) * a + 255 * (1 - a);
      if (lum >= cutoff) continue;
      // Quarter turn clockwise: (x, y) → (height - 1 - y, x). Not turned: as drawn.
      const nx = turn ? height - 1 - y : x, ny = turn ? x : y;
      data[ny * bytesPerRow + (nx >> 3)] |= 0x80 >> (nx & 7);
    }
  return { width: outW, height: outH, bytesPerRow, data };
}

// ---- The bytes ----------------------------------------------------------------------------------

const WAKE = new Uint8Array(15); // 15 zero bytes
const ENABLE = [0x10, 0xff, 0xf1, 0x02];
const STOP = [0x10, 0xff, 0xf1, 0x45];
const TO_GAP = [0x1d, 0x0c]; // feed to the next label
const FEED_100 = [0x1b, 0x4a, 100]; // continuous roll: feed 100 dots (12.5 mm)

/**
 * One label: `setup` (darkness, wake up, start) is sent first, then `body` (the image, feed, stop)
 * once the printer has granted credits again, so the image arrives without gaps.
 */
export function printJob(b: Bitmap, opts: { density: Density; paper: PaperType }): { setup: Uint8Array; body: Uint8Array } {
  const setup = Uint8Array.from([0x1f, 0x70, 0x02, opts.density, ...WAKE, ...ENABLE]);
  const header = [0x1d, 0x76, 0x30, 0x00, b.bytesPerRow & 0xff, b.bytesPerRow >> 8, b.height & 0xff, b.height >> 8];
  const tail = [...(opts.paper === "gap" ? TO_GAP : FEED_100), ...STOP];
  const body = new Uint8Array(header.length + b.data.length + tail.length);
  body.set(header, 0);
  body.set(b.data, header.length);
  body.set(tail, header.length + b.data.length);
  return { setup, body };
}

/** What the printer says, on the status (rx) or flow-control (cx) characteristic. */
export type PrinterReply =
  | { type: "printed" }
  | { type: "credit"; n: number }
  | { type: "mtu"; n: number }
  | { type: "problem"; problem: PrinterProblem }
  | null;
export type PrinterProblem = "out_of_paper" | "cover_open" | "overheating" | "low_battery" | "unknown";
const PROBLEMS: Record<number, PrinterProblem> = { 1: "out_of_paper", 2: "cover_open", 3: "overheating", 4: "low_battery" };

export function readReply(d: ArrayLike<number>): PrinterReply {
  if (!d.length) return null;
  const [a, b] = [d[0], d[1]];
  if (a === 0xaa || a === 0x4f || a === 0x4b) return { type: "printed" }; // 0xAA, "O", "K"
  if (d.length < 2) return null;
  if (a === 0x01) return { type: "credit", n: b };
  if (a === 0x02 && d.length >= 3) return { type: "mtu", n: (d[2] << 8) | b };
  if (a === 0xff) return b === 0x05 ? null /* cover closed again */ : { type: "problem", problem: PROBLEMS[b] ?? "unknown" };
  return null;
}

export const PROBLEM_TEXT: Record<PrinterProblem, string> = {
  out_of_paper: "The label printer is out of labels.",
  cover_open: "The label printer's cover is open.",
  overheating: "The label printer is too hot. Give it a minute.",
  low_battery: "The label printer's battery is low. Charge it.",
  unknown: "The label printer reported a problem.",
};

// ---- 2-inch label printers over Bluetooth (the Clabel 221B) ---------------------------------------
//
// Their Bluetooth isn't documented. They show up as a "serial port" service with one characteristic
// we write commands to; these are the services such printers commonly use. The commands are TSPL
// (most label printers) or ESC/POS (receipt-style printers), chosen in the settings.

export const SERIAL_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", // write 2af1, notify 2af0: most Chinese thermal printers
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb", // HM-10 style serial
  "0000ae30-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // Microchip "transparent UART"
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
];
/** Bluetooth names the Clabel 221B may advertise (also shown with "any printer" in the list). */
export const CLABEL_NAME_PREFIXES = ["CT221", "Clabel", "CLABEL", "221B"];

const ascii = (s: string) => Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);

/**
 * TSPL: one label of `size` (width across the printer × height along it, mm) with the image at the
 * top left, then print it. TSPL's BITMAP prints the 0 bits, so the image is inverted. `flip` turns
 * the print round (DIRECTION 0 instead of 1) for printers that load the labels the other way.
 */
export function tsplJob(b: Bitmap, o: { size: LabelSize; density: Density; flip: boolean; gapMm?: number }): Uint8Array {
  const density = { 1: 5, 2: 8, 3: 12 }[o.density];
  const head = ascii(
    `SIZE ${o.size.w} mm,${o.size.h} mm\r\nGAP ${o.gapMm ?? 2} mm,0 mm\r\nDIRECTION ${o.flip ? 0 : 1},0\r\nREFERENCE 0,0\r\n` +
      `DENSITY ${density}\r\nCLS\r\nBITMAP 0,0,${b.bytesPerRow},${b.height},0,`
  );
  const tail = ascii("\r\nPRINT 1,1\r\n");
  const out = new Uint8Array(head.length + b.data.length + tail.length);
  out.set(head, 0);
  for (let i = 0; i < b.data.length; i++) out[head.length + i] = ~b.data[i] & 0xff;
  out.set(tail, head.length + b.data.length);
  return out;
}

/** ESC/POS: reset, the image as a raster (1 = black), then feed to the next label's gap. */
export function escposJob(b: Bitmap): Uint8Array {
  const head = [0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, b.bytesPerRow & 0xff, b.bytesPerRow >> 8, b.height & 0xff, b.height >> 8];
  const out = new Uint8Array(head.length + b.data.length + 2);
  out.set(head, 0);
  out.set(b.data, head.length);
  out.set([0x1d, 0x0c], head.length + b.data.length);
  return out;
}
