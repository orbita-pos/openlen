// crear_pagina core — extracted from POST /api/projects/[id]/pages (line-
// level fidelity, T5-F1 pattern) so the route (button path) and the agent's
// crear_pagina tool share the exact same slug validation / module-section
// injection / MAX_SITE_PAGES logic instead of diverging.
//
// The route keeps its Zod CreateSchema at the HTTP boundary — that's the
// byte-identical wire contract existing callers rely on. This core does its
// OWN lighter-weight shape checks (see the invalid_input branch) so the
// agent tool, which skips Zod entirely, still gets an equivalent guard. It
// also adds one new capability the route's own caller never needed: when no
// explicit slug is given (and no module), the slug is derived FROM the
// title — an agent call that only knows a display name ("Contacto") still
// works, whereas today's UI always sends an explicit slug.

import { buildModuleSection } from "@/lib/publish/module-sections";
import {
  buildPageShell,
  MAX_SITE_PAGES,
  pageTitle,
  validatePageSlug,
} from "@/lib/projects/site-pages";
import type { ProjectData } from "@/lib/projects/types";

export type CreatePageInput = {
  slug?: string;
  title?: string;
  module?: "bookings" | "collections";
};

// Per-module page slug + title, by page language (matches
// buildAutoMembersPage's es/en split; other locales fall back to English).
// Copied verbatim from the route (was route.ts:43-57).
const MODULE_PAGE_META: Record<
  "bookings" | "collections",
  { es: { slug: string; title: string }; en: { slug: string; title: string } }
> = {
  bookings: {
    es: { slug: "reservas", title: "Reservas" },
    en: { slug: "booking", title: "Booking" },
  },
  collections: {
    es: { slug: "catalogo", title: "Catálogo" },
    en: { slug: "catalog", title: "Catalog" },
  },
};

/** Inject a module section into a freshly-built page shell — before the
 *  footer, else before </body>. The shell's titled hero stays above it.
 *  Copied verbatim from the route (was route.ts:61-71). */
function injectIntoShell(shell: string, section: string): string {
  if (!section) return shell;
  const footerIdx = shell.search(/<footer[\s>]/i);
  if (footerIdx !== -1) {
    return shell.slice(0, footerIdx) + section + shell.slice(footerIdx);
  }
  const bodyClose = shell.lastIndexOf("</body>");
  return bodyClose !== -1
    ? shell.slice(0, bodyClose) + section + shell.slice(bodyClose)
    : shell + section;
}

export type CreatePageOutcome =
  | { nextData: ProjectData; slug: string; title: string }
  | { error: "invalid_input"; message: string }
  | { error: "no_home"; message: string }
  // `reason` is validatePageSlug()'s own reason ("invalid" | "reserved") —
  // the route shell forwards it as-is so its wire response stays
  // byte-identical to today's `{error: check.reason}`.
  | { error: "invalid_slug"; message: string; reason: "invalid" | "reserved" }
  | { error: "exists"; message: string; slug: string }
  | { error: "limit_reached"; message: string; limit: number };

export function createSitePage(
  data: ProjectData,
  input: CreatePageInput,
): CreatePageOutcome {
  // Defense-in-depth shape checks — mirrors CreateSchema's constraints
  // (route.ts's Zod schema) so a caller that skips Zod (the agent tool)
  // gets an equivalent guard. Practically unreachable via HTTP, since the
  // route's Zod parse already rejects these before calling in.
  if (
    input.slug !== undefined &&
    (typeof input.slug !== "string" || input.slug.length < 1 || input.slug.length > 60)
  ) {
    return { error: "invalid_input", message: "slug must be a string of 1-60 characters" };
  }
  if (
    input.title !== undefined &&
    (typeof input.title !== "string" || input.title.length > 120)
  ) {
    return { error: "invalid_input", message: "title must be a string of at most 120 characters" };
  }
  if (
    input.module !== undefined &&
    input.module !== "bookings" &&
    input.module !== "collections"
  ) {
    return { error: "invalid_input", message: "module must be bookings or collections" };
  }
  if (!input.slug && !input.module && !input.title) {
    return { error: "invalid_input", message: "slug, title, or module is required" };
  }

  if (!data.html) return { error: "no_home", message: "project has no home page yet" };

  // Resolve slug + title + (optional) module section. A module page derives
  // its slug/title per page language; otherwise the caller's slug is used —
  // falling back to a slug DERIVED from the title when no explicit slug was
  // given (new: the route's own caller always sends an explicit slug, so
  // this only fires for a title-only crear_pagina call).
  const isSpanish = /<html[^>]*\blang=["']?es/i.test(data.html);
  let slug: string;
  let title: string | undefined;
  let section = "";
  if (input.module) {
    const meta = MODULE_PAGE_META[input.module][isSpanish ? "es" : "en"];
    const check = validatePageSlug(meta.slug);
    if (!check.ok) {
      return { error: "invalid_slug", reason: check.reason, message: `slug is ${check.reason}` };
    }
    slug = check.slug;
    title = meta.title;
    section = buildModuleSection(input.module, { lang: isSpanish ? "es" : "en" });
  } else {
    const check = validatePageSlug(input.slug ?? input.title ?? "");
    if (!check.ok) {
      return { error: "invalid_slug", reason: check.reason, message: `slug is ${check.reason}` };
    }
    slug = check.slug;
    title = input.title?.trim() || undefined;
  }

  const pages = data.pages ?? {};
  if (pages[slug]) {
    return { error: "exists", slug, message: `page "${slug}" already exists` };
  }
  if (Object.keys(pages).length >= MAX_SITE_PAGES) {
    return {
      error: "limit_reached",
      limit: MAX_SITE_PAGES,
      message: `maximum of ${MAX_SITE_PAGES} pages reached`,
    };
  }

  // New pages are born as the home page's SHELL (head + nav + footer, blank
  // titled canvas) so they wear the look without dragging Home's content
  // along. A module page then gets its designed section injected before the
  // footer.
  const displayTitle = pageTitle(slug, title ? { html: "", title } : undefined);
  let pageHtml = buildPageShell(data.html, displayTitle) ?? data.html;
  pageHtml = injectIntoShell(pageHtml, section);
  const nextData: ProjectData = {
    ...data,
    pages: { ...pages, [slug]: { html: pageHtml, ...(title ? { title } : {}) } },
  };

  return { nextData, slug, title: pageTitle(slug, nextData.pages?.[slug]) };
}
