// TypeScript A/B Edge resolver with bit-for-bit parity against Rust
// `crates/edge/src/ab/` (Plan 3).
//
// Used by:
// - `app/served/[host]/[[...path]]/route.ts` (verified custom domains behind Caddy)
// - `lib/publish/serve-release.ts` (local dev / release verification without Rust binary)
//
// Hash contract (identical to `crates/edge/src/ab/assign.rs`):
//   SHA-256(`${salt}:${expId}:${clientIp}:${ua}:${acceptLang}`)
//   bucket = digest.readUInt32BE(0) % 10_000   (first 4 bytes, big-endian)
//   variant = bucket < splitBps ? "b" : "a"

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { AbManifest, AbManifestExperiment, AbVariant } from "./types";

export const AB_HTML_CACHE_CONTROL = "private, no-store";

/** Where a release keeps its experiment manifest. `openlen/` is a reserved root of the
 *  folder (lib/agent/ficheros/folder.ts), so no file of the owner can sit there. */
export const AB_MANIFEST_REL = "openlen/ab.json";

const EXP_ID_RE = /^[a-z0-9][a-z0-9_-]{3,39}$/;
const COOKIE_NAME_RE = /^[A-Za-z0-9_-]{4,64}$/;
const LOCALE_RE = /^[a-z]{2}(?:-[a-z0-9]{2,4})?$/;
const MAX_MANIFEST_BYTES = 64 * 1024;

// Synchronized with `crates/edge/src/ab/bot.rs` and `lib/analytics/parse.ts`.
const EDGE_BOT_RE =
  /bot\/|spider|crawler|slurp|mediapartners|googlebot|bingbot|applebot|yandexbot|duckduckbot|baiduspider|gptbot|claudebot|perplexitybot|oai-searchbot|facebookexternalhit|whatsapp\/|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|redditbot|pinterest\/|embedly|skypeuripreview|vkshare|tumblr\/|bitlybot|nuzzel|w3c_validator|semrush|ahrefs|mj12bot|dotbot|dataforseo|screaming frog|headless|phantomjs|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|site24x7|datadog|newrelic|curl\/|wget\/|python-requests|python-urllib|aiohttp|httpx|axios\/|go-http-client|java\/|okhttp|node-fetch|scrapy|httpclient|libwww|mechanize|guzzle|postman|insomnia/i;

export type AbAssignSource = "cookie" | "hash" | "bot" | "override";

export interface AbServeDecision {
  readonly experimentId: string;
  readonly variant: AbVariant;
  readonly source: AbAssignSource;
  readonly variantBPath: string | null;
  readonly setCookie: string | null;
  readonly isOverride: boolean;
  readonly isPageRoute: boolean;
}

export function isEdgeBot(ua: string): boolean {
  const trimmed = ua.trim();
  if (!trimmed) return true;
  return EDGE_BOT_RE.test(trimmed);
}

/** The segments of the path a file resolver would walk: percent-decoded once, `\` as a separator,
 *  empty and `.` segments dropped, `..` popping its parent, a NUL cutting its segment, lower-cased
 *  (the filesystem may not care about case). Mirrors Rust `resolved_segments`. */
function resolvedSegments(urlPath: string): string[] {
  let decoded = urlPath;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    // A malformed sequence is judged as written: it cannot name a file either.
  }
  const out: string[] = [];
  for (const raw of decoded.split(/[/\\]/)) {
    const seg = raw.split("\0")[0] ?? "";
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(asciiLower(seg));
  }
  return out;
}

/** Lower-case ASCII only (the same on both sides of the Rust/TS parity). */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/** True if `urlPath` addresses the experiment's own files once it is RESOLVED (decoded, dot
 *  segments removed, trailing and doubled slashes gone): `/openlen/ab.json`, `/openlen/ab` or
 *  anything under `/openlen/ab/`. Other files of the reserved `openlen/` root (e.g. the bubble's
 *  `figure-<sha>.js`) are served as usual. Mirrors Rust `is_blocked_internal_path`. */
export function isBlockedInternalAbPath(urlPath: string): boolean {
  const segs = resolvedSegments(urlPath);
  return segs.length >= 2 && segs[0] === "openlen" && (segs[1] === "ab.json" || segs[1] === "ab");
}

/** Second lock, on the RESOLVED file: true when `file` is `<releaseDir>/openlen/ab.json` or lives
 *  under `<releaseDir>/openlen/ab/`. Whatever the URL looked like, a visitor's request must never
 *  end up reading those; Variant B's own tree is read through the A/B routing, not this door. */
export function isInternalAbFile(releaseDir: string, file: string): boolean {
  const rel = path.relative(path.resolve(releaseDir), path.resolve(file));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const [first, second] = rel.split(path.sep);
  return (
    asciiLower(first ?? "") === "openlen" &&
    (asciiLower(second ?? "") === "ab.json" || asciiLower(second ?? "") === "ab")
  );
}

export function normalizeMatchPath(raw: string): string {
  const trimmed = raw.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  let collapsed = withSlash;
  if (withSlash === "/index.html") {
    collapsed = "/";
  } else if (withSlash.endsWith("/index.html")) {
    const prefix = withSlash.slice(0, -"/index.html".length);
    collapsed = prefix || "/";
  }
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

function isSafePrefix(prefix: string): boolean {
  if (!prefix || prefix.startsWith("/") || prefix.endsWith("/")) return false;
  if (prefix.includes("\\") || prefix.includes("\0")) return false;
  const parts = prefix.split("/");
  // openlen/ab/<id>/…: the reserved root, ab and at least one more segment.
  if (parts.length < 3 || parts[0] !== "openlen" || parts[1] !== "ab") return false;
  return parts.every((seg) => seg.length > 0 && seg !== "." && seg !== "..");
}

export function parseAbManifest(raw: string | Buffer): AbManifest | null {
  let doc: unknown;
  try {
    doc = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const obj = doc as Record<string, unknown>;
  if (obj.version !== 1 || !Array.isArray(obj.experiments)) return null;

  const experiments: AbManifestExperiment[] = [];
  for (const item of obj.experiments) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== "string" || !EXP_ID_RE.test(e.id)) continue;
    if (typeof e.cookieName !== "string" || !COOKIE_NAME_RE.test(e.cookieName)) continue;
    if (typeof e.targetPath !== "string") continue;
    if (
      typeof e.splitBps !== "number" ||
      !Number.isInteger(e.splitBps) ||
      e.splitBps < 0 ||
      e.splitBps > 10_000
    ) {
      continue;
    }
    if (typeof e.salt !== "string" || e.salt.length === 0 || e.salt.length > 128) continue;
    if (typeof e.prefixB !== "string" || !isSafePrefix(e.prefixB)) continue;
    const overrideParam =
      typeof e.overrideParam === "string" && COOKIE_NAME_RE.test(e.overrideParam)
        ? e.overrideParam
        : "_ol_ab";
    const locales = Array.isArray(e.locales)
      ? e.locales
          .filter((l): l is string => typeof l === "string")
          .map((l) => l.toLowerCase())
          .filter((l) => LOCALE_RE.test(l))
      : [];
    experiments.push({
      id: e.id,
      cookieName: e.cookieName,
      targetPath: normalizeMatchPath(e.targetPath),
      includeLocales: e.includeLocales === true,
      locales,
      splitBps: e.splitBps,
      salt: e.salt,
      prefixB: e.prefixB,
      overrideParam,
      expiresAt: typeof e.expiresAt === "string" ? e.expiresAt : null,
    });
  }

  if (experiments.length === 0) return null;
  return {
    version: 1,
    releaseSha: typeof obj.releaseSha === "string" ? obj.releaseSha : "",
    experiments,
  };
}

/** Bucket (0..9_999) of a visitor, identical to Rust `hash_bucket`. */
export function hashBucket(
  salt: string,
  expId: string,
  clientIp: string,
  userAgent: string,
  acceptLanguage: string,
): number {
  const digest = createHash("sha256")
    .update(`${salt}:${expId}:${clientIp}:${userAgent}:${acceptLanguage}`, "utf8")
    .digest();
  // u32, not u16: 65_536 is not a multiple of 10_000, so a u16 would favour buckets 0..5_535 and
  // send 53.4 % of a 50/50 to B (the bias of a u32 is 2e-6). readUInt32BE is unsigned.
  return digest.readUInt32BE(0) % 10_000;
}

export function hashVariant(
  salt: string,
  expId: string,
  clientIp: string,
  userAgent: string,
  acceptLanguage: string,
  splitBps: number,
): AbVariant {
  if (splitBps <= 0) return "a";
  if (splitBps >= 10_000) return "b";
  return hashBucket(salt, expId, clientIp, userAgent, acceptLanguage) < splitBps ? "b" : "a";
}

function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return part.slice(idx + 1).trim();
    }
  }
  return null;
}

function isExpired(exp: AbManifestExperiment, nowMs: number): boolean {
  if (!exp.expiresAt) return false;
  const ts = Date.parse(exp.expiresAt);
  return !Number.isFinite(ts) || nowMs >= ts;
}

function pathHasNonHtmlExtension(urlPath: string): boolean {
  const trimmed = urlPath.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return false;
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = last.slice(dot + 1).toLowerCase();
  return ext !== "html" && ext !== "htm";
}

function matchesExperimentPage(exp: AbManifestExperiment, normalized: string): boolean {
  if (normalized === exp.targetPath) return true;
  if (exp.includeLocales && exp.targetPath === "/") {
    const seg = normalized.replace(/^\/+/, "");
    if (!seg.includes("/") && exp.locales.includes(seg)) return true;
  }
  return false;
}

function buildVariantBPath(prefixB: string, urlPath: string): string {
  const rel = urlPath.replace(/^\/+/, "");
  return rel ? `/${prefixB}/${rel}` : `/${prefixB}/index.html`;
}

export function evaluateAbManifest(
  manifest: AbManifest,
  req: {
    readonly urlPath: string;
    readonly searchParams?: URLSearchParams | null;
    readonly cookieHeader?: string | null;
    readonly userAgent?: string | null;
    readonly acceptLanguage?: string | null;
    readonly clientIp?: string | null;
    readonly secureCookie?: boolean;
    readonly nowMs?: number;
  },
): AbServeDecision | null {
  const nowMs = req.nowMs ?? Date.now();
  const isAsset = pathHasNonHtmlExtension(req.urlPath);

  if (isAsset) {
    for (const exp of manifest.experiments) {
      if (isExpired(exp, nowMs)) continue;
      const ov = req.searchParams?.get(exp.overrideParam)?.toLowerCase() ?? null;
      const cv = readCookie(req.cookieHeader, exp.cookieName)?.toLowerCase() ?? null;
      if (ov === "b" || (ov === null && cv === "b")) {
        return {
          experimentId: exp.id,
          variant: "b",
          source: ov ? "override" : "cookie",
          variantBPath: buildVariantBPath(exp.prefixB, req.urlPath),
          setCookie: null,
          isOverride: ov !== null,
          isPageRoute: false,
        };
      }
    }
    return null;
  }

  const normalized = normalizeMatchPath(req.urlPath);
  const exp = manifest.experiments.find(
    (e) => !isExpired(e, nowMs) && matchesExperimentPage(e, normalized),
  );
  if (!exp) return null;

  const ov = req.searchParams?.get(exp.overrideParam)?.toLowerCase() ?? null;
  if (ov === "a" || ov === "b") {
    return {
      experimentId: exp.id,
      variant: ov,
      source: "override",
      variantBPath: ov === "b" ? buildVariantBPath(exp.prefixB, normalized) : null,
      setCookie: null,
      isOverride: true,
      isPageRoute: true,
    };
  }

  const ua = req.userAgent ?? "";
  if (isEdgeBot(ua)) {
    return {
      experimentId: exp.id,
      variant: "a",
      source: "bot",
      variantBPath: null,
      setCookie: null,
      isOverride: false,
      isPageRoute: true,
    };
  }

  const cv = readCookie(req.cookieHeader, exp.cookieName)?.toLowerCase() ?? null;
  if (cv === "a" || cv === "b") {
    return {
      experimentId: exp.id,
      variant: cv,
      source: "cookie",
      variantBPath: cv === "b" ? buildVariantBPath(exp.prefixB, normalized) : null,
      setCookie: null,
      isOverride: false,
      isPageRoute: true,
    };
  }

  const variant = hashVariant(
    exp.salt,
    exp.id,
    req.clientIp ?? "unknown",
    ua,
    req.acceptLanguage ?? "",
    exp.splitBps,
  );
  const secureAttr = req.secureCookie !== false ? "; Secure" : "";
  return {
    experimentId: exp.id,
    variant,
    source: "hash",
    variantBPath: variant === "b" ? buildVariantBPath(exp.prefixB, normalized) : null,
    setCookie: `${exp.cookieName}=${variant}; Path=/; Max-Age=2592000; SameSite=Lax${secureAttr}`,
    isOverride: false,
    isPageRoute: true,
  };
}

/** Read and validate `<releaseDir>/openlen/ab.json`, returning null if missing or invalid. */
export async function readReleaseAbManifest(releaseDir: string): Promise<AbManifest | null> {
  const filePath = path.join(releaseDir, AB_MANIFEST_REL);
  try {
    const s = await stat(filePath);
    if (!s.isFile() || s.size > MAX_MANIFEST_BYTES) return null;
    const raw = await readFile(filePath, "utf8");
    return parseAbManifest(raw);
  } catch {
    return null;
  }
}

/** Resolve Variant B file strictly inside `releaseDir` (no SPA fallback to Control A). */
export async function resolveVariantBFile(
  releaseDir: string,
  variantBPath: string,
  isPageRoute: boolean,
): Promise<string | null> {
  const normRoot = path.normalize(releaseDir) + path.sep;
  const rel = variantBPath.replace(/^\/+/, "");
  // A dot segment would walk out of the B tree (into the control files, or out of the release).
  if (rel.split("/").some((seg) => seg === "." || seg === "..")) return null;
  const candidates = [path.join(releaseDir, rel)];
  if (isPageRoute && !rel.endsWith(".html") && !rel.endsWith(".htm")) {
    candidates.push(path.join(releaseDir, rel, "index.html"));
  }
  for (const candidate of candidates) {
    const norm = path.normalize(candidate);
    if (!norm.startsWith(normRoot)) continue;
    try {
      const s = await stat(norm);
      if (s.isFile()) return norm;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Build the A/B response headers matching Rust `crates/edge/src/server.rs`. */
export function abResponseHeaders(
  decision: AbServeDecision,
  bodyLength: number,
): Record<string, string> {
  const out: Record<string, string> = {
    "Cache-Control": AB_HTML_CACHE_CONTROL,
    Vary: "Cookie",
    "X-OpenLen-AB":
      decision.source === "bot"
        ? `${decision.experimentId}:a-bot`
        : `${decision.experimentId}:${decision.variant}`,
    ETag: `W/"${decision.experimentId}-${decision.variant}-${bodyLength}"`,
  };
  if (decision.setCookie) out["Set-Cookie"] = decision.setCookie;
  if (decision.isOverride) out["X-Robots-Tag"] = "noindex";
  return out;
}
