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
  "cuenta",
  "account",
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
  /** Present (true) only on gated pages — absent means public. */
  membersOnly?: boolean;
}

/** Key into ProjectData.settings.forms for a form on a given document.
 *  Home forms keep the legacy document-order index key ("0") so every
 *  pre-multipage config keeps working; site-page forms use "<slug>:<index>"
 *  (publish wiring + the submit endpoint fall back to the legacy key when a
 *  page has no scoped entry — shared-config behavior until first edited). */
export function formConfigKey(
  page: string | null | undefined,
  index: number,
): string {
  return page ? `${page}:${index}` : String(index);
}

/** Stable, display-ready listing of a project's extra pages. */
export function listSitePages(data: ProjectData | null | undefined): SitePageSummary[] {
  const pages = data?.pages;
  if (!pages) return [];
  return Object.keys(pages)
    .sort()
    .map((slug) => ({
      slug,
      title: pageTitle(slug, pages[slug]),
      ...(pages[slug]?.membersOnly === true ? { membersOnly: true } : {}),
    }));
}

export function pageTitle(slug: string, page: SitePage | undefined): string {
  const t = page?.title?.trim();
  if (t) return t;
  return slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** The pages array publishToDir consumes — slug + html pairs. ALL non-empty
 *  pages, gated included (version snapshots want the full set); the publish
 *  path itself splits via splitPagesForPublish below. */
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

/** Cloudflare edge paths for every published subpage (NOT home — the caller's
 *  purge already covers `/` and `/index.html`). CF caches `/pricing` and
 *  `/pricing/` as distinct keys, so both are returned. Covers public AND gated
 *  slugs — gated stubs sit at the same public paths. Used by publish, unpublish,
 *  rollback and rename so a subpage is never left stale at the edge. */
export function pageEdgePaths(data: ProjectData | null | undefined): string[] {
  return pagesForPublish(data).flatMap((pg) => [`/${pg.slug}`, `/${pg.slug}/`]);
}

/** Whether members gating is live for this project — the per-page flags only
 *  take effect while the module's master switch is on. */
export function membersGatingEnabled(
  data: ProjectData | null | undefined,
): boolean {
  return data?.settings?.members?.enabled === true;
}

/** pagesForPublish, split into the docs that go to the public release vs the
 *  ones that publish as a login stub + protected document. With the module
 *  off, every page is public — flags stay inert. */
export function splitPagesForPublish(data: ProjectData | null | undefined): {
  publicPages: Array<{ slug: string; html: string }>;
  gatedPages: Array<{ slug: string; html: string }>;
} {
  const gatingOn = membersGatingEnabled(data);
  const publicPages: Array<{ slug: string; html: string }> = [];
  const gatedPages: Array<{ slug: string; html: string }> = [];
  for (const pg of pagesForPublish(data)) {
    const gated = gatingOn && data?.pages?.[pg.slug]?.membersOnly === true;
    (gated ? gatedPages : publicPages).push(pg);
  }
  return { publicPages, gatedPages };
}

/** Per-page strings hashSitePages digests. BACKWARD-COMPAT IS LOAD-BEARING:
 *  with nothing gated this concatenates to exactly the legacy
 *  "slug\u0000html\u0000" stream, so publishedPagesHash values recorded
 *  before the members module exist stay valid (no phantom drift pill on
 *  every published multi-page site). The "m\u0000" marker appends only for
 *  EFFECTIVELY gated pages — flag + module both on — so toggling either one
 *  changes the hash and lights the pill. */
export function sitePagesFingerprintInput(
  data: ProjectData | null | undefined,
): string[] {
  const gatingOn = membersGatingEnabled(data);
  return pagesForPublish(data).map((pg) => {
    const gated = gatingOn && data?.pages?.[pg.slug]?.membersOnly === true;
    return `${pg.slug}\u0000${pg.html}\u0000${gated ? "m\u0000" : ""}`;
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The members module's one-click page: when the module turns on and the
 *  project has NO gated page yet, this builds a "/miembros" (es) or
 *  "/members" (en) page from the home shell — the site's own look — with a
 *  data-ol-logout link the publish-time wiring turns into a working logout
 *  button. Null = nothing to create (a gated page exists, both slugs taken,
 *  or the home document doesn't parse); enabling the module never fails on
 *  this. The caller stores it with membersOnly: true. */
export function buildAutoMembersPage(
  data: ProjectData | null | undefined,
): { slug: string; title: string; html: string } | null {
  const pages = data?.pages ?? {};
  if (Object.values(pages).some((p) => p?.membersOnly === true)) return null;
  const homeHtml = data?.html ?? "";
  const isSpanish = /<html[^>]*\blang=["']?es/i.test(homeHtml);
  const slug = (isSpanish ? ["miembros", "members"] : ["members", "miembros"]).find(
    (s) => !pages[s],
  );
  if (!slug) return null;
  const title = isSpanish ? "Zona de miembros" : "Members area";
  const shell = buildPageShell(homeHtml, title);
  if (!shell) return null;

  // Drop the logout link inside the hero (anchored on its signature style so
  // a future shell redesign degrades to "no link", never a broken page).
  const logoutLabel = isSpanish ? "Cerrar sesión" : "Log out";
  const heroIdx = shell.indexOf("min-height:55vh");
  if (heroIdx === -1) return { slug, title, html: shell };
  const closeIdx = shell.indexOf("</section>", heroIdx);
  if (closeIdx === -1) return { slug, title, html: shell };
  const chip = `  <p style="margin:18px 0 0;"><a href="#" data-ol-logout style="font-size:13px;opacity:0.55;text-decoration:underline;cursor:pointer;color:inherit;">${logoutLabel}</a></p>\n`;
  const html = shell.slice(0, closeIdx) + chip + shell.slice(closeIdx);
  return { slug, title, html };
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
