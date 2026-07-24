// ─────────────────────────────────────────────────────────────────────────────
// Flight Check — post-publish Lighthouse lab measurement (Born-100 F4).
//
// The publish pipeline now bakes Tailwind, responsive images, self-hosted
// fonts and a hash-locked CSP — but until this module, OpenLen asserted
// performance it never measured (and a silently-degraded bake was
// invisible). After every symlink flip, publishProject fires this check:
//
//   1. Serve the EXACT release artifact (releases/<sha>/index.html + the
//      shared assets dir) from an ephemeral 127.0.0.1 server — same layout
//      Caddy serves, no DNS/CDN variance, works in dev and prod.
//   2. Run real Lighthouse (mobile form factor, simulated Slow-4G
//      throttling — fixed, so scores are comparable across releases)
//      through the SAME Puppeteer page the SSRF guard protects.
//   3. Persist category scores + Core Web Vitals + page weight to the
//      flightReports table, one row per (project, release sha) — the
//      publish modal's Speed Card polls it.
//
// Honesty note: this is LAB data. The local server sends no
// brotli/zstd (Caddy does), so byte counts read slightly HIGH and scores
// slightly LOW versus the live page — we under-promise, never over-claim.
//
// Posture mirrors lib/projects/thumbnail.ts: fire-and-forget, soft-fail,
// one audit at a time on the small box (each LH run is a Chrome + ~20-40s
// of CPU), watchdog against wedged Chrome, launch-class failures reported
// to InariWatch. A publish is never blocked or delayed.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { captureException } from "@inariwatch/capture";
import { db, schema } from "@/lib/db";
import { getPublishRoot } from "@/lib/publish/filesystem";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";

const HARD_DEADLINE_MS = 120_000;
const MAX_CONCURRENT = Math.max(
  1,
  Number(process.env.OPENLEN_FLIGHT_CONCURRENCY) || 1,
);
let active = 0;
const waiters: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

// ─── Lighthouse result extraction (pure) ────────────────────────────────────

/** Minimal structural view of a Lighthouse LHR — keeps this module (and its
 *  tests) decoupled from lighthouse's own types. */
export interface LhrLike {
  categories: Record<string, { score: number | null } | undefined>;
  audits: Record<
    string,
    | {
        score: number | null;
        numericValue?: number;
        title?: string;
        details?: { type?: string; overallSavingsMs?: number; items?: unknown[] };
      }
    | undefined
  >;
}

export interface FlightSummary {
  perfScore: number | null;
  a11yScore: number | null;
  bpScore: number | null;
  seoScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  speedIndexMs: number | null;
  totalBytes: number | null;
  requestCount: number | null;
  opportunities: Array<{ id: string; title: string; savingsMs: number | null }>;
}

function categoryScore(lhr: LhrLike, id: string): number | null {
  const score = lhr.categories[id]?.score;
  return typeof score === "number" ? Math.round(score * 100) : null;
}

function auditValue(lhr: LhrLike, id: string): number | null {
  const v = lhr.audits[id]?.numericValue;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function rounded(v: number | null): number | null {
  return v === null ? null : Math.round(v);
}

export function extractFlightSummary(lhr: LhrLike): FlightSummary {
  const requests = lhr.audits["network-requests"]?.details?.items;
  const opportunities = Object.entries(lhr.audits)
    .filter(([, a]) => {
      return (
        a?.details?.type === "opportunity" &&
        typeof a.score === "number" &&
        a.score < 0.9
      );
    })
    .map(([id, a]) => ({
      id,
      title: a?.title ?? id,
      savingsMs:
        typeof a?.details?.overallSavingsMs === "number"
          ? Math.round(a.details.overallSavingsMs)
          : null,
    }))
    .sort((x, y) => (y.savingsMs ?? 0) - (x.savingsMs ?? 0))
    .slice(0, 5);

  return {
    perfScore: categoryScore(lhr, "performance"),
    a11yScore: categoryScore(lhr, "accessibility"),
    bpScore: categoryScore(lhr, "best-practices"),
    seoScore: categoryScore(lhr, "seo"),
    lcpMs: rounded(auditValue(lhr, "largest-contentful-paint")),
    // CLS is unitless and small — keep 3 decimals, not a round.
    cls: ((): number | null => {
      const v = auditValue(lhr, "cumulative-layout-shift");
      return v === null ? null : Math.round(v * 1000) / 1000;
    })(),
    tbtMs: rounded(auditValue(lhr, "total-blocking-time")),
    fcpMs: rounded(auditValue(lhr, "first-contentful-paint")),
    speedIndexMs: rounded(auditValue(lhr, "speed-index")),
    totalBytes: rounded(auditValue(lhr, "total-byte-weight")),
    requestCount: Array.isArray(requests) ? requests.length : null,
    opportunities,
  };
}

// ─── Ephemeral release server ───────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/** Serve one release + the subdomain's shared assets dir on a random
 *  loopback port — the same two roots Caddy maps in production. */
async function serveRelease(
  subDir: string,
  releaseSha: string,
): Promise<{ server: Server; port: number }> {
  const releaseDir = path.join(subDir, "releases", releaseSha);
  const assetsDir = path.join(subDir, "assets");

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const pathname = new URL(req.url ?? "/", "http://flight.local").pathname;
      let file: string | null = null;
      if (pathname === "/" || pathname === "/index.html") {
        file = path.join(releaseDir, "index.html");
      } else if (pathname.startsWith("/assets/")) {
        const name = decodeURIComponent(pathname.slice("/assets/".length));
        if (/^[A-Za-z0-9._-]+$/.test(name) && !name.includes("..")) {
          file = path.join(assetsDir, name);
        }
      }
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      const bytes = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  };

  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("flight server failed to bind a port");
  }
  return { server, port: address.port };
}

// ─── Audit runner ───────────────────────────────────────────────────────────

async function runLighthouse(url: string, allowOrigin: string): Promise<LhrLike | null> {
  // Dynamic imports keep puppeteer/lighthouse out of the static module
  // graph of every route that touches lib/projects.ts (both are in
  // serverExternalPackages — same contract as the thumbnail renderer).
  const { default: puppeteer } = await import("puppeteer");
  const { default: lighthouse } = await import("lighthouse");

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
  // HOME=/tmp on the box: ProtectHome makes $HOME read-only for the service
  // (memory: puppeteer-hetzner-chrome). Leave dev machines alone.
  const launchEnv =
    process.platform === "linux" ? { ...process.env, HOME: "/tmp" } : process.env;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    env: launchEnv,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-crash-reporter",
    ],
  });
  const watchdog = setTimeout(() => {
    void browser.close().catch(() => {});
  }, HARD_DEADLINE_MS);
  try {
    const page = await browser.newPage();
    // The page under audit is user-controlled HTML — block subresource
    // fetches to loopback/private/metadata hosts, same as every other
    // render of user content. Only our own ephemeral server's exact
    // origin is allowed through. Lighthouse drives this exact page.
    await installSubresourceSsrfGuard(page, { allowOrigins: [allowOrigin] });
    const result = await lighthouse(
      url,
      {
        output: "json",
        logLevel: "error",
        // Mobile is the Lighthouse default config (Moto-G-class CPU slow-
        // down + simulated Slow-4G). Fixed settings = comparable scores.
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      },
      undefined,
      page,
    );
    return (result?.lhr as unknown as LhrLike) ?? null;
  } finally {
    clearTimeout(watchdog);
    await browser.close().catch(() => {});
  }
}

/** Serve + audit one release without touching the DB — the testable core.
 *  Returns null when Lighthouse produced no result. */
export async function measureRelease(
  subDir: string,
  releaseSha: string,
): Promise<FlightSummary | null> {
  const { server, port } = await serveRelease(subDir, releaseSha);
  try {
    const lhr = await runLighthouse(`http://127.0.0.1:${port}/`, `127.0.0.1:${port}`);
    return lhr ? extractFlightSummary(lhr) : null;
  } finally {
    server.close();
  }
}

export interface FlightCheckParams {
  projectId: string;
  /** Validated subdomain (publishProject passes the post-validate value). */
  subdomain: string;
  releaseSha: string;
}

/** Measure a just-published release and persist the report. Never throws —
 *  callers fire-and-forget. Idempotent per (project, release sha). */
export async function runFlightCheck(params: FlightCheckParams): Promise<void> {
  if (process.env.OPENLEN_FLIGHT_CHECK === "0") return;
  try {
    await withSlot(() => doFlightCheck(params));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[flight-check] audit failed for ${params.subdomain}@${params.releaseSha}`, err);
    const msg = err instanceof Error ? err.message : String(err);
    if (/Failed to launch|spawn|ENOENT|executablePath|Target closed|out of memory/i.test(msg)) {
      captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: "flight-check", projectId: params.projectId },
      });
    }
  }
}

async function doFlightCheck(params: FlightCheckParams): Promise<void> {
  const { projectId, subdomain, releaseSha } = params;
  if (!/^[a-f0-9]{1,64}$/.test(releaseSha)) return;

  // Same content re-published → same sha → the existing report stands.
  const existing = await db
    .select({ id: schema.flightReports.id })
    .from(schema.flightReports)
    .where(
      and(
        eq(schema.flightReports.projectId, projectId),
        eq(schema.flightReports.releaseSha, releaseSha),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;

  const subDir = path.join(getPublishRoot(), subdomain);
  await stat(path.join(subDir, "releases", releaseSha, "index.html"));

  const s = await measureRelease(subDir, releaseSha);
  if (!s) return;
  try {
    await db
      .insert(schema.flightReports)
      .values({
        projectId,
        subdomain,
        releaseSha,
        perfScore: s.perfScore,
        a11yScore: s.a11yScore,
        bpScore: s.bpScore,
        seoScore: s.seoScore,
        lcpMs: s.lcpMs,
        cls: s.cls,
        tbtMs: s.tbtMs,
        fcpMs: s.fcpMs,
        speedIndexMs: s.speedIndexMs,
        totalBytes: s.totalBytes,
        requestCount: s.requestCount,
        details: { opportunities: s.opportunities },
      })
      .onConflictDoNothing();
  } catch (err) {
    // El proyecto se borró mientras corría la auditoría (fire-and-forget):
    // la FK ya no resuelve. Secuencia normal de usuario, no un fallo.
    if (!isForeignKeyViolation(err)) throw err;
  }
}

/** SQLSTATE 23503 — foreign_key_violation. node-postgres lo expone en
 *  err.code; err.cause cubre el wrapper de drizzle. */
export function isForeignKeyViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === "23503" || e.cause?.code === "23503";
}
