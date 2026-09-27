// Creates the tables and default data. Run with: npm run db:setup
// Safe to run again after pulling updates — it never deletes data.
import { readFile } from "node:fs/promises";
import pg from "pg";

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Put it in .env.local first (see .env.example).",
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
const client = new pg.Client({ connectionString: url });

try {
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query("SELECT count(*)::int AS n FROM courts");
  console.log(`Database ready. ${rows[0].n} court(s) configured.`);
} catch (err) {
  console.error("Database setup failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
