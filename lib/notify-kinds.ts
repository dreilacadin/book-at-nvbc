// Kinds of staff notifications. Shared by the server and the admin page (no Node imports).

export const NOTIFY_KINDS = [
  { id: "booking_new", label: "New bookings", icon: "📅" },
  { id: "payment_sent", label: "Payment proof sent (needs verifying)", icon: "💸" },
  { id: "booking_gone", label: "Cancelled or released bookings", icon: "↩️" },
  { id: "member_applied", label: "New membership applications", icon: "🪪" },
  { id: "message", label: "Messages from customers", icon: "💬" },
  { id: "booking_moved", label: "Bookings rescheduled by customers", icon: "🔁" },
  { id: "coach_applied", label: "New coach applications", icon: "🧑‍🏫" },
  { id: "coach_session", label: "Coaches: arrived, or not paid after their session", icon: "🎓" },
  { id: "stringing", label: "Racket stringing: check-ins, payments and feedback", icon: "🏸" },
  { id: "staff_signup", label: "New staff sign-ups (registration links)", icon: "👥" },
] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number]["id"];
export const ALL_KINDS: NotifyKind[] = NOTIFY_KINDS.map((k) => k.id);
export const isNotifyKind = (v: unknown): v is NotifyKind => NOTIFY_KINDS.some((k) => k.id === v);
/**
 * The kinds each role gets: Scholars only what their tabs (Bookings, Members, Stringing) can open;
 * sign-ups only go to those who can approve them (the owner and managers).
 */
const SCHOLAR_KINDS: readonly NotifyKind[] = ["booking_new", "payment_sent", "booking_gone", "member_applied", "message", "booking_moved", "stringing"];
export function kindsForRole(role: string): NotifyKind[] {
  if (role === "owner" || role === "manager") return ALL_KINDS;
  if (role === "scholar") return ALL_KINDS.filter((k) => SCHOLAR_KINDS.includes(k));
  return ALL_KINDS.filter((k) => k !== "staff_signup");
}
export const kindIcon = (k: string) => NOTIFY_KINDS.find((x) => x.id === k)?.icon ?? "🔔";

export type AdminEvent = {
  id: number;
  kind: NotifyKind;
  title: string;
  body: string;
  booking_code: string | null;
  membership_id: string | null;
  created_at: string;
};

/** Where clicking a notification goes in the admin panel. */
export function eventLink(e: Pick<AdminEvent, "booking_code" | "membership_id" | "kind">): string {
  if (e.booking_code) return `/admin?booking=${encodeURIComponent(e.booking_code)}`;
  if (e.kind === "member_applied") return "/admin?tab=members";
  if (e.kind === "coach_applied") return "/admin?tab=coaches";
  if (e.kind === "stringing") return "/admin?tab=stringing";
  if (e.kind === "staff_signup") return "/admin?tab=staff";
  return "/admin";
}

/**
 * What one push notification says for a batch of new events: the event itself when there's one,
 * otherwise a summary ("3 new notifications") that opens the admin panel.
 */
export function pushSummary(events: { push_title: string; body: string; kind: string; booking_code: string | null; membership_id: string | null }[]):
  { title: string; body: string; url: string; tag: string } | null {
  if (events.length === 0) return null;
  if (events.length === 1) {
    const e = events[0];
    return { title: e.push_title, body: e.body, url: eventLink({ ...e, kind: e.kind as NotifyKind }), tag: e.booking_code ?? e.kind };
  }
  const titles = events.slice(0, 3).map((e) => e.push_title).join(" · ");
  return { title: `${events.length} new notifications`, body: titles + (events.length > 3 ? " · …" : ""), url: "/admin", tag: "nvbc-batch" };
}

/** "just now", "5 min ago", "2 h ago", "3 d ago". */
export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
