// Born-complete <head> metadata. Runs alongside normalizeBornCanonical at
// every ingestion point (and on editor load) so a page is "born perfect" for
// the Page Health panel — the non-technical user never has to hand-write a
// meta description, og:image, og:title or favicon. We fill these in from the
// page's own content (or sane brand defaults) when they're missing.
//
// Two hard rules:
//   1. NON-DESTRUCTIVE — only ever ADD what's absent. A title / description /
//      og:image the page (or the user) already set is left exactly as-is.
//   2. IDEMPOTENT — running it twice produces identical output, so it's safe
//      to drop into the same call sites as normalizeBornCanonical.
//
// Pure string/regex work — no DOM parser (server runs have no DOMParser, and
// jsdom is too heavy for the request path). Server-only: the branded og:image
// card is base64-encoded so the publish-time uploader (upgradeDataUriOgImage)
// can host it for social crawlers, which can't fetch data: URIs.

import { defaultLogoSvg } from "@/lib/branding/default-logo";

export interface EnsurePageMetaOptions {
  /** Preferred page title — used for <title> / og:title / the favicon +
   *  og:image initial when the document carries no non-empty <title> of its
   *  own. Falls back to the first <h1>, then "Untitled page". */
  title?: string;
  /** Business-profile logo (http(s)/data URL). When set + the page has no
   *  favicon, it becomes the favicon instead of the default coral-initial mark
   *  — so a profile's logo flows to the page automatically. */
  logoUrl?: string;
  /** Preferred og:image fallback (e.g. a profile photo) when the page itself
   *  carries no absolute hero image. */
  ogImage?: string;
}

function isMediaUrl(u?: string): u is string {
  return typeof u === "string" && /^(https?:\/\/|data:)/i.test(u.trim());
}

/** Fill in any missing core <head> metadata. Returns the HTML unchanged when
 *  there's no `<head>` to complete (malformed fragment) or nothing is
 *  missing. */
export function ensurePageMeta(
  html: string,
  opts: EnsurePageMetaOptions = {},
): string {
  if (!html || typeof html !== "string") return html;
  if (!/<\/head\s*>/i.test(html)) return html; // no head to complete — no-op

  const existingTitle = readTitle(html);
  const effectiveTitle =
    existingTitle ||
    (opts.title ?? "").trim() ||
    readFirstText(html, "h1") ||
    "Untitled page";

  let out = html;

  // <title> — add (or fill an empty one) before anything else so the
  // insertion offsets below stay valid.
  if (!existingTitle) {
    out = upsertTitle(out, effectiveTitle);
  }

  const additions: string[] = [];

  if (!hasMeta(out, "name", "description")) {
    const desc = deriveDescription(out, effectiveTitle);
    if (desc) {
      additions.push(`<meta name="description" content="${escAttr(desc)}" />`);
    }
  }

  if (!hasMeta(out, "property", "og:title")) {
    additions.push(
      `<meta property="og:title" content="${escAttr(effectiveTitle)}" />`,
    );
  }

  if (!hasMeta(out, "property", "og:image")) {
    const hero = firstAbsoluteImage(out);
    const ogImage =
      hero ||
      (isMediaUrl(opts.ogImage) ? opts.ogImage.trim() : defaultOgCardDataUrl(effectiveTitle));
    additions.push(
      `<meta property="og:image" content="${escAttr(ogImage)}" />`,
    );
  }

  if (!hasFavicon(out)) {
    const icon = isMediaUrl(opts.logoUrl)
      ? opts.logoUrl.trim()
      : defaultFaviconDataUrl(effectiveTitle);
    additions.push(`<link rel="icon" href="${escAttr(icon)}" />`);
  }

  if (additions.length === 0) return out;

  const insertAt = out.search(/<\/head\s*>/i);
  if (insertAt === -1) return out;
  return out.slice(0, insertAt) + additions.join("") + out.slice(insertAt);
}

// ── reads ────────────────────────────────────────────────────────────────

function readTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const t = m?.[1]?.replace(/\s+/g, " ").trim();
  return t || "";
}

/** Does the document carry a `<meta {attr}="{value}">` with non-empty
 *  content? Quote- and attribute-order agnostic. */
function hasMeta(
  html: string,
  attr: "name" | "property",
  value: string,
): boolean {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (getAttr(m[0], attr)?.toLowerCase() === value.toLowerCase()) {
      const content = getAttr(m[0], "content");
      if (content && content.trim()) return true;
    }
  }
  return false;
}

/** Does the document already declare a favicon? Matches the same `rel`
 *  substring test the Page Health check uses (`link[rel*="icon"]`), so
 *  apple-touch-icon / mask-icon count too. */
function hasFavicon(html: string): boolean {
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const rel = getAttr(m[0], "rel")?.toLowerCase() ?? "";
    if (rel.includes("icon")) {
      const href = getAttr(m[0], "href");
      if (href && href.trim()) return true;
    }
  }
  return false;
}

/** First `<img>` with an absolute http(s) src — the safest og:image source
 *  because, unlike root-relative / api-asset URLs, it survives the publish-
 *  time asset migration and resolves from any social crawler. */
function firstAbsoluteImage(html: string): string | null {
  const re = /<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const src = decodeEntities((m[2] ?? m[3] ?? m[4] ?? "").trim());
    if (/^https?:\/\//i.test(src)) return src;
  }
  return null;
}

/** A human-readable description pulled from the page's own copy. Prefers the
 *  first substantial paragraph, then a subhead, then the hero heading, then
 *  the title. Trimmed to a search-friendly length at a word boundary. */
function deriveDescription(html: string, title: string): string {
  let base =
    readFirstText(html, "p", 40) ||
    readFirstText(html, "h2") ||
    readFirstText(html, "h1") ||
    title;
  base = base.replace(/\s+/g, " ").trim();
  if (!base) return "";
  if (base.length > 158) {
    base = base.slice(0, 158);
    const lastSpace = base.lastIndexOf(" ");
    if (lastSpace > 100) base = base.slice(0, lastSpace);
    base = base.replace(/[\s,;:.–—-]+$/, "") + "…";
  }
  return base;
}

/** Stripped, whitespace-collapsed text of the first `<tag>` whose text is at
 *  least `minLen` chars. */
function readFirstText(html: string, tag: string, minLen = 0): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = decodeEntities(m[1].replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (text.length >= minLen && text.length > 0) return text;
  }
  return "";
}

function getAttr(tag: string, name: string): string | null {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const m = tag.match(re);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? "";
}

// ── writes ────────────────────────────────────────────────────────────────

function upsertTitle(html: string, title: string): string {
  const tag = `<title>${escHtml(title)}</title>`;
  if (/<title[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, tag);
  }
  const headOpen = html.search(/<head[^>]*>/i);
  if (headOpen === -1) return html;
  const after = html.indexOf(">", headOpen) + 1;
  return html.slice(0, after) + tag + html.slice(after);
}

// ── branded og:image card ──────────────────────────────────────────────────

/** The coral-initial favicon as a base64 data: URI. Base64 (not the `;utf8,`
 *  form `defaultLogoDataUrl` emits) so publish-time resolveProjectLogo can
 *  decode + host it instead of persisting a fat data: URI to the DB. */
function defaultFaviconDataUrl(name: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(defaultLogoSvg(name), "utf8").toString("base64")}`;
}

const CARD_CORAL = "#FF5A36";

/** A 1200×630 social card SVG — cream ground, the project's coral initial
 *  disc, and the (wrapped) title. Base64 so publish-time uploads can host it
 *  as a real image for crawlers. */
function defaultOgCardDataUrl(name: string): string {
  const svg = defaultOgCardSvg(name);
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function defaultOgCardSvg(name: string): string {
  const letter = escHtml(initialOf(name));
  const lines = wrapTitle(name.trim(), 22, 2);
  const titleSvg = lines
    .map(
      (ln, i) =>
        `<text x="600" y="${430 + i * 70}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="800" font-size="56" fill="#0B0B0C">${escHtml(ln)}</text>`,
    )
    .join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">`,
    `<rect width="1200" height="630" fill="#FFFDF9"/>`,
    `<circle cx="600" cy="262" r="72" fill="${CARD_CORAL}"/>`,
    `<text x="600" y="262" text-anchor="middle" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="76" fill="#ffffff">${letter}</text>`,
    titleSvg,
    `</svg>`,
  ].join("");
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = trimmed.charAt(0).toUpperCase();
  return /[A-Z0-9]/.test(first) ? first : trimmed.charAt(0) || "?";
}

/** Greedy word-wrap into at most `maxLines` lines of ~`maxChars`. The last
 *  line is ellipsized when copy is left over. */
function wrapTitle(text: string, maxChars: number, maxLines: number): string[] {
  if (!text) return ["Untitled page"];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    } else {
      cur = candidate;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  // Anything past maxLines gets folded into the last line with an ellipsis.
  const consumed = lines.join(" ").length;
  if (consumed < text.length) {
    let last = lines[lines.length - 1] ?? "";
    if (last.length > maxChars - 1) last = last.slice(0, maxChars - 1).trim();
    lines[lines.length - 1] = `${last}…`;
  }
  return lines.length ? lines : [text.slice(0, maxChars)];
}

// ── escaping ────────────────────────────────────────────────────────────────

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}
