import { createHash } from "node:crypto";
import { db, schema } from "@/lib/db";
import { isBot, normalizeCountry, parseUserAgent } from "@/lib/analytics/parse";
import {
  getClientIp,
  shouldDropForRateLimit,
} from "@/lib/analytics/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /c/[projectId] — analytics beacon endpoint.
//
// Called by the tracker snippet (lib/analytics/snippet.ts) injected at
// publish time. Always returns 204 — never errors, never blocks. A wrong
// body, an unknown projectId, a DB hiccup: all silently drop the event.
// Analytics that breaks navigation is worse than no analytics.
//
// Body shape (JSON):
//   { t: "v", r?: string, p?: string }                          -- pageview
//   { t: "c", h: string, l?: string, r?: string, p?: string }   -- outbound click
//
// `p` is the site-page slug baked into the snippet at publish time; absent
// or anything that isn't a valid slug stores as null (= home).
//
// Privacy contract:
//   - No IP stored. No cookies. No raw User-Agent.
//   - country = 2-letter ISO from CF-IPCountry (null when CF isn't in front).
//   - device + browser = coarse derivation from UA (mobile/desktop/tablet).
//   - uaHash = salted sha-256 of UA + accept-language, truncated to 12 chars
//     — gives stable "uniques per range" without being reversible.
// ─────────────────────────────────────────────────────────────────────────────

const UA_SALT = process.env.ANALYTICS_UA_SALT ?? "openlen-default-salt";
const MAX_HREF = 2000;
const MAX_LABEL = 80;
const MAX_REFERRER = 500;

// Same slug grammar as lib/projects/site-pages.ts — strict match, no
// normalization: a beacon body is untrusted input, not a user typing.
const PAGE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function parsePage(p: unknown): string | null {
  return typeof p === "string" && PAGE_SLUG_RE.test(p) ? p : null;
}

function truncateString(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const { projectId } = await params;

  // Project IDs are crypto.randomUUID() strings. A 64-char cap is generous
  // and stops obvious mischief (extremely long path segments).
  if (!projectId || projectId.length > 64) {
    return new Response(null, { status: 204 });
  }

  // Per-IP rate limit: silently drop events past 100/min per IP. Spam
  // floods get capped; legit creators with chatty visitors stay under it.
  // No 429 — same 204 as the success path so the snippet's beacon doesn't
  // surface anything to the user's page.
  if (shouldDropForRateLimit(getClientIp(req))) {
    return new Response(null, { status: 204 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  if (!body || typeof body !== "object") {
    return new Response(null, { status: 204 });
  }

  const data = body as {
    t?: unknown;
    h?: unknown;
    l?: unknown;
    r?: unknown;
    p?: unknown;
  };
  const type = data.t === "v" ? "view" : data.t === "c" ? "click" : null;
  if (!type) return new Response(null, { status: 204 });

  const ua = req.headers.get("user-agent") ?? "";
  // Drop bots / crawlers / link-preview fetchers before they inflate the
  // headline numbers. Same 204 as every other path — invisible to the page.
  if (isBot(ua)) return new Response(null, { status: 204 });
  const acceptLanguage = req.headers.get("accept-language") ?? "";
  const country = normalizeCountry(req.headers.get("cf-ipcountry"));
  const { device, browser } = parseUserAgent(ua);
  const uaHash = createHash("sha256")
    .update(UA_SALT + ua + acceptLanguage)
    .digest("hex")
    .slice(0, 12);

  try {
    await db.insert(schema.pageEvents).values({
      projectId,
      type,
      href: type === "click" ? truncateString(data.h, MAX_HREF) : null,
      linkLabel: type === "click" ? truncateString(data.l, MAX_LABEL) : null,
      referrer: truncateString(data.r, MAX_REFERRER),
      country,
      device,
      browser,
      uaHash,
      page: parsePage(data.p),
    });
  } catch {
    // FK violation (unknown projectId), DB hiccup, anything — silently drop.
    // The user's page navigation continues regardless.
  }

  return new Response(null, { status: 204 });
}
