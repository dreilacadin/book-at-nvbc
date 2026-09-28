// Remembers this device's membership link (browser localStorage), so the applicant can get back
// to their status page and member QR without an account. Nothing here is sent anywhere.

const KEY = "nvbc_membership";

export type SavedMembership = { token: string; name: string; appliedOn: string };

export function loadMembership(): SavedMembership | null {
  try {
    const raw = localStorage.getItem(KEY);
    const m = raw ? (JSON.parse(raw) as SavedMembership) : null;
    return m && typeof m.token === "string" ? m : null;
  } catch {
    return null;
  }
}

export function saveMembership(m: SavedMembership) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* storage unavailable (private mode) — the link is still shown on screen */
  }
}

export function forgetMembership() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
