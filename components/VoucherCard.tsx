"use client";

import { Plus_Jakarta_Sans } from "next/font/google";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { sportEmoji, sportLabel } from "@/lib/sports";
import { renderTerms, voucherPath, voucherStateLabel, type Voucher, type VoucherState } from "@/lib/voucher";

// The voucher as NVBC prints and shows it, in the "NVBC goes digital" style: navy with a faint grid,
// a gold headline, the logo, a pill, and a white QR tile that opens the voucher page.

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "700", "800"], display: "swap" });

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { maximumFractionDigits: 2 });
const shortDate = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The big gold headline and the line under it. */
function headline(v: Pick<Voucher, "kind" | "value" | "maxDiscount">): { big: string; small: string; pill: string } {
  if (v.kind === "free_hours")
    return { big: `${v.value % 1 ? v.value.toFixed(1) : v.value} ${v.value === 1 ? "hour" : "hours"}`, small: "of free court time", pill: "Free court hours" };
  if (v.kind === "fixed") return { big: `${peso(v.value)} off`, small: "your court booking", pill: "Discount voucher" };
  if (v.kind === "percent")
    return { big: `${v.value}% off`, small: `court fees${v.maxDiscount ? ` · up to ${peso(v.maxDiscount)}` : ""}`, pill: "Discount voucher" };
  return { big: peso(v.value), small: "to spend on court fees", pill: "Cash voucher" };
}

/** The site's address for the QR code and the card ("courts.nvbc.app"). */
export function useSite(): { origin: string; host: string } {
  const [site, setSite] = useState({ origin: "", host: "" });
  useEffect(() => setSite({ origin: window.location.origin, host: window.location.host }), []);
  return site;
}

/** The QR code that opens the voucher's page. */
function useQr(url: string): string {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!url) return;
    QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: "#000023", light: "#ffffff" } })
      .then((svg) => setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => setSrc(""));
  }, [url]);
  return src;
}

export default function VoucherCard({
  v,
  state,
  print = false,
}: {
  v: Pick<Voucher, "code" | "kind" | "value" | "maxDiscount" | "expiresOn" | "validFrom" | "sports" | "title"> & { issuedTo?: string };
  state?: VoucherState; // not ready (void, expired, used up, …): stamped across the card
  print?: boolean; // fixed size for paper
}) {
  const site = useSite();
  const qr = useQr(site.origin ? site.origin + voucherPath(v.code) : "");
  const h = headline(v);
  const stamp = state && state !== "ready" && state !== "not_yet" ? voucherStateLabel(state) : null;
  const sports = v.sports.length ? v.sports : null;
  return (
    <div className={`vcard ${jakarta.className}${print ? " print" : ""}`}>
      <div className="vcard-main">
        <div className="vcard-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static logo, also printed */}
          <img src="/nvbc-logo.png" alt="" width={44} height={44} />
          <span>
            <strong>NVBC</strong>
            <small>NV Badminton Center</small>
          </span>
        </div>
        <span className="vcard-pill">🎟 {h.pill}</span>
        <div className="vcard-big">{h.big}</div>
        <div className="vcard-small">{h.small}{v.title ? <> · <strong>{v.title}</strong></> : null}</div>
        <dl className="vcard-meta">
          <div>
            <dt>Valid</dt>
            <dd>
              {v.expiresOn ? `Until ${shortDate(v.expiresOn)}` : "No expiry"}
              {v.validFrom && !v.expiresOn ? ` · from ${shortDate(v.validFrom)}` : ""}
            </dd>
          </div>
          <div>
            <dt>For</dt>
            <dd>{sports ? sports.map((s) => `${sportEmoji(s)} ${sportLabel(s)}`).join(" · ") : "🏸 🏓 Any court"}</dd>
          </div>
          {v.issuedTo && (
            <div>
              <dt>Issued to</dt>
              <dd>{v.issuedTo}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="vcard-side">
        <div className="vcard-qr">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated QR code */}
          {qr ? <img src={qr} alt={`QR code for voucher ${v.code}`} /> : <span aria-hidden="true" />}
        </div>
        <div className="vcard-code">{v.code}</div>
        <small>📷 Scan to check &amp; book</small>
        {site.host && <small className="vcard-site">{site.host}/voucher</small>}
      </div>
      {stamp && <div className="vcard-stamp" aria-label={`This voucher is ${stamp.toLowerCase()}`}>{stamp}</div>}
    </div>
  );
}

/** The voucher's terms & conditions, numbered, for the page and the printout. */
export function VoucherTerms({
  v,
  compact = false,
}: {
  v: Pick<Voucher, "kind" | "value" | "maxDiscount" | "maxUses" | "validFrom" | "expiresOn" | "sports" | "terms" | "code">;
  compact?: boolean;
}) {
  const site = useSite();
  const lines = renderTerms(v, site.host || "the NVBC Courts website");
  return (
    <div className={`vterms ${jakarta.className}${compact ? " compact" : ""}`}>
      <strong>Terms &amp; conditions{compact ? ` · ${v.code}` : ""}</strong>
      <ol>
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ol>
    </div>
  );
}

