// Multi-page sites — slug rules + helpers over ProjectData.pages.
//
// A slug is the page's URL path segment: "menu" → <sub>.openlen.com/menu,
// published as <slug>/index.html inside the release (Caddy's existing
// try_files already serves it). Reserved names cover everything else that
// owns a path on a published subdomain: the Caddy handles (/assets, /c,
// /api, /uploads), release internals, and the Speak Every Language locale
// variant dirs (/es/index.html etc.).

import { PUBLISH_LOCALES } from "@/lib/publish/publish-locales";
import { extractChrome } from "./page-chrome";
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
  "login",
  "register",
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
 *  slugs. Used by publish, unpublish,
 *  rollback and rename so a subpage is never left stale at the edge. */
export function pageEdgePaths(data: ProjectData | null | undefined): string[] {
  // Las rutas de la puerta de miembro se purgan SIEMPRE, y esto sobrevive a la
  // retirada del módulo (2026-08-21) precisamente por su motivo original: la
  // puerta pudo existir en un release ANTERIOR, y una tarjeta de acceso cacheada
  // no puede sobrevivir al sitio. Purgar rutas ausentes no cuesta nada.
  const door = ["cuenta", "login", "register"].flatMap((s) => [`/${s}`, `/${s}/`]);
  return [
    ...pagesForPublish(data).flatMap((pg) => [`/${pg.slug}`, `/${pg.slug}/`]),
    ...door,
  ];
}


/** pagesForPublish, split into the docs that go to the public release vs the
 *  ones that publish as a login stub + protected document. With the module
 *  off, every page is public — flags stay inert. */
export function splitPagesForPublish(data: ProjectData | null | undefined): {
  publicPages: Array<{ slug: string; html: string }>;
  gatedPages: Array<{ slug: string; html: string }>;
} {
  const publicPages: Array<{ slug: string; html: string }> = [];
  const gatedPages: Array<{ slug: string; html: string }> = [];
  for (const pg of pagesForPublish(data)) {
    // Sin módulo Miembros (retirado 2026-08-21) no hay páginas restringidas.
    // La función sobrevive porque `lib/integrations` la usa para `publicPages`.
    const gated = false;
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
  // Sin páginas restringidas (Miembros se retiró el 2026-08-21), esto produce
  // EXACTAMENTE el flujo legado "slug\u0000html\u0000" — que es justo lo que
  // la compatibilidad de arriba existía para conservar. Los publishedPagesHash
  // anteriores siguen valiendo y nadie ve una píldora de deriva fantasma.
  return pagesForPublish(data).map((pg) => `${pg.slug}\u0000${pg.html}\u0000`);
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
/**
 * Reescribe las anclas de una barra heredada para que apunten a la PORTADA.
 *
 * `href="#artistas"` → `href="/#artistas"`. Sólo dentro del `href`, sólo si
 * empieza por `#`, y nunca `href="#"` a secas —que es lo que el contrato manda
 * poner cuando no hay destino, y convertirlo en `/#` mandaría a la portada a
 * quien pulse un botón que debía no hacer nada.
 */
function anclasALaPortada(chrome: string): string {
  return chrome.replace(
    /(\shref\s*=\s*)("#[^"]+"|'#[^']+')/gi,
    (_m, pre: string, valor: string) => {
      const comilla = valor[0]!;
      return `${pre}${comilla}/${valor.slice(1)}`;
    },
  );
}

/**
 * EL LOGO LLEVA A LA PORTADA. Siempre, en cualquier página.
 *
 * `anclasALaPortada` deja `href="#"` a secas intacto a propósito —es lo que el
 * contrato manda poner cuando no hay destino, y convertirlo en `/#` mandaría a
 * la portada a quien pulse un botón que debía no hacer nada—. Correcto para un
 * botón. Equivocado para el LOGO, que no es un botón sin destino: pulsarlo
 * vuelve al inicio en cualquier sitio del mundo.
 *
 * 🔴 MEDIDO el 2026-08-31 sobre el corpus: 7 de las 12 subpáginas (58%) tenían
 * su logo en `href="#"`. Jesús lo vio en su página —pulsaba «La Marea» dentro
 * de /nosotros y se quedaba en /nosotros#— y se lo pidió al Agente, que lo
 * arregló EN LA HOME y dejó la subpágina como estaba. No era despiste del
 * modelo: el armazón nace así.
 *
 * Sólo el PRIMER <a> de la cabecera, que es donde vive el logo por convención
 * en todo el corpus, y sólo si su href es `#` o está vacío: si el modelo le
 * puso un destino de verdad, manda el suyo.
 */
function logoALaPortada(header: string): string {
  return header.replace(
    // `\s` explícito entre la etiqueta y lo que venga: `<a href="#">` no lleva
    // atributos delante, y con `[^>]*?` a secas el grupo se comía el espacio y
    // no casaba. Lo cazó la prueba.
    /<a(\s[^>]*?)?\shref\s*=\s*("#"|'#'|""|'')/i,
    (_m, antes: string | undefined) => `<a${antes ?? ""} href="/"`,
  );
}

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

  // Keep the chrome the visitor expects on every page: the home's real
  // navbar (styled wrapper included) and footer. Everything in between
  // becomes a titled blank canvas.
  //
  // Y SUS ANCLAS APUNTAN A LA PORTADA, no a esta página. El menú heredado lleva
  // `#artistas`, `#trabajos`, `#precios` — secciones que existen en la PORTADA
  // y no aquí. Copiadas tal cual son enlaces que no llevan a ningún sitio, y el
  // fallo era mudo: pulsabas y no pasaba nada.
  //
  // Cazado el 2026-08-27, cuando el taller empezó a decir «#artistas no lleva a
  // ninguna sección de esta página» — el aviso nuevo delató un defecto viejo.
  // `/#artistas` es lo que hace cualquier sitio multipágina: vuelve a la
  // portada y baja hasta ahí.
  const chrome = extractChrome(bodyInner);
  const header = logoALaPortada(anclasALaPortada(chrome.header));
  const footer = anclasALaPortada(chrome.footer);

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
