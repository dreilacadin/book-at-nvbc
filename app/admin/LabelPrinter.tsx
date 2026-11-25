"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SCALES,
  SHIFT_MAX,
  SHIFT_STEP,
  defaultScale,
  defaultSize,
  labelSize,
  sizeKey,
  sizeLabel,
  sizesFor,
  type Density,
  type LabelPrinterSettings,
  type PaperType,
  type PrinterKind,
} from "@/lib/label-printer";
import { CLABEL_HINT, clabelDetails } from "./clabel";
import {
  choosePrinter,
  connectedPrinterName,
  disconnectPrinter,
  drawTagLabel,
  getLabelSettings,
  labelPageUrl,
  labelPrinterSupported,
  onLabelSettings,
  onLabelStatus,
  printTagLabels,
  saveLabelSettings,
  type LabelStatus,
  type TagLabel,
} from "./p12";

const SAMPLE: TagLabel = { tag: 123, name: "Ana Santos", rush: true, paid: true };
const DENSITY: { v: Density; label: string }[] = [{ v: 1, label: "Light" }, { v: 2, label: "Normal" }, { v: 3, label: "Dark" }];
const PRINTERS: { v: PrinterKind; label: string; hint: string }[] = [
  { v: "p12", label: "Marklife P12", hint: "Bluetooth" },
  { v: "clabel", label: "Clabel 221B", hint: "Bluetooth" },
  { v: "usb", label: "On this computer", hint: "USB, e.g. the Clabel" },
];

/** Whether this device prints tags on the label printer (and re-renders when that changes). */
export function useLabelPrinterOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => {
      const s = getLabelSettings();
      setOn(s.on && (s.printer === "usb" || labelPrinterSupported()));
    };
    read();
    return onLabelSettings(read);
  }, []);
  return on;
}

/** "🏷 Label printer" for the Stringing toolbar (Bluetooth printers where the browser can, or one on USB). */
export function LabelPrinterButton({ tagQr }: { tagQr: boolean }) {
  const [open, setOpen] = useState(false);
  const on = useLabelPrinterOn();
  return (
    <>
      <button type="button" className="btn small secondary" onClick={() => setOpen(true)}>
        🏷 Label printer{on ? " · on" : ""}
      </button>
      {open && <LabelPrinterModal tagQr={tagQr} onClose={() => setOpen(false)} />}
    </>
  );
}

function LabelPrinterModal({ tagQr, onClose }: { tagQr: boolean; onClose: () => void }) {
  const [s, setS] = useState<LabelPrinterSettings>(getLabelSettings);
  const [bt] = useState(labelPrinterSupported);
  const [name, setName] = useState<string | null>(() => connectedPrinterName());
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Each change builds on the latest settings, so quick taps don't undo each other.
  const set = (p: Partial<LabelPrinterSettings> | ((prev: LabelPrinterSettings) => Partial<LabelPrinterSettings>)) =>
    setS((prev) => {
      const next = { ...prev, ...(typeof p === "function" ? p(prev) : p) };
      if (next.printer !== "p12") next.paper = "gap"; // continuous rolls: the P12 only
      // Changing printer: that printer's usual print size.
      if (next.printer !== prev.printer) next.scale = defaultScale(next.printer);
      // A size that printer (or paper type) doesn't take: back to its usual one.
      if (!sizesFor(next.printer, next.paper).some((x) => sizeKey(x) === next.size)) next.size = defaultSize(next.printer);
      saveLabelSettings(next);
      return next;
    });
  const nudge = (k: "shiftX" | "shiftY", d: number) =>
    set((prev) => ({ [k]: Math.max(-SHIFT_MAX, Math.min(SHIFT_MAX, prev[k] + d * SHIFT_STEP)) }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // What the label will look like: drawn, then black or white as the printer prints it.
  const preview = useMemo(() => {
    if (typeof document === "undefined") return "";
    const canvas = drawTagLabel(SAMPLE, labelSize(s), window.location.origin, { x: 0, y: 0 }, s.scale);
    const c = canvas.getContext("2d")!;
    const img = c.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114 < 160 ? 0 : 255;
      img.data.set([v, v, v, 255], i);
    }
    c.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }, [s]);

  function pickPrinter(p: PrinterKind) {
    set({ printer: p });
    setName(connectedPrinterName(p));
    setError("");
  }
  async function connect() {
    setBusy(true);
    setError("");
    try {
      setName(await choosePrinter(s.printer));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect.");
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    if (s.printer === "usb") return void window.open(labelPageUrl("sample=1"), "_blank", "noopener");
    setBusy(true);
    setError("");
    await printTagLabels([SAMPLE], { ...s, copies: 1 });
    setName(connectedPrinterName(s.printer));
    setBusy(false);
  }
  const size = labelSize(s);
  const usb = s.printer === "usb";
  const details = s.printer === "clabel" ? clabelDetails() : null;

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="card modal label-printer" role="dialog" aria-modal="true" aria-label="Label printer" onClick={(e) => e.stopPropagation()}>
        <div className="sf-modal-head">
          <div>
            <h2 style={{ margin: 0 }}>🏷 Label printer</h2>
            <div className="muted">{PRINTERS.find((p) => p.v === s.printer)?.label}, {usb ? "on this computer" : "over Bluetooth"}</div>
          </div>
          <button type="button" className="btn small secondary" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="hint">
          Print racket tags as labels instead of on A4 paper. These settings are for this {usb ? "computer" : "phone or computer"} only.
        </p>

        <div className="field">
          <label>Printer</label>
          <div className="segmented lp-kinds" role="radiogroup" aria-label="Printer">
            {PRINTERS.map((p) => (
              <button key={p.v} type="button" role="radio" aria-checked={s.printer === p.v} disabled={p.v !== "usb" && !bt}
                onClick={() => pickPrinter(p.v)}>
                {p.label}<small>{p.hint}</small>
              </button>
            ))}
          </div>
          {!bt && <p className="hint" style={{ margin: "6px 0 0" }}>Bluetooth printers need Chrome on Android, or Chrome or Edge on a computer.</p>}
        </div>

        {usb ? (
          <p className="lp-usb">
            Install the printer&apos;s driver on this computer (for the Clabel 221B: <strong>Clabel-CT221B</strong>) and plug it in.
            Then 🖨 Print tags opens the labels and the print dialog: choose the printer, the paper size below, margins
            <strong> None</strong> and scale <strong>100%</strong>.
          </p>
        ) : (
        <div className="lp-printer">
          {name ? (
            <>
              <span><span className="badge lp-ok">Connected</span> <strong>{name}</strong></span>
              <button type="button" className="btn small secondary" disabled={busy} onClick={() => { disconnectPrinter(); setName(null); }}>Disconnect</button>
            </>
          ) : (
            <>
              <span className="muted">Not connected</span>
              <button type="button" className="btn small" disabled={busy} onClick={connect}>{busy ? "Connecting…" : "Connect"}</button>
            </>
          )}
        </div>
        )}
        {s.printer === "clabel" && !name && <p className="hint" style={{ margin: 0 }}>Switch the printer on. In the Bluetooth list, choose the one named like {CLABEL_HINT} (the name on the printer&apos;s label).</p>}
        {error && <div className="error">{error}</div>}

        {s.printer === "p12" && (
        <div className="field">
          <label>Labels</label>
          <div className="segmented" role="radiogroup" aria-label="Labels" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {(["gap", "continuous"] as PaperType[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={s.paper === p} onClick={() => set({ paper: p })}>
                {p === "gap" ? "With gaps" : "Continuous roll"}
              </button>
            ))}
          </div>
        </div>
        )}
        <div className="row field">
          <div>
            <label htmlFor="lp-size">Label size <span className="hint">long side × short side</span></label>
            <select id="lp-size" value={s.size} onChange={(e) => set({ size: e.target.value })}>
              {sizesFor(s.printer, s.paper).map((x) => <option key={sizeKey(x)} value={sizeKey(x)}>{sizeLabel(x)}</option>)}
            </select>
          </div>
          {!usb && <div>
            <label>Darkness</label>
            <div className="segmented" role="radiogroup" aria-label="Darkness" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              {DENSITY.map((d) => (
                <button key={d.v} type="button" role="radio" aria-checked={s.density === d.v} onClick={() => set({ density: d.v })}>{d.label}</button>
              ))}
            </div>
          </div>}
        </div>

        {s.printer !== "p12" && (
          <div className="field">
            <label htmlFor="lp-scale">Print size <span className="hint">smaller if the printer cuts off the edges of the label</span></label>
            <select id="lp-scale" value={s.scale} onChange={(e) => set({ scale: Number(e.target.value) })}>
              {SCALES.map((v) => <option key={v} value={v}>{v}%{v === defaultScale(s.printer) ? " (usual)" : ""}</option>)}
            </select>
          </div>
        )}

        {s.printer === "clabel" && (
          <div className="row field">
            <div>
              <label htmlFor="lp-lang">Printer language <span className="hint">if a test label doesn&apos;t print, try the other</span></label>
              <select id="lp-lang" value={s.language} onChange={(e) => set({ language: e.target.value === "escpos" ? "escpos" : "tspl" })}>
                <option value="tspl">TSPL (most label printers)</option>
                <option value="escpos">ESC/POS</option>
              </select>
            </div>
            <label className="check-row" style={{ alignSelf: "end" }}>
              <input type="checkbox" checked={s.flip} onChange={(e) => set({ flip: e.target.checked })} />
              <span>Upside down? Turn the print round</span>
            </label>
          </div>
        )}

        <div className="field">
          <label>Position <span className="hint">if the print isn&apos;t centred on the label, move it and print a test label</span></label>
          <div className="lp-shift">
            <ShiftControl label="Left or right" value={s.shiftX} less="←" more="→" lessName="left" moreName="right"
              onStep={(d) => nudge("shiftX", d)} />
            <ShiftControl label="Up or down" value={s.shiftY} less="↑" more="↓" lessName="up" moreName="down"
              onStep={(d) => nudge("shiftY", d)} />
            {(s.shiftX !== 0 || s.shiftY !== 0) && (
              <button type="button" className="btn small secondary" onClick={() => set({ shiftX: 0, shiftY: 0 })}>Reset</button>
            )}
          </div>
        </div>

        <div className="lp-preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- drawn label preview */}
          {preview && <img src={preview} alt={`A sample tag label, ${sizeLabel(size)}`} style={{ aspectRatio: `${size.w} / ${size.h}` }} />}
          <span className="hint">Sample, {sizeLabel(size)}. The QR code opens the racket in the staff page.</span>
        </div>
        <div className="actions start">
          <button type="button" className="btn secondary" disabled={busy} onClick={test}>🖨 Print a test label</button>
        </div>

        {s.printer === "clabel" && (
          <div className="lp-details">
            <button type="button" className="link-btn" aria-expanded={showDetails} onClick={() => setShowDetails((x) => !x)}>
              {showDetails ? "Hide printer details" : "Printer details"}
            </button>
            {showDetails && (details ? (
              <dl>
                <dt>Name</dt><dd>{details.name || "(none)"}</dd>
                <dt>Service</dt><dd>{details.service}</dd>
                <dt>Writes to</dt><dd>{details.write}</dd>
                <dt>It said</dt><dd>{details.replies.length ? details.replies.join(" · ") : "nothing yet"}</dd>
              </dl>
            ) : <p className="hint" style={{ margin: 0 }}>Connect first.</p>)}
          </div>
        )}

        <label className="check-row lp-use">
          <input type="checkbox" checked={s.on} onChange={(e) => set({ on: e.target.checked })} />
          <span>
            <strong>Print racket tags on the label printer</strong>
            <span className="hint">
              {" "}— on this {usb ? "computer" : "device"}, 🖨 Print tags asks how many labels for each racket and prints them instead of
              opening the A4 page.
              {tagQr
                ? " Receiving a racket prints its tag."
                : " To print the tag as soon as a racket is received, the owner or a manager turns on Print tags with QR codes (Strings & stock)."}
            </span>
          </span>
        </label>
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

/** Moves the print half a millimetre at a time, up to SHIFT_MAX either way. */
function ShiftControl({ label, value, less, more, lessName, moreName, onStep }: {
  label: string; value: number; less: string; more: string; lessName: string; moreName: string; onStep: (d: -1 | 1) => void;
}) {
  const step = onStep;
  const text = value === 0 ? "centred" : `${Math.abs(value)} mm ${value < 0 ? lessName : moreName}`;
  return (
    <div className="lp-shift-row" role="group" aria-label={label}>
      <button type="button" className="btn small secondary" aria-label={`Move ${lessName}`} disabled={value <= -SHIFT_MAX} onClick={() => step(-1)}>{less}</button>
      <output aria-live="polite">{text}</output>
      <button type="button" className="btn small secondary" aria-label={`Move ${moreName}`} disabled={value >= SHIFT_MAX} onClick={() => step(1)}>{more}</button>
    </div>
  );
}

/** Shows what the label printer is doing (printing, printed, or what went wrong). */
export function LabelPrintStatus() {
  const [st, setSt] = useState<LabelStatus>(null);
  useEffect(() => onLabelStatus(setSt), []);
  if (!st) return null;
  return (
    <div className={`label-status ${st.state}`} role="status" aria-live="polite">
      <span aria-hidden="true">{st.state === "printing" ? "🏷" : st.state === "done" ? "✓" : "⚠️"}</span>
      <span>{st.text}</span>
    </div>
  );
}
