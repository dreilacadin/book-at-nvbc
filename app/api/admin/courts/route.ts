import { NextRequest, NextResponse } from "next/server";
import { isAdmin, unauthorized } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { readJson, serverError } from "@/lib/http";
import { isSport, sportLabel } from "@/lib/sports";
import { nowAtFacility } from "@/lib/time";

export const dynamic = "force-dynamic";

const MAX_COURTS_PER_SPORT = 30;

async function listCourts() {
  const { rows } = await db().query(
    `SELECT c.id, c.name, c.sport, c.is_active, c.sort_order,
            (SELECT count(*)::int FROM bookings b
              WHERE b.court_id = c.id AND b.status = 'confirmed' AND b.booking_date >= $1) AS upcoming
       FROM courts c ORDER BY c.sort_order, c.id`,
    [nowAtFacility().date]
  );
  return rows;
}

async function upcomingOn(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rows } = await db().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bookings
      WHERE status = 'confirmed' AND booking_date >= $1 AND court_id = ANY($2::int[])`,
    [nowAtFacility().date, `{${ids.join(",")}}`]
  );
  return rows[0].n;
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  try {
    return NextResponse.json({ courts: await listCourts() });
  } catch (e) {
    return serverError(e);
  }
}

/**
 * { action: "set_count", sport, count }  — show/hide/create courts so exactly `count` are bookable
 * { action: "add", name, sport }
 * { action: "update", id, name?, sport?, is_active?, sort_order? }
 */
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    if (name !== undefined && (name.length < 1 || name.length > 40))
      return bad("Court name must be 1–40 characters.");
    if (body.sport !== undefined && !isSport(body.sport)) return bad("Unknown sport.");
    let warning = "";

    if (body.action === "set_count") {
      const sport = body.sport;
      const count = Number(body.count);
      if (!isSport(sport)) return bad("Choose a sport.");
      if (!Number.isInteger(count) || count < 0 || count > MAX_COURTS_PER_SPORT)
        return bad(`Number of courts must be 0–${MAX_COURTS_PER_SPORT}.`);

      const client = await db().connect();
      try {
        await client.query("BEGIN");
        // Lock this sport's courts so two admins changing counts at once can't collide.
        const { rows } = await client.query<{ id: number; is_active: boolean }>(
          `SELECT id, is_active FROM courts WHERE sport = $1 ORDER BY sort_order, id FOR UPDATE`,
          [sport]
        );
        const active = rows.filter((r) => r.is_active);
        const hidden = rows.filter((r) => !r.is_active);
        let hiddenNow: number[] = [];

        if (count > active.length) {
          let need = count - active.length;
          // Bring back hidden courts first (keeps their names and history)...
          const revive = hidden.slice(0, need).map((r) => r.id);
          if (revive.length)
            await client.query(`UPDATE courts SET is_active = TRUE WHERE id = ANY($1::int[])`, [
              `{${revive.join(",")}}`,
            ]);
          need -= revive.length;
          // ...then create new ones.
          for (let i = 0; i < need; i++) {
            await client.query(
              `INSERT INTO courts (name, sport, sort_order)
               VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) FROM courts), 0) + 1)`,
              [`${sportLabel(sport)} Court ${rows.length + i + 1}`, sport]
            );
          }
        } else if (count < active.length) {
          // Hide the last courts in display order.
          hiddenNow = active.slice(count).map((r) => r.id);
          await client.query(`UPDATE courts SET is_active = FALSE WHERE id = ANY($1::int[])`, [
            `{${hiddenNow.join(",")}}`,
          ]);
        }
        await client.query("COMMIT");
        const n = await upcomingOn(hiddenNow);
        if (n)
          warning = `${n} upcoming booking(s) are on the courts you just hid. They are kept — check the Bookings tab and contact those players or show the court again.`;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } else if (body.action === "add") {
      if (!name) return bad("Enter a court name.");
      if (!isSport(body.sport)) return bad("Choose a sport.");
      await db().query(
        `INSERT INTO courts (name, sport, sort_order)
         VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) FROM courts), 0) + 1)`,
        [name, body.sport]
      );
    } else if (body.action === "update") {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return bad("Invalid court.");
      const sortOrder = body.sort_order === undefined ? null : Number(body.sort_order);
      if (sortOrder !== null && !Number.isInteger(sortOrder)) return bad("Order must be a whole number.");
      const { rows } = await db().query<{ sport: string }>(`SELECT sport FROM courts WHERE id = $1`, [id]);
      if (!rows[0]) return bad("Court not found.");
      await db().query(
        `UPDATE courts SET
           name       = COALESCE($2, name),
           is_active  = COALESCE($3, is_active),
           sort_order = COALESCE($4, sort_order),
           sport      = COALESCE($5, sport)
         WHERE id = $1`,
        [
          id,
          name ?? null,
          typeof body.is_active === "boolean" ? body.is_active : null,
          sortOrder,
          isSport(body.sport) ? body.sport : null,
        ]
      );
      const n = await upcomingOn([id]);
      if (n && body.is_active === false)
        warning = `This court has ${n} upcoming booking(s). They are kept — check the Bookings tab.`;
      if (n && isSport(body.sport) && body.sport !== rows[0].sport)
        warning = `This court has ${n} upcoming booking(s) made for ${sportLabel(rows[0].sport)}. They now show under ${sportLabel(body.sport)} — check the Bookings tab.`;
    } else {
      return bad("Unknown action");
    }
    return NextResponse.json({ courts: await listCourts(), warning });
  } catch (e) {
    return serverError(e);
  }
}
