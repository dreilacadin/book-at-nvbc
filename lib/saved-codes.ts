// Remembers booking codes on this device only (browser localStorage), so players
// can find their bookings again without an account. Nothing here is sent anywhere.

const KEY = "nvbc_booking_codes";

export type SavedCode = { code: string; label: string; date: string };

export function loadCodes(): SavedCode[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedCode[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveCode(entry: SavedCode) {
  try {
    const list = loadCodes().filter((c) => c.code !== entry.code);
    list.unshift(entry);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* storage unavailable (private mode) — the code is still shown on screen */
  }
}

export function forgetCode(code: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadCodes().filter((c) => c.code !== code)));
  } catch {
    /* ignore */
  }
}
