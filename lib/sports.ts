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

// Activities besides the sports (e.g. Zumba), set up in /admin → Settings. They're booked on
// courts like a sport. The list is registered here by whoever loaded the settings (the server on
// each settings read; pages from the data they fetch) so labels and emojis show everywhere.
export type ActivityDef = { id: string; label: string; emoji: string };
let customActivities: ActivityDef[] = [];

export function setCustomActivities(list: ActivityDef[]) {
  customActivities = list.filter((a) => !isSport(a.id));
}

/** The sports, then the custom activities. */
export function allActivities(): ActivityDef[] {
  return [...SPORTS, ...customActivities];
}

/** A sport or a custom activity id. */
export function isActivity(v: unknown): v is string {
  return typeof v === "string" && allActivities().some((a) => a.id === v);
}

/** A valid id for a new activity: lowercase letters, numbers and dashes. */
export const ACTIVITY_ID = /^[a-z][a-z0-9-]{1,29}$/;

export function sportLabel(id: string): string {
  return allActivities().find((s) => s.id === id)?.label ?? id;
}

export function sportEmoji(id: string): string {
  return allActivities().find((s) => s.id === id)?.emoji ?? "";
}

/** Can `activity` be booked on this court? Its own sport, or a court shared with the activity in Settings. */
export function courtAllowed(activity: string, court: { id: number; sport: string }, shared: Record<string, number[]>): boolean {
  return court.sport === activity || (shared[activity] ?? []).includes(court.id);
}
