// Publish-time social-image resolver. Decides the final og:image for a page so
// its link unfurls with a real raster on WhatsApp / Facebook / iMessage / X, and
// fills the companion social tags (twitter:image, og:image dims, og:url).
//
// Replaces the old upgrade-og-image.ts (which hosted the SVG card as a `.svg`
// URL that none of those crawlers render). Priority:
//   1. og:image is already a hosted http(s) image (the page's hero) → keep it.
//   2. og:image is the SVG card data: URI, or missing → render the branded card
//      (lib/branding/og-card) to a 1200×630 PNG, host it, use that.
//   3. render/upload fails → drop the unreachable data: card so the publish
//      logo cascade (injectLogoIntoHtml) can supply a hosted og:image instead.
//
// Soft by design: never throws on a render/upload hiccup — a publish is never
// blocked over a social card. Deps are injectable so the meta logic is unit-
// tested without headless Chrome.

import { createHash } from "node:crypto";
import { getStorage } from "@/lib/storage";
import { renderOgCard } from "./og-card";

export interface SocialImageOpts {
  /** Card title — the business name / page title. */
  title: string;
  /** Brand accent for the card disc (optional). */
  accent?: string | null;
  /** Published home URL, e.g. https://<sub>.openlen.com — drives og:url. */
  baseUrl: string;
}

export interface SocialImageDeps {
  renderCard: (o: { title: string; accent?: string | null }) => Promise<Buffer | null>;
  uploadPng: (bytes: Buffer) => Promise<string | null>;
}

async function defaultUploadPng(bytes: Buffer): Promise<string | null> {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  try {
    const { url } = await getStorage().upload({
      key: `og-cards/${hash}.png`,
      contentType: "image/png",
      body: bytes,
    });
    return url;
  } catch {
    return null;
  }
}

const DEFAULT_DEPS: SocialImageDeps = {
  renderCard: (o) => renderOgCard(o),
  uploadPng: defaultUploadPng,
};

export async function ensureSocialOgImage(
  html: string,
  opts: SocialImageOpts,
  deps: SocialImageDeps = DEFAULT_DEPS,
): Promise<string> {
  if (!html || !/<\/head\s*>/i.test(html)) return html;

  // og:url — the canonical home URL (non-destructive).
  let out = ensureMeta(html, "property", "og:url", homeUrl(opts.baseUrl));

  const current = readMetaContent(out, "property", "og:image");

  // 1. A hosted hero image already unfurls — keep it, mirror twitter:image.
  if (current && /^https?:\/\//i.test(current)) {
    return ensureMeta(out, "name", "twitter:image", current);
  }

  // 2. SVG card data: URI (or missing) → render a raster card.
  const png = await deps.renderCard({ title: opts.title, accent: opts.accent });
  if (png) {
    const url = await deps.uploadPng(png);
    if (url) {
      out = setOgImage(out, url);
      out = ensureMeta(out, "name", "twitter:image", url);
      out = ensureMeta(out, "property", "og:image:width", "1200");
      out = ensureMeta(out, "property", "og:image:height", "630");
      return out;
    }
  }

  // 3. Render/upload failed → drop an unreachable data: card so the logo
  //    cascade can supply a hosted og:image. A missing one is left missing.
  if (current && /^data:/i.test(current)) {
    out = removeOgImage(out);
  }
  return out;
}

const ABSOLUTIZE_METAS: Array<["property" | "name", string]> = [
  ["property", "og:image"],
  ["property", "og:url"],
  ["name", "twitter:image"],
];

/** After the publish asset migrations relativize URLs (notably an Unsplash hero
 *  og:image → `/assets/<hash>.webp`, and the dev FilesystemStorage card →
 *  `/uploads/...`), social meta must be made ABSOLUTE again — crawlers reject a
 *  root-relative og:image / twitter:image and the link stops unfurling. Rewrites
 *  any root-relative `content` on the social metas to `${origin}<path>`.
 *  Absolute (http/https/data:) and protocol-relative (`//`) values are left as-is.
 *  Runs as the final per-document bake step (after every URL rewrite). */
export function absolutizeSocialMeta(html: string, baseUrl: string): string {
  if (!html) return html;
  const origin = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(origin)) return html;
  let out = html;
  for (const [attr, value] of ABSOLUTIZE_METAS) {
    const m = findMeta(out, attr, value);
    if (!m) continue;
    const content = getAttr(m[0], "content");
    if (!content || !/^\/(?!\/)/.test(content)) continue; // not root-relative
    const newTag = m[0].replace(
      /\bcontent\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i,
      `content="${escAttr(origin + content)}"`,
    );
    out = out.slice(0, m.index) + newTag + out.slice(m.index + m[0].length);
  }
  return out;
}

// ── helpers (string/regex; no DOM parser) ───────────────────────────────────

function homeUrl(baseUrl: string): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  return trimmed ? `${trimmed}/` : "/";
}

function metaTags(html: string): RegExpExecArray[] {
  const re = /<meta\b[^>]*>/gi;
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m);
  return out;
}

function getAttr(tag: string, name: string): string | null {
  const m = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function findMeta(
  html: string,
  attr: "property" | "name",
  value: string,
): RegExpExecArray | null {
  for (const m of metaTags(html)) {
    if (getAttr(m[0], attr)?.toLowerCase() === value.toLowerCase()) return m;
  }
  return null;
}

function readMetaContent(
  html: string,
  attr: "property" | "name",
  value: string,
): string | null {
  const m = findMeta(html, attr, value);
  if (!m) return null;
  const c = getAttr(m[0], "content");
  return c && c.trim() ? c : null;
}

function insertBeforeHead(html: string, snippet: string): string {
  const i = html.search(/<\/head\s*>/i);
  return i === -1 ? html : html.slice(0, i) + snippet + html.slice(i);
}

/** Add a meta tag if one with that attr/value isn't already present
 *  (non-destructive — an existing value is never overwritten). */
function ensureMeta(
  html: string,
  attr: "property" | "name",
  value: string,
  content: string,
): string {
  if (readMetaContent(html, attr, value)) return html;
  return insertBeforeHead(
    html,
    `<meta ${attr}="${value}" content="${escAttr(content)}" />`,
  );
}

function setOgImage(html: string, url: string): string {
  const m = findMeta(html, "property", "og:image");
  if (!m) {
    return insertBeforeHead(
      html,
      `<meta property="og:image" content="${escAttr(url)}" />`,
    );
  }
  const newTag = m[0].replace(
    /\bcontent\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i,
    `content="${escAttr(url)}"`,
  );
  return html.slice(0, m.index) + newTag + html.slice(m.index + m[0].length);
}

function removeOgImage(html: string): string {
  const m = findMeta(html, "property", "og:image");
  if (!m) return html;
  return html.slice(0, m.index) + html.slice(m.index + m[0].length);
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
