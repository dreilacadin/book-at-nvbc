"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import { shortName, tagLabel } from "@/lib/stringing";
import type { TagRacket } from "@/lib/stringings";
import { api, AuthError } from "../../shared";

const PER_PAGE = 18; // 3 × 6 on A4

/**
 * Staff: racket tags to print on A4 (/admin/stringing/tags?blank=1, ?ids=… or ?order=…), 18 to a
 * page, cut along the dashed lines and tied to the racket. Each tag is just the big tag number and
 * Paid / Not yet paid / Rush boxes; everything else is found by searching the number in Admin →
 * Stringing. Blank tags get the number written on by hand. With "Print tags with QR codes" on (for
 * a label printer), printed tags also get a QR code that opens the racket.
 */
export default function PrintTags() {
  const [rackets, setRackets] = useState<TagRacket[] | null>(null);
  const [blank, setBlank] = useState(false);
  const [withQr, setWithQr] = useState(false);
  const [qr, setQr] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("blank")) {
      setBlank(true);
      return setRackets([]);
    }
    const ids = q.get("ids") ?? "";
    const order = q.get("order") ?? "";
    if (!ids && !order) return setError("No rackets chosen. Open a racket in Admin → Stringing and tap Print tags.");
    api<{ rackets: TagRacket[]; qr: boolean }>(`/api/admin/stringing?print=1&ids=${encodeURIComponent(ids)}&order=${encodeURIComponent(order)}`)
      .then((r) => {
        setWithQr(r.qr);
        if (r.rackets.length) setRackets(r.rackets);
        else setError("Those rackets weren't found.");
      })
      .catch((e) => setError(e instanceof AuthError ? "Please log in to the staff dashboard first." : e.message));
  }, []);
  useEffect(() => {
    if (!withQr || !rackets?.length) return;
    Promise.all(rackets.map(async (r) => [r.tag, await QRCode.toString(`${window.location.origin}/admin?tag=${r.tag}`,
      { type: "svg", errorCorrectionLevel: "M", margin: 0 })] as const))
      .then((list) => setQr(Object.fromEntries(list.map(([t, svg]) => [t, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`]))))
      .catch(() => {});
  }, [rackets, withQr]);

  if (error)
    return (
      <div className="stack" style={{ maxWidth: 520 }}>
        <div className="error">{error}</div>
        <Link href="/admin?tab=stringing" className="btn secondary">Back to Stringing</Link>
      </div>
    );
  if (!rackets) return <FullScreenLoader label="Getting the tags ready…" />;
  const tags: (TagRacket | null)[] = blank ? Array(PER_PAGE).fill(null) : rackets;
  const box = (on: boolean, label: string) => <span className="rtag-check"><span className={`rtag-box${on ? " on" : ""}`}>{on ? "✓" : ""}</span>{label}</span>;

  return (
    <div className="stack">
      <style>{`@page { size: A4 portrait; margin: 8mm; }`}</style>
      <div className="card no-print stack" style={{ maxWidth: 760 }}>
        <h1>{blank ? "Blank racket tags" : `Print ${tags.length} racket tag${tags.length === 1 ? "" : "s"}`}</h1>
        <p className="muted">
          A4, {PER_PAGE} tags per page, on any printer (keep the scale at 100%). Cut along the dashed lines, punch or tape through the
          circle, and tie the tag to the racket&apos;s handle.{" "}
          {blank
            ? "When you receive a racket, write its tag number (shown in Admin → Stringing) and tick Paid or Not yet paid, and Rush if it's a rush job."
            : "Tick Paid by hand if they pay later."}
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => window.print()}>🖨 Print</button>
          <button type="button" className="btn secondary" onClick={() => window.close()}>Close</button>
        </div>
      </div>
      <div className="tag-sheet">
        {tags.map((r, i) => (
          <div key={r?.id ?? i} className={`rtag${r && withQr ? " with-qr" : ""}`}>
            <span className="rtag-hole" aria-hidden="true" />
            <div className="rtag-main">
              <div className="rtag-brand">NVBC STRINGING{r && <span className="rtag-name"> · {shortName(r.name)}</span>}</div>
              <div className="rtag-num">{r ? tagLabel(r.tag) : <>#<span className="rtag-write" /></>}</div>
              <div className="rtag-checks">
                {box(!!r?.paid, "Paid")}
                {box(false, "Not yet paid")}
                {box(!!r?.rush, "Rush")}
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- generated QR code */}
            {r && withQr && (qr[r.tag] ? <img className="rtag-qr" src={qr[r.tag]} alt="" /> : <span className="rtag-qr" />)}
          </div>
        ))}
      </div>
    </div>
  );
}
