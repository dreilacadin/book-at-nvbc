// Types and helpers shared by the admin page and its parts.
import type { BookingStatus, GcashAccount, PaymentMethod, PaymentStatus, RateType, SportPricing } from "@/lib/pricing";
import type { Sport } from "@/lib/sports";

export type AdminBooking = {
  id: string;
  code: string;
  court_name: string;
  sport: string; // the sport or activity booked
  court_id: number;
  date: string;
  start_hour: number;
  end_hour: number;
  name: string;
  contact: string;
  notes: string;
  status: BookingStatus;
  cancelled_by: string | null;
  created_at: string;
  rate_type: RateType;
  hourly_rate: number;
  discount_pct: number;
  amount: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  payment_ref: string;
  pay_by: string | null; // online booking: pay by this time or it is released
  phase: "in_progress" | "completed" | null; // set by staff by hand (null = automatic)
  auto_release: boolean; // false once restored by staff: never released for non-payment
  restored_by: string | null;
  court_order: number;
  has_proof: boolean;
  group_root: string; // the group's first booking (the booking itself when not in a group)
  group_code: string; // the code the customer uses
  group_size: number; // courts still booked under that code (1 = not a group)
  group_total: number;
  group_courts: string;
  reschedule_count: number;
  refund_status: "due" | "refunded" | "none" | null;
  refund_amount: number | null;
  refund_group_total: number;
  refund_ref: string;
  refund_note: string;
  refund_by: string | null;
  refund_at: string | null;
  no_show: boolean;
  no_show_by: string | null;
  player_flags: { date: string; code: string; kind: "no_show" | "unpaid" }[]; // this player's last 90 days
  court_sport: string; // the court's own sport (the booking may be for another activity)
  proof_deleted: boolean; // a screenshot was sent, then deleted once the payment was checked
  paid_amount_reported: number | null; // what the player says they sent (read from their screenshot)
  member_code: string | null; // member-rate bookings: whose member code was used
  member_name: string | null;
  expired_member_id: string | null; // the booker's membership has expired: remind them
  expired_member_name: string | null;
  expired_member_on: string | null;
  expired_member_reminded: string | null;
  payment_sent_at: string | null; // when the player sent their reference / screenshot
  payment_reuse: PaymentReuse[]; // other bookings with the same reference number or screenshot
  pay_to: string; // where this payment method's money should have gone (from Settings)
  rejected_note: string; // last time staff rejected the payment: why (kept after a new payment is sent)
  rejected_by: string | null;
  rejected_at: string | null;
  customer_email: string; // customer gets updates by email
  alert_devices: number; // customer's devices with push notifications on
  message_count: number; // messages with the customer about this booking
  unread_messages: number; // from the customer, not yet read by staff
};
export type PaymentReuse = {
  code: string;
  name: string;
  date: string;
  start_hour: number;
  amount: number;
  status: BookingStatus;
  same_ref: boolean;
  same_proof: boolean;
};
export type Court = {
  id: number;
  name: string;
  sport: Sport;
  is_active: boolean;
  sort_order: number;
  upcoming: number;
  notes: string; // shown to players (e.g. rain policy for an outdoor court)
};
export type Settings = {
  open_hour: number;
  close_hour: number;
  max_hours_per_booking: number;
  max_hours_per_day: number;
  booking_window_days: number;
  announcement: string;
  rate_plans: Record<string, SportPricing>;
  member_code: string;
  coach_code: string;
  payment_methods: PaymentMethod[];
  gcash_name: string;
  gcash_number: string;
  gcash_more: GcashAccount[]; // extra GCash accounts
  bpi_account_name: string;
  bpi_account_number: string;
  qrph_image: string;
  payment_note: string;
  membership_fee_student: number;
  membership_fee_adult: number;
  activities: { id: string; label: string; emoji: string }[]; // besides the sports (e.g. Zumba)
  activity_courts: Record<string, number[]>; // sport/activity → extra courts it can be booked on
  reschedule_hours: number;
  reschedule_max: number; // 0 = customers can't reschedule
};

export async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined
    ? { cache: "no-store" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthError(json.error || "Please log in.");
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json as T;
}
export class AuthError extends Error {}

export function todayManila() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

export type AdminMember = {
  id: string;
  token: string;
  member_code: string | null;
  status: "pending" | "active" | "rejected" | "forfeited";
  member_type: "student" | "adult";
  full_name: string;
  email: string;
  mobile: string;
  address: string;
  birthdate: string | null;
  gender: string;
  school: string;
  student_id: string;
  sports: string[];
  emergency_name: string;
  emergency_mobile: string;
  fee: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  payment_ref: string;
  has_proof: boolean;
  member_since: string | null;
  starts_on: string | null;
  expires_on: string | null;
  staff_notes: string;
  created_at: string;
  reminded_on: string | null;
  forfeited_on: string | null;
  emailed_on: string | null;
};
