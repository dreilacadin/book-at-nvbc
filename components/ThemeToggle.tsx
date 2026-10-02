"use client";

import { useEffect, useRef, useState } from "react";

// Light / dark / auto (follow the device). The choice is saved on this device and applied as
// <html data-theme="light|dark"> — before the page paints, by THEME_SCRIPT in the layout.

export type Theme = "auto" | "light" | "dark";
export const THEME_KEY = "nvbc-theme";

/** Runs in <head> before anything renders, so the page never flashes the wrong theme. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const OPTIONS: { id: Theme; label: string; icon: string }[] = [
  { id: "auto", label: "Auto (device setting)", icon: "🌓" },
  { id: "light", label: "Light", icon: "☀️" },
  { id: "dark", label: "Dark", icon: "🌙" },
];

function apply(t: Theme) {
  const root = document.documentElement;
  if (t === "auto") delete root.dataset.theme;
  else root.dataset.theme = t;
  try {
    if (t === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

/** A small button in the site header that opens Auto / Light / Dark. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("auto");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === "light" || t === "dark" ? t : "auto");
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.id === theme)!;
  return (
    <div className="theme-toggle" ref={box}>
      <button type="button" className="theme-btn" aria-haspopup="menu" aria-expanded={open}
        aria-label={`Theme: ${current.label}`} title={`Theme: ${current.label}`} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{current.icon}</span>
      </button>
      {open && (
        <div className="theme-menu" role="menu" aria-label="Theme">
          {OPTIONS.map((o) => (
            <button key={o.id} type="button" role="menuitemradio" aria-checked={theme === o.id}
              onClick={() => {
                apply(o.id);
                setTheme(o.id);
                setOpen(false);
              }}>
              <span aria-hidden="true">{o.icon}</span> {o.label}
              {theme === o.id && <span className="theme-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
