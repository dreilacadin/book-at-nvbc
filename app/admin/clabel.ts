// The Clabel 221B (and similar 2-inch label printers) over Web Bluetooth: Chrome on Android, or
// Chrome or Edge on a computer. Its Bluetooth isn't documented, so this finds the "serial port"
// service it offers, writes TSPL or ESC/POS commands to it (chosen in the settings), and keeps what
// the printer said in clabelDetails() to help set it up. The commands are in lib/label-printer.ts.

import {
  CLABEL_NAME_PREFIXES,
  SERIAL_SERVICES,
  escposJob,
  labelBitmap,
  tsplJob,
  type LabelPrinterSettings,
  type LabelSize,
} from "@/lib/label-printer";

type Characteristic = EventTarget & {
  uuid: string;
  value?: DataView;
  properties: { write: boolean; writeWithoutResponse: boolean; notify: boolean; indicate: boolean };
  startNotifications(): Promise<unknown>;
  writeValueWithResponse?(v: BufferSource): Promise<void>;
  writeValueWithoutResponse?(v: BufferSource): Promise<void>;
};
type Service = { uuid: string; getCharacteristics(): Promise<Characteristic[]> };
type Device = EventTarget & {
  id: string;
  name?: string;
  gatt?: { connected: boolean; connect(): Promise<{ getPrimaryServices(): Promise<Service[]> }>; disconnect(): void };
};
type Bluetooth = {
  requestDevice(o: { acceptAllDevices: true; optionalServices: string[] }): Promise<Device>;
  getDevices?(): Promise<Device[]>;
};
const bluetooth = () => (typeof navigator === "undefined" ? undefined : (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth);

const NAME_KEY = "nvbc.labelPrinter.clabel.name";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (v: DataView) => Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), (b) => b.toString(16).padStart(2, "0")).join(" ");

type Link = { dev: Device; tx: Characteristic; withResponse: boolean; service: string };
let device: Device | null = null;
let link: Link | null = null;
/** What we learned about the printer: for "Printer details" in the settings. */
let details: { name: string; service: string; write: string; replies: string[] } | null = null;

/** Finds the first service with a characteristic we can write to, and listens to what it says back. */
async function open(dev: Device): Promise<Link> {
  if (!dev.gatt) throw new Error("This Bluetooth device can't be used as a label printer.");
  const server = await dev.gatt.connect();
  const services = await server.getPrimaryServices().catch(() => [] as Service[]);
  for (const s of services) {
    const chars = await s.getCharacteristics().catch(() => [] as Characteristic[]);
    const tx = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
    if (!tx) continue;
    const replies: string[] = [];
    for (const c of chars.filter((c) => c.properties.notify || c.properties.indicate)) {
      c.addEventListener("characteristicvaluechanged", () => {
        if (c.value) replies.unshift(hex(c.value));
        replies.length = Math.min(replies.length, 5);
      });
      await c.startNotifications().catch(() => {});
    }
    device = dev;
    details = { name: dev.name ?? "", service: s.uuid, write: tx.uuid, replies };
    try { localStorage.setItem(NAME_KEY, dev.name ?? ""); } catch { /* fine */ }
    return { dev, tx, withResponse: tx.properties.write, service: s.uuid };
  }
  dev.gatt.disconnect();
  throw new Error(`“${dev.name ?? "That device"}” doesn't look like a label printer. Choose the Clabel in the Bluetooth list.`);
}

/** Choose the Clabel from the browser's Bluetooth list (needs a tap) and connect. Returns its name. */
export async function chooseClabel(): Promise<string> {
  const bt = bluetooth();
  if (!bt) throw new Error("This browser can't use Bluetooth printers. Use Chrome on Android, or Chrome or Edge on a computer.");
  // Its Bluetooth name isn't known for sure, so the list shows every nearby device.
  const dev = await bt.requestDevice({ acceptAllDevices: true, optionalServices: SERIAL_SERVICES }).catch((e: unknown) => {
    throw new Error(e instanceof Error && e.name === "NotFoundError" ? "No printer chosen." : e instanceof Error ? e.message : String(e));
  });
  if (link && link.dev !== dev) disconnectClabel();
  link = await open(dev);
  return dev.name ?? "Clabel";
}

async function connected(): Promise<Link> {
  if (link?.dev.gatt?.connected) return link;
  link = null;
  if (device) return (link = await open(device));
  const bt = bluetooth();
  const name = (() => { try { return localStorage.getItem(NAME_KEY); } catch { return null; } })();
  const known = name && bt?.getDevices ? (await bt.getDevices().catch(() => [])).find((d) => d.name === name) : undefined;
  if (known) {
    try { return (link = await open(known)); } catch { /* choose it instead */ }
  }
  await chooseClabel();
  return link!;
}

export const clabelName = () => (link?.dev.gatt?.connected ? link.dev.name ?? "Clabel" : null);
export function disconnectClabel() {
  link?.dev.gatt?.disconnect();
  link = null;
}
export const clabelDetails = () => details;
/** Names that look like a Clabel, to hint which one to choose in the list. */
export const CLABEL_HINT = CLABEL_NAME_PREFIXES.slice(0, 2).join(" or ");

/** Writes in small pieces: confirmed writes when the printer offers them, otherwise paced. */
async function send(l: Link, data: Uint8Array) {
  const size = l.withResponse ? 180 : 100;
  for (let off = 0; off < data.length; off += size) {
    if (!l.dev.gatt?.connected) throw new Error("The label printer disconnected. Is it switched on?");
    const chunk = data.slice(off, off + size);
    if (l.withResponse && l.tx.writeValueWithResponse) await l.tx.writeValueWithResponse(chunk);
    else if (l.tx.writeValueWithoutResponse) {
      await l.tx.writeValueWithoutResponse(chunk);
      await sleep(20);
    } else throw new Error("This printer can't be written to over Bluetooth.");
  }
}

/** Prints one drawn label (width across the printer × height along it). */
export async function printOnClabel(canvas: HTMLCanvasElement, size: LabelSize, s: LabelPrinterSettings) {
  const l = await connected();
  const img = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  const b = labelBitmap(img.data, canvas.width, canvas.height, 160, false);
  await send(l, s.language === "escpos" ? escposJob(b) : tsplJob(b, { size, density: s.density, flip: s.flip }));
  // No "printed" answer to wait for: give it time to print before the next label.
  await sleep(Math.max(600, size.h * 40));
}
