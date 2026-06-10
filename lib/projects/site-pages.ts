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
