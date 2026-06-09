// ─────────────────────────────────────────────────────────────────────────────
// Publish-time Google Fonts bake.
//
// Every template and AI-generated page loads webfonts via a render-blocking
// <link> to fonts.googleapis.com, which chains a second origin
// (fonts.gstatic.com) before first text paint and leaks every visitor's IP
// to Google (the 2022 LG München GDPR ruling fined exactly this). The
// published page is a frozen static artifact, so at publish we finish what
// the Tailwind bake and the Unsplash migration started:
//
//   1. Fetch each Google Fonts stylesheet with a modern-Chrome UA (the css2
//      endpoint is UA-negotiated — a generic client gets legacy TTF, a
//      modern UA gets unicode-range-split woff2).
//   2. Download the fonts.gstatic.com files into the subdomain's shared
//      assets dir, content-addressed, with a URL-keyed sidecar
//      (fonts.bake.json) so a republish skips every download — gstatic
//      URLs are themselves immutable.
//   3. Rewrite the CSS url()s to local /assets/ paths, enforce
//      font-display:swap on every @font-face, and replace the <link> with
//      an inline <style data-ol-font-baked> in the same position.
//   4. Drop the now-dead preconnect/dns-prefetch links once no Google
//      Fonts reference survives anywhere in the document.
//
// The browser still honors the unicode-range splits locally, so visitors
// download exactly the script subsets they need — same bytes as before,
// minus two origins of DNS+TLS+RTT on the critical path. True glyph-level
// subsetting (hb-subset) is a later iteration.
//
// Editor preview keeps the Google link (fast, cached); only the published
// output is rewritten. Safety contract mirrors the other bakes: a fetch or
// disk failure keeps the original <link> for that stylesheet, and the
// caller wraps the whole step in try/catch. Publish is never blocked.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// css2 negotiates the response format on User-Agent; this gets woff2.
const MODERN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_CSS_BYTES = 1 * 1024 * 1024;
const MAX_FONT_BYTES = 5 * 1024 * 1024;
const SIDECAR_VERSION = 1;
const SIDECAR_FILE = "fonts.bake.json";

const GOOGLE_CSS_LINK_RE =
  /<link\b[^>]*\bhref\s*=\s*["'](https?:\/\/fonts\.googleapis\.com\/css2?\?[^"']+)["'][^>]*>/gi;
const GOOGLE_CSS_IMPORT_RE =
  /@import\s+url\(\s*["']?(https?:\/\/fonts\.googleapis\.com\/css2?\?[^"')]+)["']?\s*\)\s*;?/gi;
const FONT_HOST_LINK_RE =
  /<link\b[^>]*\bhref\s*=\s*["']https?:\/\/fonts\.(?:googleapis|gstatic)\.com\/?["'][^>]*>\s*/gi;
const GSTATIC_URL_RE =
  /url\(\s*(["']?)(https:\/\/fonts\.gstatic\.com\/[^"')\s]+)\1\s*\)/g;
const REL_ATTR_RE = /\brel\s*=\s*["']([^"']*)["']/i;
const FONT_FACE_BLOCK_RE = /@font-face\s*\{[^}]*\}/g;

/** Same conservative entity set as the other publish-time URL handling. */
function decodeHtmlEntitiesInUrl(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/");
}

function relTokens(tag: string): string[] {
  const m = REL_ATTR_RE.exec(tag);
  return m ? m[1].toLowerCase().split(/\s+/).filter(Boolean) : [];
}

/** Stylesheet <link>s pointing at fonts.googleapis.com/css|css2, deduped,
 *  entity-decoded. Pure — exported for unit tests. */
export function collectGoogleCssUrls(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(GOOGLE_CSS_LINK_RE)) {
    if (!relTokens(m[0]).includes("stylesheet")) continue;
    const url = decodeHtmlEntitiesInUrl(m[1]);
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  for (const m of html.matchAll(GOOGLE_CSS_IMPORT_RE)) {
    const url = decodeHtmlEntitiesInUrl(m[1]);
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/** Add font-display:swap to any @font-face block that doesn't declare a
 *  font-display. css2 already includes it when the URL carries
 *  &display=swap — this covers AI/pasted pages that forgot. Pure —
 *  exported for unit tests. */
export function ensureFontDisplaySwap(css: string): string {
  return css.replace(FONT_FACE_BLOCK_RE, (block) =>
    /font-display\s*:/i.test(block)
      ? block
      : block.replace(/\{/, "{font-display:swap;"),
  );
}

type FetchLike = typeof fetch;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { ...init, signal: ctrl.signal });
    return r.ok ? r : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface FontSidecar {
  v: number;
  /** fonts.gstatic.com URL → local filename in the assets dir. */
  urls: Record<string, string>;
}

async function readFontSidecar(assetsDir: string): Promise<FontSidecar> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(assetsDir, SIDECAR_FILE), "utf8"),
    ) as FontSidecar;
    if (parsed?.v === SIDECAR_VERSION && parsed.urls && typeof parsed.urls === "object") {
      return { v: SIDECAR_VERSION, urls: parsed.urls };
    }
  } catch {
    /* first bake for this subdomain */
  }
  return { v: SIDECAR_VERSION, urls: {} };
}

function fontExt(url: string): string {
  const m = /\.(woff2|woff|ttf|otf)$/i.exec(new URL(url).pathname);
  return m ? m[1].toLowerCase() : "woff2";
}

/** Download one gstatic font file (or reuse the sidecar entry) and return
 *  its local filename, or null on any failure. */
async function ensureFontFile(
  url: string,
  assetsDir: string,
  sidecar: FontSidecar,
  fetchImpl: FetchLike,
): Promise<string | null> {
  const cached = sidecar.urls[url];
  if (cached && /^[A-Za-z0-9._-]+$/.test(cached)) {
    try {
      await stat(path.join(assetsDir, cached));
      return cached;
    } catch {
      /* pruned — re-download below */
    }
  }
  const response = await fetchWithTimeout(url, {}, fetchImpl);
  if (!response) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_FONT_BYTES) return null;

  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const file = `f-${hash}.${fontExt(url)}`;
  const dst = path.join(assetsDir, file);
  try {
    await stat(dst);
  } catch {
    await writeFile(dst, bytes);
  }
  sidecar.urls[url] = file;
  return file;
}

/** Fetch one Google Fonts stylesheet and localize its gstatic url()s.
 *  Returns the rewritten CSS, or null when the stylesheet fetch failed or
 *  not a single font file could be localized (keep the original <link>). */
async function bakeOneStylesheet(
  cssUrl: string,
  assetsDir: string,
  sidecar: FontSidecar,
  fetchImpl: FetchLike,
): Promise<string | null> {
  const response = await fetchWithTimeout(
    cssUrl,
    { headers: { "User-Agent": MODERN_UA, Accept: "text/css,*/*;q=0.1" } },
    fetchImpl,
  );
  if (!response) return null;
  const css = await response.text();
  if (css.length === 0 || css.length > MAX_CSS_BYTES) return null;

  const fontUrls = [...new Set([...css.matchAll(GSTATIC_URL_RE)].map((m) => m[2]))];
  const resolved = new Map<string, string>();
  await Promise.all(
    fontUrls.map(async (u) => {
      const file = await ensureFontFile(u, assetsDir, sidecar, fetchImpl);
      if (file) resolved.set(u, file);
    }),
  );
  if (fontUrls.length > 0 && resolved.size === 0) return null;

  const rewritten = css.replace(GSTATIC_URL_RE, (full, _q, u: string) => {
    const file = resolved.get(u);
    return file ? `url(/assets/${file})` : full;
  });
  return ensureFontDisplaySwap(rewritten);
}

export interface FontBakeResult {
  html: string;
  /** Stylesheets inlined (links + @imports). */
  stylesheetsBaked: number;
  /** Font files now served from the subdomain's own assets dir. */
  filesLocalized: number;
}

/**
 * Self-host every Google Fonts stylesheet referenced by `html`. Failed
 * stylesheets keep their original <link>/@import; preconnects to the
 * Google font hosts are removed only when no reference survives.
 */
export async function bakeGoogleFonts(params: {
  html: string;
  subDir: string;
  /** Test seam — defaults to global fetch. */
  fetchImpl?: FetchLike;
}): Promise<FontBakeResult> {
  const { html, subDir } = params;
  const fetchImpl = params.fetchImpl ?? fetch;
  const unchanged: FontBakeResult = {
    html,
    stylesheetsBaked: 0,
    filesLocalized: 0,
  };

  const cssUrls = collectGoogleCssUrls(html);
  if (cssUrls.length === 0) return unchanged;

  const assetsDir = path.join(subDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  const sidecar = await readFontSidecar(assetsDir);
  const filesBefore = Object.keys(sidecar.urls).length;

  const baked = new Map<string, string>();
  await Promise.all(
    cssUrls.map(async (url) => {
      try {
        const css = await bakeOneStylesheet(url, assetsDir, sidecar, fetchImpl);
        if (css !== null) baked.set(url, css);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[font-bake] stylesheet bake failed", url, err);
      }
    }),
  );
  if (baked.size === 0) return unchanged;

  let stylesheetsBaked = 0;
  let out = html.replace(GOOGLE_CSS_LINK_RE, (full, href: string) => {
    if (!relTokens(full).includes("stylesheet")) return full;
    const css = baked.get(decodeHtmlEntitiesInUrl(href));
    if (css === undefined) return full;
    stylesheetsBaked++;
    return `<style data-ol-font-baked>\n${css}\n</style>`;
  });
  out = out.replace(GOOGLE_CSS_IMPORT_RE, (full, href: string) => {
    const css = baked.get(decodeHtmlEntitiesInUrl(href));
    if (css === undefined) return full;
    stylesheetsBaked++;
    // The @import lives inside a <style> block — raw CSS is valid in place.
    return `\n${css}\n`;
  });

  // Only drop the preconnect/dns-prefetch hints when nothing on the page
  // references the Google font hosts anymore — a partially-baked page still
  // benefits from them.
  if (!/fonts\.(?:googleapis|gstatic)\.com\//i.test(out.replace(FONT_HOST_LINK_RE, ""))) {
    out = out.replace(FONT_HOST_LINK_RE, (full) => {
      const rel = relTokens(full);
      return rel.includes("preconnect") || rel.includes("dns-prefetch") ? "" : full;
    });
  }

  try {
    await writeFile(
      path.join(assetsDir, SIDECAR_FILE),
      JSON.stringify(sidecar),
    );
  } catch {
    /* cache-only artifact — losing it just means re-downloading next publish */
  }

  return {
    html: out,
    stylesheetsBaked,
    filesLocalized: Object.keys(sidecar.urls).length - filesBefore,
  };
}
