import { connectionInfo, db, DB_ENV_VARS } from "./db";

// Diagnoses the deployment's setup step by step and explains failures in plain words.
// Used by /status (page) and /api/health (JSON). Never reveals passwords or full connection strings.

export type Check = { name: string; ok: boolean; warn?: boolean; detail: string; fix?: string };

const REDEPLOY =
  "After changing environment variables on Vercel you must redeploy: Deployments → ⋯ on the latest one → Redeploy.";

function maskHost(host: string): string {
  // Enough to recognise which database it is, without publishing the full address.
  const parts = host.split(".");
  const first = parts[0] ?? "";
  const shown = first.length > 10 ? first.slice(0, 10) + "…" : first;
  return [shown, ...parts.slice(1)].join(".");
}

/** Turn a Postgres / Node network error into an explanation and a fix. */
export function explainDbError(e: unknown): { detail: string; fix: string } {
  const err = e as { code?: string; message?: string };
  const code = err.code ?? "";
  const msg = (err.message ?? String(e)).replace(/postgres(ql)?:\/\/[^\s]+/g, "[connection string]");
  const m = msg.toLowerCase();

  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return {
      detail: "The database host name could not be found.",
      fix:
        "Check the host in DATABASE_URL. If you use Supabase and the host is db.xxxx.supabase.co, Vercel can't reach it " +
        "(that address is IPv6-only). In Supabase click Connect and copy the Transaction pooler string instead " +
        "(host like aws-0-ap-southeast-1.pooler.supabase.com, port 6543).",
    };
  if (code === "ECONNREFUSED")
    return {
      detail: "The connection was refused.",
      fix:
        "DATABASE_URL probably points to localhost or 127.0.0.1 — that's your own computer, which Vercel can't reach. " +
        "Use the connection string from Neon/Supabase.",
    };
  if (code === "ETIMEDOUT" || m.includes("timeout") || m.includes("timed out"))
    return {
      detail: "Connecting to the database timed out.",
      fix:
        "Check that the database allows connections from anywhere (Neon: Settings → IP Allow should be off; " +
        "Supabase: Database → Network restrictions should allow all IPs). Also check the port (Neon 5432, Supabase pooler 6543).",
    };
  if (code === "28P01" || m.includes("password authentication failed"))
    return {
      detail: "The database rejected the username or password.",
      fix:
        "Copy the connection string again from Neon/Supabase (resetting the password if needed) and paste it into DATABASE_URL. " +
        "If you typed the password yourself, special characters like @ # / ? must be URL-encoded (e.g. @ → %40).",
    };
  if (m.includes("tenant or user not found"))
    return {
      detail: "Supabase's pooler didn't recognise the user.",
      fix: "With the Supabase pooler the username must be postgres.<your-project-ref>, not just postgres. Copy the string from Supabase → Connect.",
    };
  if (code === "3D000")
    return { detail: "The database name in the connection string doesn't exist.", fix: "Copy the connection string again — the part after the last / is the database name (Neon: neondb, Supabase: postgres)." };
  if (m.includes("self-signed certificate") || m.includes("self signed certificate") || code === "SELF_SIGNED_CERT_IN_CHAIN" || m.includes("unable to verify"))
    return {
      detail: "The database's SSL certificate couldn't be verified (common with Supabase's pooler).",
      fix: "At the end of DATABASE_URL replace sslmode=require with sslmode=no-verify (the connection stays encrypted). Then redeploy.",
    };
  if (m.includes("ssl") || m.includes("encryption"))
    return { detail: "The database requires an encrypted (SSL) connection.", fix: "Add ?sslmode=require to the end of DATABASE_URL (or &sslmode=require if it already has a ?)." };
  if (m.includes("endpoint is disabled") || m.includes("compute time quota") || m.includes("project is suspended") || m.includes("exceeded"))
    return { detail: "The database provider has paused or suspended this database.", fix: "Open your Neon/Supabase dashboard — the free plan may have hit a limit or the project may be paused. Resume it." };
  if (m.includes("too many") && m.includes("connection"))
    return { detail: "The database has too many open connections.", fix: "Use the pooled connection string (Neon: host contains -pooler; Supabase: Transaction pooler, port 6543)." };
  if (code === "42P01")
    return {
      detail: "Connected, but the tables don't exist in this database.",
      fix: "Run npm run db:setup on your computer with DATABASE_URL in .env.local set to exactly the same connection string as on Vercel.",
    };
  if (code === "42703")
    return { detail: "Connected, but the tables are from an older version of the app.", fix: "Run npm run db:setup again (with the production DATABASE_URL) to upgrade them. It keeps your data." };
  return { detail: `Database error${code ? ` (${code})` : ""}: ${msg}`, fix: "Check DATABASE_URL, then redeploy. If it still fails, look at Vercel → Logs for the full error." };
}

export async function runHealthChecks(): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = [];

  // 1. Connection string present and well-formed
  const info = connectionInfo();
  if (!info) {
    checks.push({
      name: "Database connection string",
      ok: false,
      detail: `None of ${DB_ENV_VARS.join(", ")} is set in this deployment.`,
      fix:
        "In Vercel open Project → Settings → Environment Variables and add DATABASE_URL with your Neon/Supabase " +
        "connection string. Make sure Production is ticked. " + REDEPLOY,
    });
  } else {
    let url: URL | null = null;
    try {
      url = new URL(info.value);
    } catch {
      /* handled below */
    }
    if (!url || !/^postgres(ql)?:$/.test(url.protocol)) {
      checks.push({
        name: "Database connection string",
        ok: false,
        detail: `${info.name} is set but isn't a valid postgresql:// URL.`,
        fix:
          "Paste only the connection string itself — no quotes, no psql or DATABASE_URL= in front, no spaces or line breaks. " +
          "If the password has special characters (@ # / ?), copy the string from the provider instead of typing it. " + REDEPLOY,
      });
    } else {
      const host = url.hostname;
      const warnings: string[] = [];
      if (/^(localhost|127\.|0\.0\.0\.0|::1)/.test(host))
        warnings.push("It points to localhost — that's your own computer, which Vercel can't reach.");
      if (/^db\.[a-z0-9]+\.supabase\.co$/.test(host))
        warnings.push("This is Supabase's direct address (IPv6-only); Vercel needs the Transaction pooler string (…pooler.supabase.com:6543).");
      if (host.endsWith(".neon.tech") && !host.includes("-pooler"))
        warnings.push("Tip: use Neon's pooled connection string (host contains -pooler) for serverless hosting.");
      const bad = warnings.some((w) => !w.startsWith("Tip"));
      checks.push({
        name: "Database connection string",
        ok: !bad,
        warn: warnings.length > 0 && !bad,
        detail: `Using ${info.name} → ${maskHost(host)}${url.port ? ":" + url.port : ""}, database "${url.pathname.slice(1) || "?"}".` + (warnings.length ? " " + warnings.join(" ") : ""),
        fix: bad ? "Replace DATABASE_URL with the provider's connection string. " + REDEPLOY : undefined,
      });
    }
  }

  // 2. Admin password
  const pw = process.env.ADMIN_PASSWORD ?? "";
  checks.push(
    pw.length >= 8
      ? { name: "Staff password", ok: true, detail: "ADMIN_PASSWORD is set." }
      : {
          name: "Staff password",
          ok: false,
          detail: pw ? "ADMIN_PASSWORD is shorter than 8 characters." : "ADMIN_PASSWORD is not set, so /admin can't log in.",
          fix: "Add ADMIN_PASSWORD (8+ characters) in Vercel → Settings → Environment Variables. " + REDEPLOY,
        }
  );

  // 3. Connect, then check tables
  if (info && checks[0].ok) {
    try {
      const started = Date.now();
      await db().query("SELECT 1");
      checks.push({ name: "Connect to database", ok: true, detail: `Connected in ${Date.now() - started} ms.` });

      try {
        const { rows } = await db().query<{ courts: number; active: number }>(
          `SELECT count(*)::int AS courts, count(*) FILTER (WHERE is_active)::int AS active FROM courts`
        );
        // Touch the newest columns so an out-of-date schema is caught here, not on the first booking.
        await db().query(`SELECT hourly_rates, payment_methods FROM settings WHERE id = 1`);
        await db().query(`SELECT sport FROM courts LIMIT 1`);
        await db().query(`SELECT payment_status, amount FROM bookings LIMIT 1`);
        await db().query(`SELECT 1 FROM booking_slots LIMIT 1`);
        checks.push({
          name: "Tables",
          ok: rows[0].active > 0,
          warn: rows[0].active === 0,
          detail: `All tables are up to date. ${rows[0].active} bookable court(s) of ${rows[0].courts}.`,
          fix: rows[0].active === 0 ? "No courts are bookable — add or show courts in /admin → Courts." : undefined,
        });
      } catch (e) {
        const x = explainDbError(e);
        checks.push({ name: "Tables", ok: false, ...x });
      }
    } catch (e) {
      const x = explainDbError(e);
      checks.push({ name: "Connect to database", ok: false, ...x });
    }
  }

  // 4. Timezone
  const tz = process.env.FACILITY_TIMEZONE || "Asia/Manila";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    checks.push({ name: "Timezone", ok: true, detail: `${tz}${process.env.FACILITY_TIMEZONE ? "" : " (default)"}.` });
  } catch {
    checks.push({ name: "Timezone", ok: false, detail: `FACILITY_TIMEZONE "${tz}" isn't a valid timezone.`, fix: "Set it to Asia/Manila or remove it. " + REDEPLOY });
  }

  return { ok: checks.every((c) => c.ok), checks };
}
