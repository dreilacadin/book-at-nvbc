// Kinds of staff notifications. Shared by the server and the admin page (no Node imports).

export const NOTIFY_KINDS = [
  { id: "booking_new", label: "New bookings", icon: "📅" },
  { id: "payment_sent", label: "Payment proof sent (needs verifying)", icon: "💸" },
  { id: "booking_gone", label: "Cancelled or released bookings", icon: "↩️" },
  { id: "member_applied", label: "New membership applications", icon: "🪪" },
  { id: "message", label: "Messages from customers", icon: "💬" },
  { id: "booking_moved", label: "Bookings rescheduled by customers", icon: "🔁" },
] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number]["id"];
export const ALL_KINDS: NotifyKind[] = NOTIFY_KINDS.map((k) => k.id);
export const isNotifyKind = (v: unknown): v is NotifyKind => NOTIFY_KINDS.some((k) => k.id === v);
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
