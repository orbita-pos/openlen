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
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { AbManifest, AbManifestExperiment, AbVariant } from "./types";

export const AB_HTML_CACHE_CONTROL = "private, no-store";

/** A FILE an experiment decides per visitor (the manifest's `overrides`), whatever the variant. */
export const AB_FILE_CACHE_CONTROL = "no-store";

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
  // Lossy, like Rust: a malformed sequence elsewhere in the path must not stop the rest from being
  // decoded (decodeURIComponent throws on it, and an undecoded /openlen/%61b.json would slip by).
  const out: string[] = [];
  for (const raw of percentDecodeLossy(urlPath).split(/[/\\]/)) {
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

/** A manifest as the evaluator reads it: the experiments that survived validation, and the files
 *  (non-pages) whose bytes differ between Variant B and control (`overrides`, normalized, sorted;
 *  empty for a manifest that does not list any). */
export interface ParsedAbManifest extends AbManifest {
  readonly overrides: readonly string[];
}

// A full RFC 3339 timestamp, upper-case T and Z only. A bare date, a space for the T or no zone is
// NOT a timestamp, here and in Rust `parse_rfc3339_ms`.
const RFC3339_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_OVERRIDES = 4096;
const MAX_OVERRIDE_LEN = 1024;

function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** Unix milliseconds of a full RFC 3339 timestamp, or null when it is not one (years 1970..9999, a
 *  real calendar day, hour 0..23, minute and second 0..59, offset up to 23:59; fractional seconds
 *  are cut to milliseconds). Mirrors Rust `parse_rfc3339_ms`: `Date.parse` is NOT used, it accepts
 *  a bare date and rolls February 30 into March. */
export function parseRfc3339Ms(raw: string): number | null {
  const m = RFC3339_RE.exec(raw);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (y < 1970 || mo < 1 || mo > 12) return null;
  if (d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) return null;
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
  let offsetMin = 0;
  if (m[8]) {
    const [oh, om] = [Number(m[9]), Number(m[10])];
    if (oh > 23 || om > 59) return null;
    offsetMin = (oh * 60 + om) * (m[8] === "-" ? -1 : 1);
  }
  return Date.UTC(y, mo - 1, d, h, mi, s, ms) - offsetMin * 60_000;
}

/** One entry of the manifest's `overrides` as an absolute URL path (`css/site.css` and
 *  `/css/site.css` are the same file); dot segments, backslashes, NULs and absurd lengths are not
 *  files (null). Case is kept: the filesystem is case-sensitive. Mirrors Rust `normalize_override`. */
export function normalizeOverride(raw: string): string | null {
  if (Buffer.byteLength(raw, "utf8") > MAX_OVERRIDE_LEN) return null;
  if (raw.includes("\\") || raw.includes("\0")) return null;
  const segments = raw.split("/").filter((s) => s !== "");
  if (segments.length === 0 || segments.some((s) => s === "." || s === "..")) return null;
  return `/${segments.join("/")}`;
}

function parseExperiment(item: unknown): AbManifestExperiment | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const e = item as Record<string, unknown>;
  if (typeof e.id !== "string" || !EXP_ID_RE.test(e.id)) return null;
  if (typeof e.cookieName !== "string" || !COOKIE_NAME_RE.test(e.cookieName)) return null;
  if (typeof e.targetPath !== "string") return null;
  if (
    typeof e.splitBps !== "number" ||
    !Number.isInteger(e.splitBps) ||
    e.splitBps < 0 ||
    e.splitBps > 10_000
  ) {
    return null;
  }
  // The salt's length is counted in UTF-8 bytes, as in Rust.
  if (typeof e.salt !== "string" || e.salt.length === 0 || Buffer.byteLength(e.salt, "utf8") > 128) {
    return null;
  }
  if (typeof e.prefixB !== "string" || !isSafePrefix(e.prefixB)) return null;
  const overrideParam =
    typeof e.overrideParam === "string" && COOKIE_NAME_RE.test(e.overrideParam)
      ? e.overrideParam
      : "_ol_ab";
  const locales = Array.isArray(e.locales)
    ? e.locales
        .filter((l): l is string => typeof l === "string")
        .map(asciiLower)
        .filter((l) => LOCALE_RE.test(l))
    : [];
  let expiresAt: string | null = null;
  if (e.expiresAt !== undefined && e.expiresAt !== null) {
    // A date that is not a full timestamp (or not even a string): this experiment is ignored.
    if (typeof e.expiresAt !== "string" || parseRfc3339Ms(e.expiresAt) === null) return null;
    expiresAt = e.expiresAt;
  }
  return {
    id: e.id,
    cookieName: e.cookieName,
    targetPath: normalizeMatchPath(e.targetPath),
    includeLocales: e.includeLocales === true,
    locales,
    splitBps: e.splitBps,
    salt: e.salt,
    prefixB: e.prefixB,
    overrideParam,
    expiresAt,
  };
}

/** Parse and validate an `ab.json` payload: null if the version is unknown, the JSON is malformed
 *  or no experiment survives. One malformed experiment is skipped and the others kept — the same
 *  rules as Rust `parse_manifest`, run against the same fixtures. */
export function parseAbManifest(raw: string | Buffer): ParsedAbManifest | null {
  let doc: unknown;
  try {
    doc = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const obj = doc as Record<string, unknown>;
  if (obj.version !== 1 || !Array.isArray(obj.experiments)) return null;

  const experiments = obj.experiments
    .map(parseExperiment)
    .filter((e): e is AbManifestExperiment => e !== null);
  if (experiments.length === 0) return null;

  const overrides = Array.isArray(obj.overrides)
    ? [
        ...new Set(
          obj.overrides
            .slice(0, MAX_OVERRIDES)
            .filter((o): o is string => typeof o === "string")
            .map(normalizeOverride)
            .filter((o): o is string => o !== null),
        ),
      ].sort(compareBytes)
    : [];
  return {
    version: 1,
    releaseSha: typeof obj.releaseSha === "string" ? obj.releaseSha : "",
    experiments,
    overrides,
  };
}

/** Ordering by code unit, which is what Rust's `str` ordering gives for the paths we keep sorted. */
function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
  const ts = parseRfc3339Ms(exp.expiresAt);
  // Not reachable through parseAbManifest (it drops such an experiment); one built by hand fails
  // closed: expired, so control.
  return ts === null || nowMs >= ts;
}

function pathHasNonHtmlExtension(canonical: string): boolean {
  const trimmed = canonical.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return false;
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  // Any dot makes an extension, a dotfile (/.well-known/x, /.hidden) included: it is a file.
  if (dot < 0) return false;
  const ext = asciiLower(last.slice(dot + 1));
  return ext !== "html" && ext !== "htm";
}

/** `%XX` to bytes, the rest as UTF-8, invalid UTF-8 replaced (U+FFFD): what Rust's
 *  `percent_decode_str(..).decode_utf8_lossy()` does. `decodeURIComponent` throws on a malformed
 *  sequence instead, and a throw is not a path. */
function percentDecodeLossy(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; ) {
    const c = s.charCodeAt(i);
    if (c === 0x25 /* % */ && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 3;
      continue;
    }
    const cp = s.codePointAt(i)!;
    bytes.push(...Buffer.from(String.fromCodePoint(cp), "utf8"));
    i += cp > 0xffff ? 2 : 1;
  }
  return new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
}

/** The resolved URL path, case kept: percent-decoded once, `\` and `/` as separators, empty and `.`
 *  segments dropped, `..` popping its parent, a NUL cutting its segment; always with a leading `/`
 *  and never a trailing one. The path every decision is made on. Mirrors Rust `canonical_path`. */
export function canonicalAbPath(urlPath: string): string {
  const out: string[] = [];
  for (const raw of percentDecodeLossy(urlPath).split(/[/\\]/)) {
    const seg = raw.split("\0")[0] ?? "";
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `/${out.join("/")}`;
}

/** A header value is readable when it is visible ASCII (or tab). One that is present but is not
 *  (a UTF-8 'ñ' arrives as two Latin-1 characters in Node) is treated, on the edge and here, as: the
 *  user agent empty (so a bot), the accept-language empty, the cookie absent. */
function readableHeader(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return /^[\t\x20-\x7e]*$/.test(value) ? value : null;
}

/** The override parameter, lower-cased (ASCII), or null when absent: the FIRST occurrence wins and a
 *  bare key is an empty value, as in Rust `read_query_param`. */
function overrideValue(params: URLSearchParams | null | undefined, name: string): string | null {
  const v = params?.get(name);
  return v === null || v === undefined ? null : asciiLower(v);
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

/** The decision for a request, or null when it is outside every live experiment (the caller serves
 *  control with its standard headers). A PAGE of an experiment is bucketed (override, bot, sticky
 *  cookie, hash). A FILE is decided only when the manifest lists it in `overrides` (B ships other
 *  bytes for it) and then for EVERY visitor, control included: the caller marks the answer
 *  `no-store`, or a CDN would cache one variant's bytes under the shared URL for the other's
 *  visitors. Mirrors Rust `evaluate_manifest`; both run `tests/fixtures/ab/evaluate.json`. */
export function evaluateAbManifest(
  manifest: AbManifest & { readonly overrides?: readonly string[] },
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
  const pathname = canonicalAbPath(req.urlPath);
  const cookieHeader = readableHeader(req.cookieHeader);
  const readableUa = readableHeader(req.userAgent);

  if (pathHasNonHtmlExtension(pathname)) {
    if (!manifest.overrides?.includes(pathname)) return null;
    const exp = manifest.experiments.find((e) => !isExpired(e, nowMs));
    if (!exp) return null;
    const ov = overrideValue(req.searchParams, exp.overrideParam);
    const cv = asciiLower(readCookie(cookieHeader, exp.cookieName) ?? "");
    const variant: AbVariant = ov === "b" ? "b" : ov === "a" ? "a" : cv === "b" ? "b" : "a";
    const isOverride = ov === "a" || ov === "b";
    return {
      experimentId: exp.id,
      variant,
      source: isOverride ? "override" : "cookie",
      variantBPath: variant === "b" ? buildVariantBPath(exp.prefixB, pathname) : null,
      setCookie: null,
      isOverride,
      isPageRoute: false,
    };
  }

  const normalized = normalizeMatchPath(pathname);
  const exp = manifest.experiments.find(
    (e) => !isExpired(e, nowMs) && matchesExperimentPage(e, normalized),
  );
  if (!exp) return null;

  const ov = overrideValue(req.searchParams, exp.overrideParam);
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

  const ua = readableUa ?? "";
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

  const cv = asciiLower(readCookie(cookieHeader, exp.cookieName) ?? "");
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
    readableHeader(req.acceptLanguage) ?? "",
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

/** The disk, as the manifest cache sees it (injectable: the tests count and break it). */
export interface AbManifestIo {
  realpath(p: string): Promise<string>;
  stat(p: string): Promise<{ isFile(): boolean; size: number; mtimeMs: number }>;
  readFile(p: string): Promise<string>;
}

const realIo: AbManifestIo = {
  realpath,
  stat,
  readFile: (p) => readFile(p, "utf8"),
};

function isAbsentError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** A parsed manifest per release, like the Rust edge's `AbManifestCache`: the release directory is
 *  resolved ONCE (`realpath` follows the `current` symlink), the file is read under THAT directory,
 *  and the result is kept under it, so the manifest and the directory files are served from belong
 *  to the same release even if a publish swaps the link meanwhile. A release is immutable, so a hit
 *  costs one `stat` (it also catches a plain directory edited in place, in dev). A transient error
 *  (EIO, EACCES…) answers "no experiment" for that request and is NEVER remembered. Bounded by an
 *  entry count and a byte budget; the oldest entries go first. */
export class ReleaseAbManifestCache {
  private readonly slots = new Map<string, { sig: string; manifest: ParsedAbManifest | null; weight: number }>();
  private weightTotal = 0;

  constructor(
    private readonly limits: { readonly maxEntries: number; readonly maxBytes: number } = {
      maxEntries: 1000,
      maxBytes: 4 * 1024 * 1024,
    },
    private readonly io: AbManifestIo = realIo,
  ) {}

  /** Entries held. */
  get size(): number {
    return this.slots.size;
  }

  /** Total weight held (about the bytes of the manifests plus their keys). */
  get bytes(): number {
    return this.weightTotal;
  }

  clear(): void {
    this.slots.clear();
    this.weightTotal = 0;
  }

  /** The release's manifest (null when there is no experiment, or it could not be read right now)
   *  and the resolved release directory to serve its files from. */
  async get(releaseDir: string): Promise<{ manifest: ParsedAbManifest | null; dir: string }> {
    let dir = releaseDir;
    try {
      dir = path.normalize(await this.io.realpath(releaseDir));
    } catch {
      // The release is not there (or cannot be resolved right now): no experiment for this request.
      return { manifest: null, dir };
    }
    const file = path.join(dir, AB_MANIFEST_REL);

    let sig = "absent";
    let skip = false; // a file that is not a manifest at all: nothing to read
    try {
      const s = await this.io.stat(file);
      if (!s.isFile() || s.size > MAX_MANIFEST_BYTES) {
        sig = `invalid:${s.mtimeMs}:${s.size}`;
        skip = true;
      } else {
        sig = `${s.mtimeMs}:${s.size}`;
      }
    } catch (err) {
      if (!isAbsentError(err)) return { manifest: null, dir }; // transient: not remembered
      skip = true;
    }

    const hit = this.slots.get(dir);
    if (hit && hit.sig === sig) {
      // Most recently used goes last.
      this.slots.delete(dir);
      this.slots.set(dir, hit);
      return { manifest: hit.manifest, dir };
    }

    let manifest: ParsedAbManifest | null = null;
    let weight = dir.length + 64;
    if (!skip) {
      try {
        const raw = await this.io.readFile(file);
        manifest = parseAbManifest(raw);
        weight += raw.length;
      } catch (err) {
        if (!isAbsentError(err)) return { manifest: null, dir }; // transient: not remembered
      }
    }

    const old = this.slots.get(dir);
    if (old) {
      this.weightTotal -= old.weight;
      this.slots.delete(dir);
    }
    this.slots.set(dir, { sig, manifest, weight });
    this.weightTotal += weight;
    while (this.slots.size > this.limits.maxEntries || this.weightTotal > this.limits.maxBytes) {
      const oldest = this.slots.keys().next();
      if (oldest.done) break;
      this.weightTotal -= this.slots.get(oldest.value)!.weight;
      this.slots.delete(oldest.value);
    }
    return { manifest, dir };
  }
}

/** The process's cache: one per Node, like the Rust edge's. */
export const releaseAbManifests = new ReleaseAbManifestCache();

/** Read and validate `<releaseDir>/openlen/ab.json` (cached per release), or null if missing,
 *  invalid or unreadable right now. */
export async function readReleaseAbManifest(releaseDir: string): Promise<ParsedAbManifest | null> {
  return (await releaseAbManifests.get(releaseDir)).manifest;
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
    // A page of an experiment: nothing shared. A decided FILE (B ships other bytes for it): `no-store`
    // for everyone, control's visitors included — a CDN caches by URL, and one variant's bytes kept
    // under it would reach the other's — and no validator: it is never revalidated.
    "Cache-Control": decision.isPageRoute ? AB_HTML_CACHE_CONTROL : AB_FILE_CACHE_CONTROL,
    Vary: "Cookie",
    "X-OpenLen-AB":
      decision.source === "bot"
        ? `${decision.experimentId}:a-bot`
        : `${decision.experimentId}:${decision.variant}`,
  };
  if (decision.isPageRoute) {
    out["ETag"] = `W/"${decision.experimentId}-${decision.variant}-${bodyLength}"`;
  }
  if (decision.setCookie) out["Set-Cookie"] = decision.setCookie;
  if (decision.isOverride) out["X-Robots-Tag"] = "noindex";
  return out;
}
