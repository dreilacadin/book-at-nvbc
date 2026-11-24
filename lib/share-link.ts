// View-only booking links (/b/<token>, from "Share this booking"). No database here, so it can be
// tested and used in the browser.

/** A link token: 16 random bytes, base64url. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** The token in a scanned or pasted view-only link (…/b/<token>), or null for anything else. */
export function shareTokenIn(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const m = text.trim().match(/(?:^|\/)b\/([A-Za-z0-9_-]{22})(?=$|[/?#])/);
  return m ? m[1] : null;
}
