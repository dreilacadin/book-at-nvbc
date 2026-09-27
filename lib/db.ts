import { Pool, types } from "pg";

// Return DATE columns as plain "YYYY-MM-DD" strings instead of JS Dates,
// so dates never shift because of server timezones.
types.setTypeParser(1082, (v: string) => v);
// Return NUMERIC (money, percentages) as numbers. Values here are small, so this is exact enough.
types.setTypeParser(1700, (v: string) => parseFloat(v));

const globalForDb = globalThis as unknown as { __nvbcPool?: Pool };

/**
 * Vercel's database integrations don't all use the same variable name:
 * Neon sets DATABASE_URL, Supabase and older "Vercel Postgres" set POSTGRES_URL.
 * The first one that is set wins.
 */
export const DB_ENV_VARS = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL"] as const;

export function connectionInfo(): { name: string; value: string } | null {
  for (const name of DB_ENV_VARS) {
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
  hourly_rates: Record<string, number>;
  member_discount_pct: number;
  coach_discount_pct: number;
  member_code: string; // staff-only
  coach_code: string; // staff-only
  payment_methods: string[];
  gcash_name: string;
  gcash_number: string;
  bpi_account_name: string;
  bpi_account_number: string;
  qrph_image: string;
  payment_note: string;
};

export const SETTINGS_COLUMNS = `open_hour, close_hour, max_hours_per_booking, max_hours_per_day,
  booking_window_days, announcement, hourly_rates, member_discount_pct, coach_discount_pct,
  member_code, coach_code, payment_methods, gcash_name, gcash_number, bpi_account_name,
  bpi_account_number, qrph_image, payment_note`;

/** Full settings, including staff-only values. Never send this object to the public as-is. */
export async function getSettings(): Promise<Settings> {
  const { rows } = await db().query<Settings>(`SELECT ${SETTINGS_COLUMNS} FROM settings WHERE id = 1`);
  if (!rows[0]) throw new Error("Settings row missing. Run `npm run db:setup`.");
  return rows[0];
}
