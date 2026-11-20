// The customer's stringing details kept on this device: their name and contact (filled in next
// time), their last rackets ("Same as last time"), and their check-ins (to find the status pages
// again). Browser only; nothing here is required.

const KEY = "nvbc_stringing";

export type SavedRacket = {
  racket: string; ownString: boolean; stringId: number | null; ownStringName: string; stringColor: string;
  tensionMain: number; tensionCross: number; prestretch?: number | null;
};
export type SavedStringing = {
  name: string; mobile: string; email: string;
  rackets: SavedRacket[];
  orders: { token: string; tags: number[]; at: string }[]; // newest first
};

const EMPTY: SavedStringing = { name: "", mobile: "", email: "", rackets: [], orders: [] };

export function loadStringing(): SavedStringing {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v === "object" ? { ...EMPTY, ...v } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function saveStringing(patch: Partial<SavedStringing>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadStringing(), ...patch }));
  } catch {
    /* private mode: fine */
  }
}

/** Remembers a check-in (keeps the 10 newest). */
export function rememberOrder(token: string, tags: number[]): void {
  const s = loadStringing();
  saveStringing({ orders: [{ token, tags, at: new Date().toISOString() }, ...s.orders.filter((o) => o.token !== token)].slice(0, 10) });
}
