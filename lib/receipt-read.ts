// Finds the reference number and amount in the text read (OCR) from a payment screenshot —
// GCash, Maya, BPI and other InstaPay / QR Ph receipts. Pure, so it can be tested. The player
// always checks the result before sending, because OCR can misread.

export type ReceiptRead = { reference: string | null; amount: number | null };

const REF_LABEL = /\b(?:ref(?:erence)?\.?\s*(?:no\.?|num(?:ber)?|#|id|code)?|trace\s*(?:no\.?|number)|transaction\s*(?:id|no\.?|number)|invoice\s*no\.?)\s*[:.#-]?\s*/gi;
const AMOUNT_LABELS = [/total\s*amount(?:\s*(?:sent|paid))?/i, /amount\s*(?:sent|paid|transferred)/i, /\bamount\b/i, /\btotal\b/i];
const MONEY = /(?:₱|PHP|Php|P|#)?\s*(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})|\d+\.\d{2}|\d{1,3}(?:,\d{3})+|\d+)/;

function cleanNumber(s: string): number | null {
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null;
}

/** The reference after a "Ref No." style label: groups of digits/capitals, stopping at words like a date. */
function referenceFrom(text: string): string | null {
  for (const m of text.matchAll(REF_LABEL)) {
    const rest = text.slice((m.index ?? 0) + m[0].length).split("\n")[0];
    const tokens: string[] = [];
    for (const t of rest.split(/\s+/)) {
      const tok = t.replace(/[.,;:]+$/, "");
      if (!/^[A-Z0-9-]+$/.test(tok) || /^\d{1,2}:\d{2}$/.test(tok)) break;
      tokens.push(tok);
      if (tokens.join("").length >= 30) break;
    }
    const ref = tokens.join(" ").replace(/-+$/, "");
    const chars = ref.replace(/[\s-]/g, "");
    if (chars.length >= 6 && (chars.match(/\d/g)?.length ?? 0) >= 4) return ref; // at least 4 digits
  }
  // GCash references without a readable label: 13 digits as 4-3-6.
  const g = /\b(\d{4}\s?\d{3}\s?\d{6})\b/.exec(text);
  return g ? g[1] : null;
}

function amountFrom(text: string): number | null {
  const lines = text.split("\n");
  for (const label of AMOUNT_LABELS) {
    for (let i = 0; i < lines.length; i++) {
      const m = label.exec(lines[i]);
      if (!m) continue;
      // The amount is on the same line after the label, or on the next line.
      const after = lines[i].slice((m.index ?? 0) + m[0].length);
      for (const s of [after, lines[i + 1] ?? ""]) {
        const v = MONEY.exec(s);
        const n = v ? cleanNumber(v[1]) : null;
        if (n !== null) return n;
      }
    }
  }
  // No label: the largest peso amount written with a ₱ / PHP sign.
  const signed = [...text.matchAll(/(?:₱|PHP|Php)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/g)]
    .map((m) => cleanNumber(m[1]))
    .filter((n): n is number => n !== null);
  return signed.length ? Math.max(...signed) : null;
}

export function readReceipt(text: string): ReceiptRead {
  const t = text.replace(/\r/g, "").replace(/[ \t]+/g, " ");
  return { reference: referenceFrom(t), amount: amountFrom(t) };
}
