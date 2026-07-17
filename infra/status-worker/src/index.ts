import { TARGETS, dayCells, incidentsFromFailures, nextState, uptimePct, type Incident, type Target, type TargetState } from "./logic";
import { runAllChecks } from "./checks";
import { sendAlert } from "./email";
import { pickLang, renderHtml, summaryJson, type PageData, type TargetView } from "./page";

export interface Env {
  DB: D1Database;
  CANARY_HOST: string;
  ALERT_FROM: string;
  ALERT_EMAIL: string;
  RESEND_API_KEY: string;
}

const RETENTION_MS = 90 * 86_400_000;
const DAYS = 90;

async function readState(db: D1Database, target: Target): Promise<TargetState | null> {
  const row = await db
    .prepare(`SELECT status, since, fails FROM state WHERE target = ?1`)
    .bind(target)
    .first<{ status: "up" | "down"; since: number; fails: number }>();
  return row ?? null;
}

async function gatherData(env: Env, now: number): Promise<PageData> {
  const dayAgg = await env.DB.prepare(
    `SELECT target, date(ts/1000, 'unixepoch') AS day, COUNT(*) AS total, SUM(1 - ok) AS failed
     FROM checks GROUP BY target, day`,
  ).all<{ target: Target; day: string; total: number; failed: number }>();

  const windows = await Promise.all(
    [now - 86_400_000, now - 7 * 86_400_000, now - 90 * 86_400_000].map((since) =>
      env.DB.prepare(
        `SELECT target, COUNT(*) AS total, SUM(ok) AS okc FROM checks WHERE ts >= ?1 GROUP BY target`,
      )
        .bind(since)
        .all<{ target: Target; total: number; okc: number }>(),
    ),
  );

  const failures = await env.DB.prepare(
    `SELECT ts, target FROM checks WHERE ok = 0 ORDER BY ts`,
  ).all<{ ts: number; target: Target }>();

  const lastLat = await env.DB.prepare(
    `SELECT target, latency_ms FROM checks WHERE rowid IN (SELECT MAX(rowid) FROM checks GROUP BY target)`,
  ).all<{ target: Target; latency_ms: number }>();

  const states = await env.DB.prepare(`SELECT target, status, since FROM state`).all<{
    target: Target;
    status: "up" | "down";
    since: number;
  }>();

  const winFor = (i: number, t: Target) => {
    const row = windows[i].results.find((r) => r.target === t);
    return row ? uptimePct(row.total, row.okc) : null;
  };

  const targets: TargetView[] = TARGETS.map((t) => {
    const st = states.results.find((r) => r.target === t);
    return {
      target: t,
      status: st?.status ?? "up",
      since: st?.since ?? now,
      lastLatencyMs: lastLat.results.find((r) => r.target === t)?.latency_ms ?? null,
      uptime: { d1: winFor(0, t), d7: winFor(1, t), d90: winFor(2, t) },
      days: dayCells(
        dayAgg.results.filter((r) => r.target === t),
        DAYS,
        now,
      ),
    };
  });

  const incidents: Incident[] = incidentsFromFailures(failures.results).slice(0, 20);
  return { generatedAt: now, targets, incidents };
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = Date.now();
    const results = await runAllChecks(env.CANARY_HOST);
    // Isolate target-level DB failures: one failure must not silence the others' state transitions
    for (const r of results) {
      try {
        await env.DB.prepare(
          `INSERT INTO checks (ts, target, ok, status, latency_ms) VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
          .bind(now, r.target, r.ok ? 1 : 0, r.status, r.latencyMs)
          .run();

        const prev = await readState(env.DB, r.target);
        const { state, transition } = nextState(prev, r.ok, now);
        await env.DB.prepare(
          `INSERT INTO state (target, status, since, fails) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(target) DO UPDATE SET status = excluded.status, since = excluded.since, fails = excluded.fails`,
        )
          .bind(r.target, state.status, state.since, state.fails)
          .run();

        if (transition) {
          const downSince = transition === "recovered" ? (prev?.since ?? now) : now;
          ctx.waitUntil(sendAlert(transition, r.target, env, now, downSince));
        }
      } catch (err) {
        console.error("check persist failed", r.target, err);
      }
    }
    try {
      await env.DB.prepare(`DELETE FROM checks WHERE ts < ?1`).bind(now - RETENTION_MS).run();
    } catch (err) {
      console.error("retention prune failed", err);
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.hostname !== "status.openlen.com") return new Response("Not found", { status: 404 });
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n", {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
      });
    }
    const now = Date.now();
    if (url.pathname === "/api/summary") {
      const data = await gatherData(env, now);
      return new Response(summaryJson(data), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=60",
          "access-control-allow-origin": "https://openlen.com",
        },
      });
    }
    if (url.pathname === "/") {
      const data = await gatherData(env, now);
      const lang = pickLang(req.headers.get("accept-language"));
      return new Response(renderHtml(data, lang), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=60",
          // The body varies by Accept-Language; without this a shared cache
          // could serve the ES render to an EN client.
          vary: "accept-language",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
