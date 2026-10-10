"use client";

import { useEffect, useRef, useState } from "react";

const VIEW = 280; // the square crop window, px
const OUT = 600; // the saved photo, px square
const MAX_CHARS = 650_000; // same budget as lib/image.ts
const MAX_ZOOM = 4;

type View = { zoom: number; x: number; y: number }; // x/y: the image's top-left inside the window

/**
 * A square crop dialog: drag (or arrow keys) to move the photo, zoom with the slider, the mouse
 * wheel or a two-finger pinch. Returns the crop as a JPEG data: URL.
 */
export default function PhotoCropper({ src, onDone, onCancel }: { src: string; onDone: (dataUrl: string) => void; onCancel: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [error, setError] = useState("");
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const i = new Image();
    i.onload = () => {
      setImg(i);
      const s = VIEW / Math.min(i.width, i.height);
      setView({ zoom: 1, x: (VIEW - i.width * s) / 2, y: (VIEW - i.height * s) / 2 }); // centred
    };
    i.onerror = () => setError("Couldn't open that photo.");
    i.src = src;
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const base = img ? VIEW / Math.min(img.width, img.height) : 1; // scale at zoom 1: the photo just covers the window
  // Keep the photo covering the whole window.
  const clamp = (v: View): View => {
    if (!img) return v;
    const s = base * v.zoom;
    return { zoom: v.zoom, x: Math.min(0, Math.max(VIEW - img.width * s, v.x)), y: Math.min(0, Math.max(VIEW - img.height * s, v.y)) };
  };
  // Zoom around a point in the window (the centre by default), so that point stays put.
  const zoomTo = (zoom: number, at = { x: VIEW / 2, y: VIEW / 2 }) =>
    setView((v) => {
      const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
      const k = z / v.zoom;
      return clamp({ zoom: z, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k });
    });
  const pan = (dx: number, dy: number) => setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }));

  // The mouse wheel needs a non-passive listener so the page doesn't scroll.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => {
        const z = Math.min(MAX_ZOOM, Math.max(1, v.zoom * Math.exp(-e.deltaY / 400)));
        const k = z / v.zoom;
        const at = { x: e.clientX - r.left, y: e.clientY - r.top };
        return clamp({ zoom: z, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k });
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);

  function onPointerMove(e: React.PointerEvent) {
    const p = pointers.current;
    const prev = p.get(e.pointerId);
    if (!prev) return;
    p.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (p.size === 2) {
      const [a, b] = [...p.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current) {
        const r = boxRef.current!.getBoundingClientRect();
        const ratio = d / pinch.current;
        setView((v) => {
          const z = Math.min(MAX_ZOOM, Math.max(1, v.zoom * ratio));
          const k = z / v.zoom;
          const at = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
          return clamp({ zoom: z, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k });
        });
      }
      pinch.current = d;
    } else pan(e.clientX - prev.x, e.clientY - prev.y);
  }
  function onPointerEnd(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  }

  function save() {
    if (!img) return;
    const s = base * view.zoom;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = OUT;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, -view.x / s, -view.y / s, VIEW / s, VIEW / s, 0, 0, OUT, OUT);
    let out = canvas.toDataURL("image/jpeg", 0.88);
    if (out.length > MAX_CHARS) out = canvas.toDataURL("image/jpeg", 0.7);
    onDone(out);
  }

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="card modal cropper" role="dialog" aria-modal="true" aria-labelledby="crop-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="crop-title" style={{ marginTop: 0 }}>Crop your photo</h2>
        {error ? (
          <div className="error">{error}</div>
        ) : (
          <>
            <div
              ref={boxRef}
              className="cropper-box"
              style={{ width: VIEW, height: VIEW }}
              tabIndex={0}
              role="application"
              aria-label="Photo crop area. Drag or use the arrow keys to move the photo; + and − to zoom."
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 30 : 8;
                const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
                if (moves[e.key]) pan(...moves[e.key]);
                else if (e.key === "+" || e.key === "=") zoomTo(view.zoom * 1.1);
                else if (e.key === "-") zoomTo(view.zoom / 1.1);
                else return;
                e.preventDefault();
              }}
            >
              {img && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  style={{ width: img.width * base * view.zoom, height: img.height * base * view.zoom, transform: `translate(${view.x}px, ${view.y}px)` }}
                />
              )}
              <span className="cropper-ring" aria-hidden />
            </div>
            <label className="cropper-zoom">
              <span aria-hidden>－</span>
              <input type="range" aria-label="Zoom" min={1} max={MAX_ZOOM} step={0.01} value={view.zoom} disabled={!img}
                onChange={(e) => zoomTo(Number(e.target.value))} />
              <span aria-hidden>＋</span>
            </label>
            <p className="hint" style={{ margin: 0, textAlign: "center" }}>Drag to move · pinch, scroll or use the slider to zoom</p>
          </>
        )}
        <div className="actions">
          <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn" disabled={!img} onClick={save}>Use photo</button>
        </div>
      </div>
    </div>
  );
}
