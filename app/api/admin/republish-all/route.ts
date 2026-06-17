import { and, isNotNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/admin-only";
import { db, schema } from "@/lib/db";
import { publishProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/republish-all — re-run the full publish pipeline for every
// live project so a publish-time change (e.g. the URL tracking-param cleaner
// baked in bakeDocument) lands on already-published sites without each owner
// re-deploying. Semantics = pressing Deploy on every published project:
// re-bakes from data.html, re-seals (so new inline scripts enter the CSP),
// re-localizes (per-string cache hit ⇒ ≈0 cost for unchanged copy), and flips
// the live release. Idempotent (injectTrackingStrip is marker-gated; createVersion
// dedups) + per-project soft-fail. Runs in-app on the box (where /var/www + the
// Rust crates + the upload dir live).
//
// The sweep is DETACHED: a catalog-wide loop trivially exceeds the 90s Caddy/
// nginx proxy timeout, which would 504 the admin and discard the per-project
// results. So POST kicks the loop off in the background and returns 202 at once;
// poll GET for live progress + the final per-project outcome. A module-level
// single-flight guard rejects a concurrent invocation with 409 so a retry can't
// launch a second sweep over the same projects. Flight checks are skipped
// (skipFlightCheck) so the bulk run doesn't queue N Chrome audits on the box.

interface SweepRun {
  startedAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  ok: number;
  failed: number;
  failures: Array<{ subdomain: string; error: string }>;
}

let sweepRunning = false;
let lastRun: SweepRun | null = null;

async function runSweep(
  rows: Array<{ id: string; userId: string; subdomain: string }>,
  run: SweepRun,
): Promise<void> {
  for (const row of rows) {
    try {
      await publishProject({
        projectId: row.id,
        userId: row.userId,
        subdomain: row.subdomain,
        skipFlightCheck: true,
      });
      run.ok += 1;
      // eslint-disable-next-line no-console
      console.log(`[republish-all] ✓ ${row.subdomain}`);
    } catch (err) {
      run.failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      run.failures.push({ subdomain: row.subdomain, error: msg });
      // eslint-disable-next-line no-console
      console.error(`[republish-all] ✗ ${row.subdomain}: ${msg}`);
    } finally {
      run.done += 1;
    }
  }
  run.finishedAt = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(
    `[republish-all] done: ${run.ok} ok, ${run.failed} failed of ${run.total}`,
  );
}

export async function POST(): Promise<Response> {
  const guard = await requireAdmin();
  if (guard instanceof Response) return guard;

  if (sweepRunning) {
    return new Response(
      JSON.stringify({ error: "already_running", lastRun }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  const rows = await db
    .select({
      id: schema.projects.id,
      userId: schema.projects.userId,
      subdomain: schema.projects.subdomain,
    })
    .from(schema.projects)
    .where(
      and(
        isNotNull(schema.projects.subdomain),
        isNotNull(schema.projects.publishedAt),
      ),
    );

  const targets = rows.filter(
    (r): r is { id: string; userId: string; subdomain: string } =>
      r.subdomain !== null,
  );

  const run: SweepRun = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: targets.length,
    done: 0,
    ok: 0,
    failed: 0,
    failures: [],
  };
  sweepRunning = true;
  lastRun = run;

  // Detached: run past the response so the proxy never times the request out.
  // The standalone Node server stays alive, so the loop drains in-process.
  void runSweep(targets, run).finally(() => {
    sweepRunning = false;
  });

  return new Response(
    JSON.stringify({ started: true, total: run.total }),
    { status: 202, headers: { "Content-Type": "application/json" } },
  );
}

// GET /api/admin/republish-all — poll the sweep: { running, lastRun }. lastRun
// holds the final per-project outcome once running flips false (in-process,
// resets on restart — a progress signal for a one-shot, not durable history).
export async function GET(): Promise<Response> {
  const guard = await requireAdmin();
  if (guard instanceof Response) return guard;

  return new Response(
    JSON.stringify({ running: sweepRunning, lastRun }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
