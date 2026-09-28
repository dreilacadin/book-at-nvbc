// Types and helpers shared by the admin page and its parts.
import type { BookingStatus, PaymentMethod, PaymentStatus, RateType, SportPricing } from "@/lib/pricing";
import type { Sport } from "@/lib/sports";

export type AdminBooking = {
  id: string;
  code: string;
  court_name: string;
  sport: Sport;
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
  has_proof: boolean;
  member_code: string | null; // member-rate bookings: whose member code was used
  member_name: string | null;
  expired_member_id: string | null; // the booker's membership has expired: remind them
  expired_member_name: string | null;
  expired_member_on: string | null;
  expired_member_reminded: string | null;
  ref_reused: number;
};
export type Court = { id: number; name: string; sport: Sport; is_active: boolean; sort_order: number; upcoming: number };
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
  bpi_account_name: string;
  bpi_account_number: string;
  qrph_image: string;
  payment_note: string;
  membership_fee_student: number;
  membership_fee_adult: number;
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
};
