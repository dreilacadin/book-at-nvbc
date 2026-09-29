import { Pool, types } from "pg";
import { toSportPricing, type GcashAccount, type SportPricing } from "./pricing";
import { SPORTS } from "./sports";

// Return DATE columns as plain "YYYY-MM-DD" strings instead of JS Dates,
// so dates never shift because of server timezones.
types.setTypeParser(1082, (v: string) => v);
// Return NUMERIC (money, percentages) as numbers. Values here are small, so this is exact enough.
types.setTypeParser(1700, (v: string) => parseFloat(v));

const globalForDb = globalThis as unknown as { __nvbcPool?: Pool };

/**
 * Vercel's database integrations don't all use the same variable name:
 * Neon sets DATABASE_URL, Supabase and older "Vercel Postgres" set POSTGRES_URL, and
 * when a database is connected through Vercel → Storage with a custom prefix the names
 * become e.g. STORAGE_DATABASE_URL or NEON_POSTGRES_URL. We accept all of these.
 */
export const DB_ENV_VARS = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL"] as const;

export function connectionInfo(): { name: string; value: string } | null {
  for (const name of DB_ENV_VARS) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  // Prefixed names from Vercel's Storage integration (pooled connections only).
  const prefixed = Object.keys(process.env)
    .filter((k) => /_(DATABASE_URL|POSTGRES_URL)$/.test(k) && !/UNPOOLED|NON_POOLING|NO_SSL/.test(k))
    .sort((a, b) => (a.endsWith("DATABASE_URL") ? 0 : 1) - (b.endsWith("DATABASE_URL") ? 0 : 1) || a.localeCompare(b));
  for (const name of prefixed) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return null;
}

function createPool() {
  const info = connectionInfo();
  if (!info) {
    throw new Error(
      "No database connection string found. Set DATABASE_URL (locally in .env.local, on Vercel under " +
        "Project → Settings → Environment Variables) and redeploy."
    );
  }
  return new Pool({
    connectionString: info.value,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000, // fail fast instead of hanging until Vercel's function timeout
  });
}

export function db(): Pool {
  if (!globalForDb.__nvbcPool) globalForDb.__nvbcPool = createPool();
  return globalForDb.__nvbcPool;
}

export type Settings = {
  open_hour: number;
  close_hour: number;
  max_hours_per_booking: number;
  max_hours_per_day: number;
  booking_window_days: number;
  announcement: string;
  rate_plans: Record<string, SportPricing>; // price plan per sport (always has every sport)
  hourly_rates: Record<string, number>; // pre-v6 prices, only used to fill a missing rate plan
  member_rates: Record<string, number>;
  coach_rates: Record<string, number>;
  member_code: string; // staff-only
  coach_code: string; // staff-only
  payment_methods: string[];
  gcash_name: string;
  gcash_number: string;
  gcash_more: GcashAccount[]; // extra GCash accounts, after the main one
  bpi_account_name: string;
  bpi_account_number: string;
  qrph_image: string;
  payment_note: string;
  membership_fee_student: number;
  membership_fee_adult: number;
};

export const SETTINGS_COLUMNS = `open_hour, close_hour, max_hours_per_booking, max_hours_per_day,
  booking_window_days, announcement, rate_plans, hourly_rates, member_rates, coach_rates,
  member_code, coach_code, payment_methods, gcash_name, gcash_number, gcash_more, bpi_account_name,
  bpi_account_number, qrph_image, payment_note, membership_fee_student, membership_fee_adult`;

/** Full settings, including staff-only values. Never send this object to the public as-is. */
export async function getSettings(): Promise<Settings> {
  const { rows } = await db().query<Settings>(`SELECT ${SETTINGS_COLUMNS} FROM settings WHERE id = 1`);
  const s = rows[0];
  if (!s) throw new Error("Settings row missing. Run `npm run db:setup`.");
  s.gcash_more = (Array.isArray(s.gcash_more) ? s.gcash_more : [])
    .filter((a): a is GcashAccount => typeof a?.name === "string" && typeof a?.number === "string");
  const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && v !== null ? Number(v) : fallback);
  s.rate_plans = Object.fromEntries(
    SPORTS.map((sp) => {
      const regular = num(s.hourly_rates?.[sp.id], 0);
      const legacy = { regular, member: num(s.member_rates?.[sp.id], regular), coach: num(s.coach_rates?.[sp.id], regular) };
      return [sp.id, toSportPricing(s.rate_plans?.[sp.id], legacy)];
    })
  );
  return s;
}
