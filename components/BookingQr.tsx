"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** The booking code as a QR image — staff scan it at the front desk to pull up the booking. */
export default function BookingQr({ code }: { code: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(code, { errorCorrectionLevel: "M", margin: 2, width: 280 })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [code]);
  return (
    <div className="booking-qr">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt={`QR code for booking ${code}`} />}
      <div className="code-box" style={{ margin: 0 }}>{code}</div>
      <p className="hint" style={{ margin: 0 }}>Show this QR code at the front desk.</p>
    </div>
  );
}
