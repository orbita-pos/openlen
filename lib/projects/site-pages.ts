// Multi-page sites — slug rules + helpers over ProjectData.pages.
//
// A slug is the page's URL path segment: "menu" → <sub>.openlen.com/menu,
// published as <slug>/index.html inside the release (Caddy's existing
// try_files already serves it). Reserved names cover everything else that
// owns a path on a published subdomain: the Caddy handles (/assets, /c,
// /api, /uploads), release internals, and the Speak Every Language locale
// variant dirs (/es/index.html etc.).

import { PUBLISH_LOCALES } from "@/lib/publish/publish-locales";
import type { ProjectData, SitePage } from "./types";

export const MAX_SITE_PAGES = 20;

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const RESERVED_SLUGS = new Set<string>([
  "assets",
  "c",
  "api",
  "uploads",
  "index",
  "_system",
  "404",
  "f",
  "sitemap.xml",
  "robots.txt",
  ...PUBLISH_LOCALES.map((l) => l.code),
]);

export type SlugCheck =
  | { ok: true; slug: string }
  | { ok: false; reason: "invalid" | "reserved" };

/** Normalize + validate a user-entered slug. Lowercases and trims slashes
 *  so "/Menu/" → "menu"; double hyphens collapse. */
export function validatePageSlug(raw: string): SlugCheck {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-");
  if (!SLUG_RE.test(slug)) return { ok: false, reason: "invalid" };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: "reserved" };
  return { ok: true, slug };
}

export interface SitePageSummary {
  slug: string;
  title: string;
}

/** Stable, display-ready listing of a project's extra pages. */
export function listSitePages(data: ProjectData | null | undefined): SitePageSummary[] {
  const pages = data?.pages;
  if (!pages) return [];
  return Object.keys(pages)
    .sort()
    .map((slug) => ({ slug, title: pageTitle(slug, pages[slug]) }));
}

export function pageTitle(slug: string, page: SitePage | undefined): string {
  const t = page?.title?.trim();
  if (t) return t;
  return slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** The pages array publishToDir consumes — slug + html pairs. */
export function pagesForPublish(
  data: ProjectData | null | undefined,
): Array<{ slug: string; html: string }> {
  const pages = data?.pages;
  if (!pages) return [];
  return Object.keys(pages)
    .sort()
    .filter((slug) => typeof pages[slug]?.html === "string" && pages[slug].html.length > 0)
    .map((slug) => ({ slug, html: pages[slug].html }));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A new page's starting document: the home page's SHELL — the full <head>
 *  (styles, tokens, fonts, temática attrs on <html>) plus its nav/header and
 *  footer — with the body content replaced by a titled empty hero. Born
 *  wearing the look without dragging the whole Home along. Returns null when
 *  the home document doesn't parse; callers fall back to the full copy. */
export function buildPageShell(homeHtml: string, title: string): string | null {
  const bodyOpen = /<body[^>]*>/i.exec(homeHtml);
  const bodyCloseIdx = homeHtml.lastIndexOf("</body>");
  if (!bodyOpen || bodyCloseIdx < 0) return null;
  const openEnd = bodyOpen.index + bodyOpen[0].length;
  if (bodyCloseIdx < openEnd) return null;

  let prefix = homeHtml.slice(0, openEnd);
  const bodyInner = homeHtml.slice(openEnd, bodyCloseIdx);
  const suffix = homeHtml.slice(bodyCloseIdx);

  const safeTitle = escapeHtml(title);
  prefix = prefix.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${safeTitle}</title>`,
  );

  // Keep the chrome the visitor expects on every page: the first
  // header/nav and the last footer. Everything in between becomes a
  // titled blank canvas.
  const header =
    /<header[\s\S]*?<\/header>/i.exec(bodyInner)?.[0] ??
    /<nav[\s\S]*?<\/nav>/i.exec(bodyInner)?.[0] ??
    "";
  let footer = "";
  for (const m of bodyInner.matchAll(/<footer[\s\S]*?<\/footer>/gi)) {
    footer = m[0];
  }

  const isSpanish = /<html[^>]*\blang=["']?es/i.test(homeHtml);
  const placeholder = isSpanish
    ? "Esta página está lista para tu contenido — edítala como cualquier otra."
    : "This page is ready for your content — edit it like any other.";

  const hero = `
<section style="min-height:55vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:96px 24px;">
  <h1 style="margin:0;font-size:clamp(38px,6vw,60px);letter-spacing:-0.02em;line-height:1.05;">${safeTitle}</h1>
  <p style="margin:0;max-width:520px;opacity:0.72;font-size:17px;line-height:1.6;">${placeholder}</p>
</section>
`;

  return `${prefix}\n${header}${hero}${footer}\n${suffix}`;
}
