// The sports the center offers. To add another (e.g. tennis), add it here AND to the
// CHECK constraint on courts.sport in db/schema.sql.
export const SPORTS = [
  { id: "badminton", label: "Badminton", emoji: "🏸" },
  { id: "pickleball", label: "Pickleball", emoji: "🏓" },
] as const;

export type Sport = (typeof SPORTS)[number]["id"];

/** The "Book a court" page opens on this sport, and shows its tab first. */
export const BOOKING_DEFAULT_SPORT: Sport = "pickleball";

export function isSport(v: unknown): v is Sport {
  return SPORTS.some((s) => s.id === v);
}

export function sportLabel(id: string): string {
  return SPORTS.find((s) => s.id === id)?.label ?? id;
}

export function sportEmoji(id: string): string {
  return SPORTS.find((s) => s.id === id)?.emoji ?? "";
}
