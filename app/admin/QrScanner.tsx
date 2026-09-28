"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reads a QR code with the device camera and calls onCode once with its text.
 * Cameras only work on https:// pages (or localhost).
 */
export default function QrScanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    (async () => {
      try {
        const jsQR = (await import("jsqr")).default;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = () => {
          if (stopped) return;
          const v = video.current;
          if (v && ctx && v.readyState >= 2 && v.videoWidth) {
            // Scan a scaled-down frame: fast enough on phones, still reads a code filling part of the view.
            const scale = Math.min(1, 640 / v.videoWidth);
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (hit?.data) {
              stopped = true;
              onCode(hit.data);
              return;
            }
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch (e) {
        const name = (e as { name?: string }).name;
        setError(
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow the camera for this site in your browser settings, or type the code."
            : !window.isSecureContext
              ? "The camera only works on the secure (https://) site."
              : "No camera found. Use a QR scanner or type the code instead."
        );
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="Scan member QR code" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Scan member QR</h2>
        {error ? (
          <div className="error">{error}</div>
        ) : (
          <div className="scanner">
            <video ref={video} playsInline muted />
            <div className="scanner-frame" aria-hidden="true" />
          </div>
        )}
        <p className="hint">Hold the member&apos;s QR code inside the square.</p>
        <div className="actions">
          <button type="button" className="btn secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
