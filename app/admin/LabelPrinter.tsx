"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_SIZE,
  LABEL_SIZES,
  SHIFT_MAX,
  SHIFT_STEP,
  labelSize,
  sizeKey,
  sizeLabel,
  type Density,
  type LabelPrinterSettings,
  type PaperType,
} from "@/lib/label-printer";
import {
  choosePrinter,
  connectedPrinterName,
  disconnectPrinter,
  drawTagLabel,
  getLabelSettings,
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

/** Whether this device prints tags on the label printer (and re-renders when that changes). */
export function useLabelPrinterOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(labelPrinterSupported() && getLabelSettings().on);
    read();
    return onLabelSettings(read);
  }, []);
  return on;
}

/** "🏷 Label printer" for the Stringing toolbar: only in browsers that can use Bluetooth printers. */
export function LabelPrinterButton({ tagQr }: { tagQr: boolean }) {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const on = useLabelPrinterOn();
  useEffect(() => setSupported(labelPrinterSupported()), []);
  if (!supported) return null;
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
  const [name, setName] = useState<string | null>(connectedPrinterName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Each change builds on the latest settings, so quick taps don't undo each other.
  const set = (p: Partial<LabelPrinterSettings> | ((prev: LabelPrinterSettings) => Partial<LabelPrinterSettings>)) =>
    setS((prev) => {
      const next = { ...prev, ...(typeof p === "function" ? p(prev) : p) };
      // A size that the other paper type doesn't have: back to the usual one.
      if (!LABEL_SIZES[next.paper].some((x) => sizeKey(x) === next.size)) next.size = DEFAULT_SIZE;
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
    const canvas = drawTagLabel(SAMPLE, labelSize(s), window.location.origin);
    const c = canvas.getContext("2d")!;
    const img = c.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114 < 160 ? 0 : 255;
      img.data.set([v, v, v, 255], i);
    }
    c.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }, [s]);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      setName(await choosePrinter());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect.");
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setError("");
    await printTagLabels([SAMPLE], s);
    setName(connectedPrinterName());
    setBusy(false);
  }
  const size = labelSize(s);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="card modal label-printer" role="dialog" aria-modal="true" aria-label="Label printer" onClick={(e) => e.stopPropagation()}>
        <div className="sf-modal-head">
          <div>
            <h2 style={{ margin: 0 }}>🏷 Label printer</h2>
            <div className="muted">Marklife P12, over Bluetooth</div>
          </div>
          <button type="button" className="btn small secondary" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="hint">
          Print racket tags as labels on this phone instead of on A4 paper. Switch the printer on and keep it near the phone.
          These settings are for this phone only.
        </p>

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
        {error && <div className="error">{error}</div>}

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
        <div className="row field">
          <div>
            <label htmlFor="lp-size">Label size <span className="hint">long side × short side</span></label>
            <select id="lp-size" value={s.size} onChange={(e) => set({ size: e.target.value })}>
              {LABEL_SIZES[s.paper].map((x) => <option key={sizeKey(x)} value={sizeKey(x)}>{sizeLabel(x)}</option>)}
            </select>
          </div>
          <div>
            <label>Darkness</label>
            <div className="segmented" role="radiogroup" aria-label="Darkness" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              {DENSITY.map((d) => (
                <button key={d.v} type="button" role="radio" aria-checked={s.density === d.v} onClick={() => set({ density: d.v })}>{d.label}</button>
              ))}
            </div>
          </div>
        </div>

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

        <label className="check-row lp-use">
          <input type="checkbox" checked={s.on} onChange={(e) => set({ on: e.target.checked })} />
          <span>
            <strong>Print racket tags on the label printer</strong>
            <span className="hint">
              {" "}— on this phone, 🖨 Print tags prints labels instead of opening the A4 page.
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
