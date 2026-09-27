// Creates the tables and default data, and applies any schema updates.
// Run with: npm run db:setup — or automatically on every Vercel deploy (see "vercel-build").
// Safe to run again and again — it never deletes data.
import { readFile } from "node:fs/promises";
import pg from "pg";

// Same lookup as lib/db.ts: DATABASE_URL / POSTGRES_URL, or a prefixed name from
// Vercel's Storage integration such as STORAGE_DATABASE_URL (pooled connections only).
function connectionString() {
  for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL"]) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  const prefixed = Object.keys(process.env)
    .filter((k) => /_(DATABASE_URL|POSTGRES_URL)$/.test(k) && !/UNPOOLED|NON_POOLING|NO_SSL/.test(k))
    .sort((a, b) => (a.endsWith("DATABASE_URL") ? 0 : 1) - (b.endsWith("DATABASE_URL") ? 0 : 1) || a.localeCompare(b));
  for (const name of prefixed) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return "";
}

const url = connectionString();
if (!url) {
  console.error(
    "DATABASE_URL is not set. Locally, put it in .env.local (see .env.example). On Vercel, add it under " +
      "Project → Settings → Environment Variables for this environment (Production and/or Preview).",
  );
  process.exit(1);
}
try {
  const u = new URL(url);
  console.log(
    `Connecting to ${u.hostname} / database "${u.pathname.slice(1)}" as ${decodeURIComponent(u.username)}…`,
  );
} catch {
  console.error(
    "DATABASE_URL doesn't look like a valid postgresql:// connection string.",
  );
  process.exit(1);
}

const sql = await readFile(
  new URL("../db/schema.sql", import.meta.url),
  "utf8",
);
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });

// Any fixed number works; it just has to be the same for every run of this script.
const LOCK_ID = 7_310_442;

try {
  await client.connect();
  // Two deploys at once (e.g. Production + a Preview on the same database) wait their turn.
  await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
  // All statements run in one transaction: a failure leaves the database as it was.
  await client.query(`BEGIN;\n${sql}\nCOMMIT;`);
  const { rows } = await client.query("SELECT count(*)::int AS n FROM courts");
  console.log(`Database ready. ${rows[0].n} court(s) configured.`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Database setup failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {}); // closing the connection also releases the lock
}
