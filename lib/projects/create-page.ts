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
};

// ⚰️ `MODULE_PAGE_META` (slug + título por idioma para la página dedicada de un
// módulo: /catalogo, /catalog) salió el 2026-08-29. Su único módulo era
// Colecciones, y ya estaba DECLARADO SIN USAR — `createModulePage`, lo único
// que lo leía, se fue del taller antes que él.

/** Case- AND accent-insensitive slug seed from a display title (same NFD idiom
 *  as lib/agent/photo-search.ts's normalize): strip combining marks so
 *  "Catálogo" → "catalogo", lowercase, and clamp to the slug max BEFORE
 *  validatePageSlug (which then handles spaces→hyphens + shape/reserved). Only
 *  the derive branch uses this — an EXPLICIT slug stays strict. */
const COMBINING_MARKS_RE = /[̀-ͯ]/g;
const SLUG_MAX_CHARS = 40;

function slugFromTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "")
    .toLowerCase()
    .slice(0, SLUG_MAX_CHARS)
    // The clamp can land mid-separator — e.g. right on a literal "-" in the
    // title, or after a run of whitespace — leaving a trailing hyphen/space
    // that validatePageSlug's SLUG_RE then rejects (must end in [a-z0-9]).
    // Strip any such dangling tail so a title-derived slug always validates.
    .replace(/[-\s]+$/, "");
}

/** Inject a module section into a freshly-built page shell, right after the
 *  shell's titled hero (anchored on its signature style, the same anchor
 *  buildAutoMembersPage uses). Anchoring on "first <footer" broke once the
 *  shell's footer became a styled wrapper (<div><footer>… put the section
 *  INSIDE the wrapper) or a ©-div with no <footer> tag at all (section fell
 *  below the footer). Fallbacks for a full-home copy: before the footer,
 *  else before </body>. */
function injectIntoShell(shell: string, section: string): string {
  if (!section) return shell;
  const heroIdx = shell.indexOf("min-height:55vh");
  if (heroIdx !== -1) {
    const heroClose = shell.indexOf("</section>", heroIdx);
    if (heroClose !== -1) {
      const after = heroClose + "</section>".length;
      return shell.slice(0, after) + section + shell.slice(after);
    }
  }
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
    return { error: "invalid_input", message: "el slug debe ser un texto de 1 a 60 caracteres" };
  }
  if (
    input.title !== undefined &&
    (typeof input.title !== "string" || input.title.length > 120)
  ) {
    return { error: "invalid_input", message: "el título debe ser un texto de máximo 120 caracteres" };
  }
  if (!input.slug && !input.title) {
    return { error: "invalid_input", message: "se requiere slug o titulo" };
  }

  if (!data.html) return { error: "no_home", message: "el proyecto aún no tiene página de inicio" };

  // Resolve slug + title + (optional) module section. A module page derives
  // its slug/title per page language; otherwise the caller's slug is used —
  // falling back to a slug DERIVED from the title when no explicit slug was
  // given (new: the route's own caller always sends an explicit slug, so
  // this only fires for a title-only crear_pagina call).
  const isSpanish = /<html[^>]*\blang=["']?es/i.test(data.html);
  let slug: string;
  let title: string | undefined;
  let section = "";
  // ⚰️ Aquí una página podía NACER con la sección de un módulo. El último era
  // `collections`, retirado el 2026-08-29 — y su sección habría nacido vacía,
  // porque el horneado que la llenaba se fue con él.
  {
    // Explicit slug stays strict; a title-only call derives an accent-stripped,
    // clamped seed so accented Spanish titles ("Catálogo") don't fail.
    const rawSlug = input.slug ?? slugFromTitle(input.title ?? "");
    const check = validatePageSlug(rawSlug);
    if (!check.ok) {
      return { error: "invalid_slug", reason: check.reason, message: `el slug es ${check.reason === "reserved" ? "reservado" : "inválido"}` };
    }
    slug = check.slug;
    title = input.title?.trim() || undefined;
  }

  const pages = data.pages ?? {};
  if (pages[slug]) {
    return { error: "exists", slug, message: `la página "${slug}" ya existe` };
  }
  if (Object.keys(pages).length >= MAX_SITE_PAGES) {
    return {
      error: "limit_reached",
      limit: MAX_SITE_PAGES,
      message: `se alcanzó el máximo de ${MAX_SITE_PAGES} páginas`,
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
