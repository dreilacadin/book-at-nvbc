"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateLong } from "@/lib/format";
import { formatPeso, paymentLabel, type PaymentMethod } from "@/lib/pricing";
import { loadStringing, type SavedRacket } from "@/lib/saved-stringing";
import {
  daysText,
  earliestPickup,
  MAX_GROMMETS,
  normalizeMobile,
  PRESTRETCH_OPTIONS,
  priceLines,
  racketPrice,
  readTension,
  setupLabel,
  colorStock,
  inStock,
  stringName,
  TENSION_PRESETS,
  type StringingPrices,
  type StringItem,
} from "@/lib/stringing";
import { addDays } from "@/lib/time";
import Receipt from "./Receipt";

// The stringing check-in form: the customer's details and one or more rackets (racket, string,
// tension and pre-stretch, turnaround and collection date, grommets), with the price as they go. Customers use it
// on /string (from the QR code at the desk); staff use it in Admin → Stringing for walk-ins.

export type FormOptions = {
  strings: StringItem[];
  rackets: string[];
  ownStrings: string[];
  prices: StringingPrices;
  methods: PaymentMethod[];
  today: string;
};

type Draft = {
  key: number;
  racket: string;
  ownString: boolean;
  stringId: string;
  stringColor: string;
  ownStringName: string;
  tension: string; // "24" … "30", "custom", or "" (not chosen)
  customMain: string;
  customCross: string;
  prestretch: string; // "" (none), "5", "10", "15", "20"
  rush: boolean;
  dueOn: string;
  grommets: boolean;
  grommetsSingle: string;
  grommetsDouble: string;
  notes: string;
};

export type CheckInBody = {
  name: string; mobile: string; email: string;
  rackets: {
    racket: string; ownString: boolean; stringId: number | null; stringColor: string; ownStringName: string;
    tensionMain: string; tensionCross: string; prestretch: number | null; rush: boolean; dueOn: string; grommetsSingle: number;
    grommetsDouble: number; notes: string;
  }[];
  receive?: boolean; paidMethod?: PaymentMethod | null; // staff; received by whoever is logged in
};

type PastRacket = {
  racket?: string; string_id?: number | null; string_name?: string; string_color?: string; own_string?: boolean; tension_main?: number;
  tension_cross?: number; prestretch?: number | null;
};

let nextKey = 1;

/** "26" (a preset) or "custom" with the mains and crosses. */
function tensionFields(main: number, cross: number): Pick<Draft, "tension" | "customMain" | "customCross"> {
  const preset = main === cross && (TENSION_PRESETS as readonly number[]).includes(main);
  return preset ? { tension: String(main), customMain: "", customCross: "" } : { tension: "custom", customMain: String(main), customCross: String(cross) };
}

export default function StringingForm({
  options,
  staffName,
  onSubmit,
}: {
  options: FormOptions;
  staffName?: string; // staff checking in for a customer
  onSubmit: (body: CheckInBody) => Promise<void>; // throws an Error with a message to show
}) {
  const staff = staffName !== undefined;
  const { strings, prices, today } = options;
  // Customers can only choose strings and colours in stock (staff can choose any: the count may be behind).
  const canBuy = (x: StringItem) => staff || inStock(x);
  const colorOk = (x: StringItem, c: string) => x.colors.includes(c) && (staff || colorStock(x, c) > 0);
  /** The colour to use for a string: the one wanted if it can be had, otherwise the first in stock. */
  const colorFor = (x: StringItem | undefined, wanted = "") =>
    !x ? "" : colorOk(x, wanted) ? wanted : x.colors.find((c) => colorOk(x, c)) ?? x.colors[0] ?? "";
  const first = strings.find(canBuy);
  const blank = (from?: Draft): Draft => ({
    key: nextKey++,
    racket: "",
    ownString: from ? from.ownString : !first,
    stringId: from ? from.stringId : first ? String(first.id) : "",
    stringColor: from ? from.stringColor : colorFor(first),
    ownStringName: from ? from.ownStringName : "",
    tension: from ? from.tension : "",
    customMain: from ? from.customMain : "",
    customCross: from ? from.customCross : "",
    prestretch: from ? from.prestretch : "",
    rush: false,
    dueOn: earliestPickup(today, false, prices),
    grommets: false,
    grommetsSingle: "",
    grommetsDouble: "",
    notes: "",
  });
  const fromSaved = (r: SavedRacket | PastRacket): Draft => {
    const s = r as SavedRacket & PastRacket;
    const own = s.ownString ?? s.own_string ?? false;
    const id = s.stringId ?? s.string_id ?? null;
    const known = !own && strings.find((x) => x.id === id && canBuy(x));
    const pick = known || first; // a sold-out NVBC string: pick another one of ours
    const pre = s.prestretch ?? null;
    return {
      ...blank(),
      racket: s.racket ?? "",
      ownString: !known && (own || !first), // a sold-out NVBC string: pick another one of ours
      stringId: known ? String(known.id) : first ? String(first.id) : "",
      stringColor: colorFor(pick || undefined, s.stringColor ?? s.string_color ?? ""),
      ownStringName: known ? "" : s.ownStringName ?? s.string_name ?? "",
      ...tensionFields(Number(s.tensionMain ?? s.tension_main), Number(s.tensionCross ?? s.tension_cross)),
      prestretch: pre ? String(pre) : "",
    };
  };

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [rackets, setRackets] = useState<Draft[]>(() => [blank()]);
  const [saved, setSaved] = useState<SavedRacket[]>([]);
  const [receive, setReceive] = useState(true);
  const [paidMethod, setPaidMethod] = useState<PaymentMethod | "">("");
  const [past, setPast] = useState<{ name: string; email: string; rackets: PastRacket[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());

  // The check-in time, kept current.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Customers: their details and last rackets from this device.
  useEffect(() => {
    if (staff) return;
    const s = loadStringing();
    setName(s.name);
    setMobile(s.mobile);
    setEmail(s.email);
    setSaved(s.rackets);
  }, [staff]);

  // Staff: a returning customer's name, email and rackets, from their mobile number.
  const mobileOk = normalizeMobile(mobile);
  useEffect(() => {
    if (!staff || !mobileOk) return setPast(null);
    let live = true;
    fetch(`/api/admin/stringing?customer=${mobileOk}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!live || !j.customer) return setPast(null);
        setPast(j.customer);
        setName((n) => n || j.customer.name);
        setEmail((e) => e || j.customer.email);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [staff, mobileOk]);

  const set = (key: number, patch: Partial<Draft>) => setRackets((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // The colour the box shows: the chosen one if it can be had, otherwise the first in stock, so what's
  // sent always matches the screen.
  const shownColor = (r: Draft) => colorFor(strings.find((x) => String(x.id) === r.stringId), r.stringColor);
  const priced = useMemo(() => rackets.map((r) => {
    const s = strings.find((x) => String(x.id) === r.stringId);
    const n = (v: string) => (r.grommets && v !== "" ? Math.max(0, Math.floor(Number(v)) || 0) : 0);
    return racketPrice({ rush: r.rush, stringPrice: r.ownString || !s ? 0 : s.price, grommetsSingle: n(r.grommetsSingle), grommetsDouble: n(r.grommetsDouble) }, prices);
  }), [rackets, strings, prices]);
  const total = priced.reduce((s, p) => s + p.total, 0);

  // Filled in with what was typed; an empty list is "not chosen yet".
  const body = (): CheckInBody | string => {
    if (name.trim().length < 2) return "Enter your name.";
    if (!mobileOk) return "Enter a mobile number like 0917 123 4567.";
    const out: CheckInBody["rackets"] = [];
    for (const [i, r] of rackets.entries()) {
      const which = rackets.length > 1 ? `Racket ${i + 1}: ` : "";
      if (r.racket.trim().length < 2) return `${which}enter the racket (brand and model).`;
      if (r.ownString && r.ownStringName.trim().length < 2) return `${which}enter the string you brought.`;
      if (!r.tension) return `${which}choose the tension.`;
      const main = r.tension === "custom" ? r.customMain : r.tension;
      const cross = r.tension === "custom" ? r.customCross || r.customMain : r.tension;
      if (readTension(main) === null || readTension(cross) === null) return `${which}enter the tension in lbs, e.g. 24 × 26.`;
      out.push({
        racket: r.racket, ownString: r.ownString, stringId: r.ownString ? null : Number(r.stringId), stringColor: r.ownString ? "" : shownColor(r),
        ownStringName: r.ownString ? r.ownStringName : "", tensionMain: main, tensionCross: cross,
        prestretch: r.prestretch ? Number(r.prestretch) : null, rush: r.rush, dueOn: r.dueOn,
        grommetsSingle: r.grommets ? Number(r.grommetsSingle || 0) : 0, grommetsDouble: r.grommets ? Number(r.grommetsDouble || 0) : 0, notes: r.notes,
      });
    }
    return {
      name, mobile: mobileOk, email, rackets: out,
      ...(staff ? { receive, paidMethod: paidMethod || null } : {}),
    };
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const b = body();
    if (typeof b === "string") return setError(b);
    setBusy(true);
    setError("");
    try {
      await onSubmit(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stringing-form" onSubmit={submit}>
      <datalist id="sf-rackets">{options.rackets.map((r) => <option key={r} value={r} />)}</datalist>
      <datalist id="sf-strings">{options.ownStrings.map((s) => <option key={s} value={s} />)}</datalist>

      <div className="card stack">
        <div className="sf-when">
          🕒 Check-in: <strong>{now.toLocaleString("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</strong>
        </div>
        <div className="row field">
          <div>
            <label htmlFor="sf-mobile">Mobile number</label>
            <input id="sf-mobile" type="tel" inputMode="tel" autoComplete="tel" required placeholder="0917 123 4567"
              value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </div>
          <div>
            <label htmlFor="sf-name">Name</label>
            <input id="sf-name" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sf-email">Email <span className="hint">optional — we&apos;ll email you when it&apos;s ready</span></label>
          <input id="sf-email" type="email" inputMode="email" autoComplete="email" maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {staff && past && past.rackets.length > 0 && (
          <div className="sf-past">
            <span className="hint">Returning customer — tap to add a racket they brought before:</span>
            <div className="sf-chips">
              {past.rackets.map((r, i) => (
                <button key={i} type="button" className="btn small secondary" onClick={() =>
                  setRackets((rs) => (rs.length === 1 && !rs[0].racket ? [fromSaved(r)] : [...rs, fromSaved(r)]))}>
                  + {r.racket} · {r.string_name} · {setupLabel(Number(r.tension_main), Number(r.tension_cross), r.prestretch)}
                </button>
              ))}
            </div>
          </div>
        )}
        {!staff && saved.length > 0 && rackets.length === 1 && !rackets[0].racket && (
          <button type="button" className="btn secondary" onClick={() => setRackets(saved.map(fromSaved))}>
            ↺ Same as last time ({saved.map((r) => r.racket).join(", ")})
          </button>
        )}
      </div>

      {rackets.map((r, i) => {
        const s = strings.find((x) => String(x.id) === r.stringId);
        const min = staff ? today : earliestPickup(today, r.rush, prices);
        const p = priced[i];
        return (
          <fieldset key={r.key} className="card stack sf-racket">
            <legend>Racket {rackets.length > 1 ? i + 1 : ""}</legend>
            {rackets.length > 1 && (
              <button type="button" className="link-btn sf-remove" onClick={() => setRackets((rs) => rs.filter((x) => x.key !== r.key))}>Remove</button>
            )}
            <div className="field">
              <label htmlFor={`sf-r${r.key}`}>Racket <span className="hint">brand and model</span></label>
              <input id={`sf-r${r.key}`} list="sf-rackets" required maxLength={80} placeholder="e.g. Yonex Astrox 88D Pro" autoComplete="off"
                value={r.racket} onChange={(e) => set(r.key, { racket: e.target.value })} />
            </div>

            <div className="field">
              <label>String</label>
              {first && (
                <div className="segmented sf-two" role="radiogroup" aria-label="String">
                  <button type="button" role="radio" aria-checked={!r.ownString} onClick={() => set(r.key, { ownString: false })}>
                    Buy from NVBC
                  </button>
                  <button type="button" role="radio" aria-checked={r.ownString} onClick={() => set(r.key, { ownString: true })}>
                    I brought my own
                  </button>
                </div>
              )}
              {!r.ownString && s ? (
                <div className="row" style={{ marginTop: 8 }}>
                  <select aria-label="String" value={r.stringId}
                    onChange={(e) => {
                      const n = strings.find((x) => String(x.id) === e.target.value);
                      set(r.key, { stringId: e.target.value, stringColor: colorFor(n, r.stringColor) });
                    }}>
                    {strings.map((x) => (
                      <option key={x.id} value={x.id} disabled={!canBuy(x)}>
                        {stringName(x)} — {formatPeso(x.price)}{!inStock(x) ? " (out of stock)" : staff ? ` · ${x.stock} in stock` : ""}
                      </option>
                    ))}
                  </select>
                  {s.colors.length > 0 && (
                    <select aria-label="Colour" value={shownColor(r)} onChange={(e) => set(r.key, { stringColor: e.target.value })}>
                      {s.colors.map((c) => (
                        <option key={c} value={c} disabled={!colorOk(s, c)}>
                          {c}{colorStock(s, c) <= 0 ? " (out of stock)" : staff ? ` · ${colorStock(s, c)} in stock` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                <input aria-label="Your string" list="sf-strings" maxLength={80} placeholder="e.g. Yonex BG66 Ultimax" autoComplete="off"
                  style={{ marginTop: 8 }} value={r.ownStringName} onChange={(e) => set(r.key, { ownStringName: e.target.value })} />
              )}
            </div>

            <div className="field">
              <label>Tension</label>
              <div className="sf-tensions" role="radiogroup" aria-label="Tension">
                {TENSION_PRESETS.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={r.tension === String(t)} onClick={() => set(r.key, { tension: String(t) })}>
                    {t}<small>lbs</small>
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={r.tension === "custom"} onClick={() => set(r.key, { tension: "custom" })}>
                  Custom
                </button>
              </div>
              {r.tension === "custom" && (
                <div className="sf-custom">
                  <input aria-label="Mains (lbs)" inputMode="decimal" placeholder="Mains" value={r.customMain}
                    onChange={(e) => set(r.key, { customMain: e.target.value })} />
                  <span>×</span>
                  <input aria-label="Crosses (lbs)" inputMode="decimal" placeholder="Crosses" value={r.customCross}
                    onChange={(e) => set(r.key, { customCross: e.target.value })} />
                  <span className="hint">lbs — e.g. 24 × 26 (leave crosses blank if the same)</span>
                </div>
              )}
            </div>

            <div className="field">
              <label>Pre-stretch <span className="hint">optional</span></label>
              <div className="sf-prestretch" role="radiogroup" aria-label="Pre-stretch">
                {["", ...PRESTRETCH_OPTIONS.map(String)].map((v) => (
                  <button key={v || "none"} type="button" role="radio" aria-checked={r.prestretch === v} onClick={() => set(r.key, { prestretch: v })}>
                    {v ? `${v}%` : "None"}
                  </button>
                ))}
              </div>
              <p className="hint sf-help">
                Pre-stretching pulls the string tight before it&apos;s strung, so it loses less tension in the first days and holds it
                longer. It also feels a little firmer. Most players choose 5–10%; not sure? Leave it at None.
              </p>
            </div>

            <div className="field">
              <label>Turnaround</label>
              <div className="segmented sf-two" role="radiogroup" aria-label="Turnaround">
                <button type="button" role="radio" aria-checked={!r.rush}
                  onClick={() => set(r.key, { rush: false, dueOn: r.dueOn < earliestPickup(today, false, prices) || r.dueOn === earliestPickup(today, true, prices) ? earliestPickup(today, false, prices) : r.dueOn })}>
                  Standard<small>{daysText(prices.standardDays)}</small>
                </button>
                <button type="button" role="radio" aria-checked={r.rush}
                  onClick={() => set(r.key, { rush: true, dueOn: r.dueOn === earliestPickup(today, false, prices) ? earliestPickup(today, true, prices) : r.dueOn })}>
                  ⚡ Rush +{formatPeso(prices.rush)}<small>{daysText(prices.rushDays)}</small>
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor={`sf-d${r.key}`}>Collection date</label>
              <input id={`sf-d${r.key}`} type="date" required min={min} max={addDays(today, 60)} value={r.dueOn}
                onChange={(e) => set(r.key, { dueOn: e.target.value })} />
              {r.dueOn >= min && <p className="hint" style={{ margin: "4px 0 0" }}>Ready for pickup on {formatDateLong(r.dueOn)}.</p>}
            </div>

            <div className="field">
              <label className="check-row">
                <input type="checkbox" checked={r.grommets} onChange={(e) => set(r.key, { grommets: e.target.checked })} />
                Change grommets <span className="hint">{formatPeso(prices.grommetSingle)} single · {formatPeso(prices.grommetDouble)} double</span>
              </label>
              {r.grommets && (
                <div className="row" style={{ marginTop: 8 }}>
                  <div>
                    <label htmlFor={`sf-gs${r.key}`} className="hint">Single grommets</label>
                    <input id={`sf-gs${r.key}`} type="number" inputMode="numeric" min={0} max={MAX_GROMMETS} step={1} placeholder="0"
                      value={r.grommetsSingle} onChange={(e) => set(r.key, { grommetsSingle: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor={`sf-gd${r.key}`} className="hint">Double grommets</label>
                    <input id={`sf-gd${r.key}`} type="number" inputMode="numeric" min={0} max={MAX_GROMMETS} step={1} placeholder="0"
                      value={r.grommetsDouble} onChange={(e) => set(r.key, { grommetsDouble: e.target.value })} />
                  </div>
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor={`sf-n${r.key}`}>Notes <span className="hint">optional</span></label>
              <input id={`sf-n${r.key}`} maxLength={200} placeholder="e.g. knots at the throat" value={r.notes}
                onChange={(e) => set(r.key, { notes: e.target.value })} />
            </div>

            <Receipt className="sf-receipt" lines={priceLines(p, r.grommets ? (Number(r.grommetsSingle) || 0) + (Number(r.grommetsDouble) || 0) : 0)}
              total={p.total} totalLabel={rackets.length > 1 ? `Racket ${i + 1}` : "Total"} />
          </fieldset>
        );
      })}

      {rackets.length < 10 && (
        <button type="button" className="btn secondary block" onClick={() => setRackets((rs) => [...rs, blank(rs.at(-1))])}>
          + Add another racket
        </button>
      )}

      {staff && (
        <div className="card stack">
          <label className="check-row">
            <input type="checkbox" checked={receive} onChange={(e) => setReceive(e.target.checked)} />
            Received at the desk now
          </label>
          {receive && <p className="sf-locked">Received by 🔒 <strong>{staffName}</strong> <span className="hint">· now</span></p>}
          <div className="field">
            <label htmlFor="sf-paid">Payment</label>
            <select id="sf-paid" value={paidMethod} onChange={(e) => setPaidMethod(e.target.value as PaymentMethod | "")}>
              <option value="">Not paid yet</option>
              {options.methods.map((m) => <option key={m} value={m}>Paid — {paymentLabel(m)}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="card sf-total">
        {rackets.length > 1 ? (
          <Receipt lines={rackets.map((r, i) => ({ label: r.racket.trim() || `Racket ${i + 1}`, amount: priced[i].total }))}
            total={total} totalLabel={`Total · ${rackets.length} rackets`} />
        ) : (
          <Receipt lines={[]} total={total} />
        )}
        <p className="hint" style={{ margin: "10px 0 0" }}>
          {staff ? "The customer can pay online later from their link, or at the desk." : "Paid when you drop off your racket — online (GCash and others) or cash at the front desk."}
        </p>
      </div>
      {error && <div className="error">{error}</div>}
      <button className="btn block" disabled={busy}>{busy ? "Checking in…" : staff ? "Check in" : "Check in my racket" + (rackets.length > 1 ? "s" : "")}</button>
    </form>
  );
}
