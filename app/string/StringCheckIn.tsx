"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import FullScreenLoader from "@/components/FullScreenLoader";
import StringingForm, { type CheckInBody, type FormOptions } from "@/components/StringingForm";
import { formatPeso } from "@/lib/pricing";
import { loadStringing, rememberOrder, saveStringing, type SavedStringing } from "@/lib/saved-stringing";
import { daysText, tagLabel } from "@/lib/stringing";

/** /string — what the QR code at the desk opens: check in rackets for stringing. */
export default function StringCheckIn() {
  const router = useRouter();
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [error, setError] = useState("");
  const [mine, setMine] = useState<SavedStringing["orders"]>([]);

  useEffect(() => {
    setMine(loadStringing().orders);
    fetch("/api/stringing", { cache: "no-store" })
      .then((r) => r.json())
      .then(setOptions)
      .catch(() => setError("Couldn't load the form. Please check your connection, or ask the front desk to check you in."));
  }, []);

  async function submit(b: CheckInBody) {
    const res = await fetch("/api/stringing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", ...b }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Couldn't check in. Please try again.");
    // Remember the customer and their rackets on this device, for next time.
    saveStringing({
      name: b.name, mobile: b.mobile, email: b.email,
      rackets: b.rackets.map((r) => ({
        racket: r.racket, ownString: r.ownString, stringId: r.stringId, ownStringName: r.ownStringName, stringColor: r.stringColor,
        tensionMain: Number(r.tensionMain), tensionCross: Number(r.tensionCross), prestretch: r.prestretch,
      })),
    });
    rememberOrder(j.token, j.tags);
    router.push(`/string/${j.token}`);
  }

  if (error) return <div className="error">{error}</div>;
  if (!options) return <FullScreenLoader label="Getting the form ready…" />;
  const p = options.prices;
  return (
    <div className="stack stringing-page">
      <div>
        <h1 style={{ margin: 0 }}>🏸 Racket stringing</h1>
        <p className="lead" style={{ margin: "6px 0 0" }}>
          Stringing {formatPeso(p.labor)} + the string if you buy it from us. Ready in {daysText(p.standardDays)}, or{" "}
          {daysText(p.rushDays)} with rush (+{formatPeso(p.rush)}).
        </p>
      </div>
      {mine.length > 0 && (
        <div className="card">
          <strong>Your rackets with us</strong>
          <ul className="sf-mine">
            {mine.slice(0, 5).map((o) => (
              <li key={o.token}>
                <Link href={`/string/${o.token}`}>{o.tags.map(tagLabel).join(", ")}</Link>{" "}
                <span className="hint">checked in {new Date(o.at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <StringingForm options={options} onSubmit={submit} />
      <p className="hint">No data or no phone with you? The front desk can check you in.</p>
    </div>
  );
}
