"use client";

import { useEffect, useState } from "react";

/**
 * A payment screenshot that opens full screen inside the page (tap anywhere or ✕ to close).
 * Staying in the page matters in the installed app on phones: a new tab opens outside the app,
 * where the staff login may not be sent.
 */
export default function ProofViewer({ src, alt, className, children }: { src: string; alt: string; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" className={`proof-open ${className ?? ""}`} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-protected image */}
          <img src={src} alt={alt} />
          <button type="button" className="lightbox-close" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
        </div>
      )}
    </>
  );
}
