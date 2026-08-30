import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { legacyWebp2000Variant, processImage } from "@/lib/images";
import { validateSubdomain } from "@/lib/subdomain/validate";
import { gateReservedMarker, sealRelease, stripOpIds } from "@/lib/html-engine";
import { optimizeHtmlForProduction } from "@/lib/publish/optimize-html";
import { bakeResponsiveImages } from "@/lib/publish/image-bake";
import { bakeGoogleFonts } from "@/lib/publish/font-bake";
import { bakeAssistantWidget } from "@/lib/publish/assistant-widget";
import { bakeCollections } from "@/lib/publish/collections-block";
import { stripDisabledModuleBands } from "@/lib/publish/strip-disabled-bands";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { applyLiveData } from "@/lib/live";
import { bakeChatWidget } from "@/lib/publish/chat-widget";
import { bakeMediaPreconnect } from "@/lib/publish/video-embed";
import { optOutOfEmailObfuscation } from "@/lib/publish/cloudflare-email";
import type { ItemRow } from "@/lib/collections/store";
import {
  annotateLanguageCluster,
  buildRobots,
  buildSitemap,
  detectHtmlLang,
  type ClusterMember,
} from "@/lib/publish/language-cluster";
import { consolidateUnsplashCredits } from "@/lib/publish/credits";
import { stripDesignStash } from "@/lib/publish/design-stash-strip";
import { wirePublishedForms } from "@/lib/publish/forms";
import { injectAnalyticsSnippet } from "@/lib/analytics/snippet";
import { injectTrackingStrip } from "@/lib/publish/tracking-strip";
import { injectLogoIntoHtml } from "@/lib/branding/inject-logo";
import { absolutizeSocialMeta } from "@/lib/branding/social-image";
import { buildLlmsTxt, pageTitle } from "@/lib/publish/llms-txt";
import { detectSiteAccent } from "@/lib/publish/site-accent";
import { validatePageSlug } from "@/lib/projects/site-pages";
import type {
  FormConfig,
} from "@/lib/projects/types";

// ─────────────────────────────────────────────────────────────────────────────
// Publish-to-disk primitives — versioned releases + `current` symlink.
//
// Layout per subdomain:
//
//   /var/www/openlen/<sub>/
//     releases/
//       <sha-12>/
//         index.html
//       <sha-12>/
//         index.html
//     current -> releases/<sha-12>   (symlink)
//
// nginx `root` is `<sub>/current` (set in infra/nginx/openlen.conf), so the
// live site is whatever the symlink points at. Publishing a new release:
//
//   1. Compute sha256 of the optimized HTML (12 chars stable).
//   2. If `releases/<sha>/` already exists, no write — content is identical.
//   3. Otherwise write to `.tmp-<sha>-<uuid>/index.html`, then atomically
//      `rename(tmp, releases/<sha>)`.
//   4. Atomically flip the `current` symlink: `symlink(releases/<sha>, current.new)`
//      then `rename(current.new, current)`.
//   5. Best-effort cleanup of releases beyond the last 10 (by mtime).
//
// Rollback: `rollbackToSha(sub, sha)` validates that `releases/<sha>/` exists
// and just flips the symlink. No re-render, no orchestrator call.
//
// PUBLISH_ROOT env var is honored so tests can point at a tmp dir without
// touching the real wildcard root.
// ─────────────────────────────────────────────────────────────────────────────

const RELEASES_KEEP = 10;
const SHA_LEN = 12;

function getRoot(): string {
  return process.env.PUBLISH_ROOT?.trim() || "/var/www/openlen";
}

/** The wildcard publish root — exported for consumers that read releases
 *  back off disk (flight-check's ephemeral audit server). */
export function getPublishRoot(): string {
  return getRoot();
}

function safeJoin(root: string, ...parts: string[]): string {
  const joined = path.join(root, ...parts);
  const norm = path.normalize(joined);
  const rootNorm = path.normalize(root);
  if (!norm.startsWith(rootNorm + path.sep) && norm !== rootNorm) {
    throw new Error(`refusing path traversal: ${joined}`);
  }
  return norm;
}

function computeShaFiles(
  files: Array<{ path: string; content: string }>,
): string {
  const h = createHash("sha256");
  for (const f of files) {
    h.update(f.path, "utf8");
    h.update("\0");
    h.update(f.content, "utf8");
    h.update("\0");
  }
  return h.digest("hex").slice(0, SHA_LEN);
}

function publishedBaseHost(): string {
  return process.env.PUBLISH_BASE_HOST?.trim() || "openlen.com";
}

export class ReleaseNotFoundError extends Error {
  constructor(public readonly subdomain: string, public readonly sha: string) {
    super(`release ${sha} for ${subdomain} not found`);
    this.name = "ReleaseNotFoundError";
  }
}

export interface PublishParams {
  subdomain: string;
  html: string;
  /** When provided AND the HTML references `/api/projects/<projectId>/assets/<filename>`
   *  URLs (LocalFs upload backend), each referenced file is copied from the
   *  upload dir to `<sub>/assets/<filename>` and the URL is rewritten to
   *  `/assets/<filename>` so nginx serves the asset directly off disk —
   *  no Node round-trip per image on the published page. */
  projectId?: string;
  /** Per-form config from ProjectData.settings.forms, keyed by document-
   *  order form index. Baked into the published forms by wirePublishedForms. */
  formConfigs?: Record<string, FormConfig>;
  /** Inject the analytics tracker snippet at publish time? Defaults to true.
   *  Set to false when the project's settings.analyticsDisabled is true so
   *  the user can opt out without losing the rest of publish-time HTML rewrites. */
  analyticsEnabled?: boolean;
  /** Per-project favicon / brand mark URL. When provided, publishToDir
   *  rewrites any existing <link rel="icon"> to point at it AND adds an
   *  og:image meta if the document doesn't already declare one. Null /
   *  undefined leaves the HTML's existing head untouched. */
  logoUrl?: string | null;
  /** Speak Every Language: called with the fully-baked root HTML right
   *  before sealing; returns translated locale documents to write as
   *  /<locale>/index.html inside the same release. Failures (or an empty
   *  array) degrade to a root-only publish. */
  buildLocaleDocs?: (
    html: string,
  ) => Promise<Array<{ locale: string; html: string }>>;
  /** Los idiomas que el dueño PIDIÓ y que legítimamente deberían salir — ya
   *  filtrados (códigos válidos, sin el idioma de origen). Sirve para una sola
   *  cosa: poder decir cuáles NO salieron. Sin esto `buildLocaleDocs` devuelve
   *  lo que pudo y nadie puede comparar contra lo pedido. */
  localesPedidos?: readonly string[];
  /** The page's own language — hreflang of the root document. Defaults to
   *  the <html lang> attribute, then "en". */
  sourceLang?: string;
  /** Multi-page: extra site pages, each written as <slug>/index.html inside
   *  the same release after running the full per-document bake chain. Slugs
   *  are assumed pre-validated (lib/projects/site-pages). Locale variants
   *  stay home-only; subpages get their own canonical. */
  pages?: Array<{
    slug: string;
    html: string;
  }>;
  /** Site assistant (settings.assistant). When enabled, the visitor-facing
   *  chat widget IIFE is injected before </body> on the root doc AND every
   *  page/locale variant. The owner's business brain never ships — the widget
   *  calls back to /api/assistant/<sub> which reads it server-side. */
  assistant?: AssistantBake;
  /** Collections module (settings.collections). When enabled, the owner's item
   *  list is baked as STATIC HTML (a grid/list of cards) at the
   *  data-ol-collection-section placeholder, or appended before </body>. No
   *  runtime API — re-baked from the DB on every publish. */
  collections?: { enabled: boolean; items: ItemRow[]; layout: "grid" | "list"; theme?: "light" | "dark" };
  /** Datos vivos (settings.liveData). When set, every publish rebakes the
   *  page's `data-ol-live` markers from the owner's Google Sheet (cached,
   *  never-throw — a stale/unreachable Sheet just leaves the HTML
   *  unchanged). Absent/null → the markers are left as-is (no Sheet
   *  configured). */
  liveData?: { sheetUrl: string } | null;
  /** Pedidos por WhatsApp (settings.orders). When enabled with a usable number,
   *  collection cards bake «Agregar» buttons and the cart runtime is injected
   *  into every document that carries them. */
  orders?: { enabled: boolean; number: string };
  /** Private chat module (settings.chat). When enabled, the 1:1 messaging
   *  widget is baked on the root doc + every page/locale variant. */
  chat?: ChatBake;
  /** Mis plataformas: los enlaces del perfil de negocio efectivo del proyecto,
   *  resueltos en publishProject (projectBusinessProfile — linked-first-else-
   *  default). Cada publicación re-rellena la banda con estos handles FRESCOS;
   *  sin ninguno armable (o `null` = perfil ausente / lookup fallido) la banda
   *  se borra entera, para no publicar un "Encuéntrame en" sobre un hueco. */
  platforms?: BusinessProfileData["links"] | null;
  /** Members module: pages that publish as a login STUB at their public path
   *  while the REAL document (full bake chain + seal) is written OUTSIDE the
   *  release — <sub>/protected/<sha>/<slug>/index.html, unreachable by the
   *  web tier — and served only by /api/m/[sub]/page/[slug] after a session
   *  check. Slugs pre-validated like `pages`. */
  /** Branding for the gate stubs (site title + optional logo on the login
   *  card). Required in spirit when gatedPages is non-empty. */
  /** Members module: when set (module on + a gated portal exists), every
   *  PUBLIC doc gets a sign-in link to this portal slug — the page's own
   *  sign-in link is rewired to it, or a neutral one is injected. Absent →
   *  no-op (module off / no gated page). */
  /** When the signin path is the Cuentas account home (/cuenta), the injected
   *  nav link reads as an account entry ("Mi cuenta") not "Iniciar sesión". */
  /** Cuentas preset: also publish the account card at /cuenta (its bytes ARE
   *  the auth card / dashboard — mode:"account" — with no protected doc behind
   *  it). Wears the same detected accent as the gate stubs. */
}

const ASSET_URL_RE_FOR =
  // Built per-call because we interpolate the projectId. Captures the
  // hash-based filename, e.g. `/api/projects/<id>/assets/abc123.webp`.
  (projectId: string) =>
    new RegExp(
      // eslint-disable-next-line no-useless-escape
      `/api/projects/${escapeForRegex(projectId)}/assets/([A-Za-z0-9._-]+)`,
      "g",
    );

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getUploadDir(): string {
  return (
    process.env.OPENLEN_UPLOAD_DIR ?? path.join(process.cwd(), "uploads")
  );
}

/** Origin the wired forms POST to (lib/publish/forms.ts submitBase) — the
 *  seal's form-action must allow it: <sub>.openlen.com pages submit
 *  cross-origin to the apex. */
function submitOrigin(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://openlen.com";
  try {
    return new URL(base).origin;
  } catch {
    return "https://openlen.com";
  }
}

/** Find LocalFs asset URLs in the HTML, copy each referenced file to the
 *  subdomain's `assets/` dir (shared across releases — hash-based filenames
 *  make this safe), and rewrite the URLs to be subdomain-relative.
 *
 *  Returns the rewritten HTML. Best-effort on failures: if a file can't be
 *  copied, the URL is left as-is so the page still renders via the API
 *  fallback (slower but functional). */
async function migrateLocalAssets(params: {
  html: string;
  projectId: string;
  subDir: string;
}): Promise<string> {
  const { html, projectId, subDir } = params;
  const re = ASSET_URL_RE_FOR(projectId);
  const matches = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    matches.add(m[1]);
  }
  if (matches.size === 0) return html;

  const uploadDir = getUploadDir();
  const targetDir = safeJoin(subDir, "assets");
  await mkdir(targetDir, { recursive: true });

  const failed = new Set<string>();
  await Promise.all(
    Array.from(matches).map(async (filename) => {
      // Filename is hash-based but defend against traversal anyway.
      if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename.includes("..")) {
        failed.add(filename);
        return;
      }
      const src = path.join(uploadDir, projectId, filename);
      const dst = path.join(targetDir, filename);
      try {
        await stat(dst);
        return; // already present from a prior publish — hash-based, idempotent
      } catch {
        /* not there yet — copy below */
      }
      try {
        await copyFile(src, dst);
      } catch {
        failed.add(filename);
      }
    }),
  );

  // Rewrite URLs we successfully migrated to subdomain-relative paths.
  // Anything in `failed` stays as the original API URL so it still works
  // via the Node fallback (just slower).
  return html.replace(
    ASSET_URL_RE_FOR(projectId),
    (full, filename: string) => {
      if (failed.has(filename)) return full;
      return `/assets/${filename}`;
    },
  );
}


// Match Unsplash CDN URLs in any HTML/CSS context. The exclude set stops
// the match at quote / whitespace / `)` (for `url(...)` in CSS) / `<` `>`
// (for tag boundaries). `&` and `=` are allowed so query strings survive.
const UNSPLASH_URL_RE = /https?:\/\/images\.unsplash\.com\/[^"'\s)<>]+/g;

const UNSPLASH_FETCH_TIMEOUT_MS = 15_000;
const UNSPLASH_MAX_BYTES = 20 * 1024 * 1024; // 20 MB upper bound per photo

/** Decode the common HTML entities we'd find inside an `<img src>` URL.
 *  Conservative — only what realistically appears in URLs. */
function decodeHtmlEntitiesInUrl(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/");
}

/** Cache-on-publish for Unsplash hotlinks. Downloads each unique Unsplash
 *  URL in the HTML, runs it through sharp (resize + WebP), saves to the
 *  subdomain's shared `assets/` dir by content hash, and rewrites URLs in
 *  the HTML. Best-effort: any failure leaves the original hotlink intact
 *  so the published page degrades gracefully to the Unsplash CDN.
 *
 *  Why on publish (not on pick): edit-time stays fast (free Unsplash CDN),
 *  but the published page becomes self-contained — no external dependency
 *  for hero images. Reliability of the user's landing page is the priority. */
async function migrateUnsplashAssets(params: {
  html: string;
  subDir: string;
}): Promise<string> {
  const { html, subDir } = params;
  const matches = new Set<string>();
  let m: RegExpExecArray | null;
  UNSPLASH_URL_RE.lastIndex = 0;
  while ((m = UNSPLASH_URL_RE.exec(html)) !== null) {
    matches.add(m[0]);
  }
  if (matches.size === 0) return html;

  const targetDir = safeJoin(subDir, "assets");
  await mkdir(targetDir, { recursive: true });

  // url-as-found-in-HTML → replacement path (or unchanged on failure).
  const urlMap = new Map<string, string>();

  await Promise.all(
    Array.from(matches).map(async (htmlUrl) => {
      const fetchUrl = decodeHtmlEntitiesInUrl(htmlUrl);
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), UNSPLASH_FETCH_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetch(fetchUrl, {
            redirect: "follow",
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!response.ok) {
          urlMap.set(htmlUrl, htmlUrl);
          return;
        }
        const raw = Buffer.from(await response.arrayBuffer());
        if (raw.length === 0 || raw.length > UNSPLASH_MAX_BYTES) {
          urlMap.set(htmlUrl, htmlUrl);
          return;
        }

        const { variants: optimizedVariants } = await processImage({
          input: raw,
          variants: [legacyWebp2000Variant()],
          autoOrient: true,
          withoutEnlargement: true,
        });
        const optimized = optimizedVariants[0].bytes;

        const hash = createHash("sha256")
          .update(optimized)
          .digest("hex")
          .slice(0, 16);
        const filename = `${hash}.webp`;
        const dst = path.join(targetDir, filename);

        // Hash-based dedupe: if it's already there, skip the write entirely.
        let exists = false;
        try {
          await stat(dst);
          exists = true;
        } catch {
          /* not there yet */
        }
        if (!exists) {
          await writeFile(dst, optimized);
        }

        urlMap.set(htmlUrl, `/assets/${filename}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[publishToDir] unsplash migrate failed", htmlUrl, err);
        urlMap.set(htmlUrl, htmlUrl);
      }
    }),
  );

  // Rewrite — only URLs that successfully migrated get replaced. Failed
  // ones stay as the original Unsplash hotlink (graceful degradation).
  return html.replace(UNSPLASH_URL_RE, (match) => {
    const replacement = urlMap.get(match);
    return replacement && replacement !== match ? replacement : match;
  });
}

interface BakeDocumentCtx {
  sub: string;
  subDir: string;
  projectId?: string;
  formConfigs?: Record<string, FormConfig>;
  analyticsEnabled: boolean;
  logoUrl?: string | null;
  /** Site assistant widget config. Absent/disabled = no widget injected. */
  assistant?: AssistantBake;
  /** Collections module. When enabled, the owner's item list is baked as STATIC
   *  HTML (grid/list of cards) at the placeholder, or appended. */
  collections?: { enabled: boolean; items: ItemRow[]; layout: "grid" | "list"; theme?: "light" | "dark" };
  /** Datos vivos. When set, every `data-ol-live` marker is rebaked from the
   *  owner's Google Sheet (cached, never-throw). */
  liveData?: { sheetUrl: string } | null;
  /** WhatsApp button. When enabled with a usable number, a floating FAB is baked
   *  (suppressed if the profile contact widget is already present). */
  /** Pedidos por WhatsApp — cart over the collections buttons. */
  orders?: { enabled: boolean; number: string };
  /** Private chat module. When enabled, the 1:1 messaging widget is baked. */
  chat?: ChatBake;
  /** Mis plataformas — enlaces del perfil de negocio efectivo. Ver
   *  PublishParams.platforms. */
  platforms?: BusinessProfileData["links"] | null;
  /** Per SECTION module: does the site declare its band in at least ONE
   *  document? True → the widget bakes ONLY in the documents that carry the
   *  band. False → the historical fallback (append before </body> everywhere)
   *  so "turn the module on and something shows up" keeps working. */
}

interface AssistantBake {
  enabled: boolean;
  businessName: string;
  accent?: string;
  greeting?: string;
}

interface ChatBake {
  enabled: boolean;
  accent?: string;
  mount: "fab" | "section" | "both";
  selfServeJoin: boolean;
  /** Business name — shown as the thread title when a visitor messages the owner. */
  title?: string;
  /** How non-members identify. "guest" (default) = name + optional email. */
  identityMode?: "guest" | "account";
  welcome?: string;
  quickReplies?: { q: string; a: string }[];
  theme?: "light" | "dark";
}

/** The per-document publish bake — every transform between sanitize and the
 *  language-cluster/seal steps, in the exact order the root document has
 *  always used. Runs for the home document AND each site page; all asset
 *  writes are hash-named + idempotent, so repeated runs share the release's
 *  assets dir. */
async function bakeDocument(
  html: string,
  ctx: BakeDocumentCtx,
  // Site-page slug this document publishes as (null = home) — forms wiring
  // uses it for page-scoped config + lead attribution.
  page: string | null = null,
): Promise<string> {
  // «La banda manda»: a SECTION module the creator placed somewhere on the site
  // ships ONLY where its band is — inserting Reservas on /citas must not also
  // publish it on home and /menu. Read off the incoming document (the same
  // source the site-wide scan used), so both halves of the rule always agree.

  const optimized = await optimizeHtmlForProduction(html);

  // Consolidate Unsplash credits BEFORE the asset migrations below. We need
  // to see the original `images.unsplash.com` URLs to detect anonymous
  // (paste-URL / template-baked) photos; after migrateUnsplashAssets rewrites
  // them to `/assets/<sha>.webp`, the Unsplash provenance is lost. Soft-fail
  // so a parse hiccup never blocks a publish.
  let migratedHtml = optimized.html;
  try {
    migratedHtml = consolidateUnsplashCredits(optimized.html).html;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[publishToDir] credit consolidation failed; using uncredited HTML", err);
  }

  // La memoria de originales del inspector es estado del editor — nunca se
  // publica (persiste solo en data.html para que el reset sobreviva sesiones).
  migratedHtml = stripDesignStash(migratedHtml);

  // Bands of DISABLED modules never ship: a persisted band whose module is
  // off has no widget to wire, so the published page showed a heading over
  // nothing (or a legacy dashed box). Runs BEFORE the module bakes; strips
  // per-publish output only — data.html keeps the band, so re-enabling the
  // module restores it on the next publish. Gates mirror the bake gates
  // (env kill-switch AND settings) so this never disagrees with what bakes.
  try {
    migratedHtml = stripDisabledModuleBands(migratedHtml, {
      collections: process.env.OPENLEN_COLLECTION !== "0" && ctx.collections?.enabled === true,
      chat: process.env.OPENLEN_CHAT !== "0" && ctx.chat?.enabled === true,
      // Reservas y Comentarios se retiraron (2026-08-21). Quedan en `false`
      // PERMANENTE a
      // propósito, no fuera del limpiador: así una banda heredada en una página
      // ya publicada se borra sola en la próxima publicación, en vez de quedarse
      // como un hueco vacío con su titular encima.
      comments: false,
      bookings: false,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[publishToDir] disabled-band strip failed; publishing as-is", err);
  }

  // ⚰️ AQUÍ SE HORNEABA LA BANDA «Mis plataformas» — una sección de tarjetas
  // con los iconos del perfil, re-rellenada en cada publicación.
  //
  // Muere el 2026-08-29, y no por deuda: era un TECHO. El prompt le enseñaba al
  // modelo que las plataformas SON esta banda, así que a quien pidiera «una
  // sección grande con mis redes» o «una página por red social» le ofrecía la
  // forma que ya conocía. La misma trampa que las conductas antes de JS libre.
  //
  // Los ENLACES siguen en el perfil del negocio: es el modelo quien decide
  // ahora cómo se ven, igual que con todo lo demás de la página.
  // Collections — bake the owner's item list as STATIC HTML. Runs BEFORE the
  // LocalFs asset migration + responsive bake so card <img>s get the same URL
  // rewrite + srcset/lazy treatment. ALWAYS called (even disabled/empty) so a
  // stray editor placeholder is stripped and never ships; only the home doc
  // (page === null) auto-appends the grid when there's no placeholder.
  if (process.env.OPENLEN_COLLECTION !== "0") {
    try {
      // Same "usable number" predicate the runtime enforces (waHref -> null
      const colCfg = ctx.collections?.enabled
        ? {
            items: ctx.collections.items,
            layout: ctx.collections.layout,
            theme: ctx.collections.theme,
          }
        : { items: [], layout: "grid" as const };
      migratedHtml = bakeCollections(migratedHtml, colCfg, page === null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[publishToDir] collections bake failed; publishing without it", err);
    }
  }

  // Datos vivos — rellena los marcadores data-ol-live desde el Google Sheet
  // del dueño en cada publicación (applyLiveData es never-throw + kill-switch
  // interno OPENLEN_LIVE_DATA). El valor va como texto ESCAPADO, así que es
  // seguro tras el sanitizer. Fallback interno → migratedHtml sin cambios.
  try {
    const live = await applyLiveData(migratedHtml, ctx.liveData?.sheetUrl ?? null);
    migratedHtml = live.html;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[publishToDir] live data bake failed; publishing without it", err);
  }

  // Move LocalFs uploads to the subdomain's shared assets dir and rewrite
  // their URLs so the web tier serves them directly.
  if (ctx.projectId) {
    try {
      migratedHtml = await migrateLocalAssets({
        html: migratedHtml,
        projectId: ctx.projectId,
        subDir: ctx.subDir,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[publishToDir] asset migration failed; using unrewritten HTML", err);
    }
  }

  // Responsive-image bake: fan <img> sources out into multi-width local
  // WebP variants + rewrite to srcset/sizes with intrinsic dimensions,
  // lazy-loading and an LCP-hero preload (Rust rewrite pass). Soft-fail.
  if (process.env.OPENLEN_IMAGE_BAKE !== "0") {
    try {
      const baked = await bakeResponsiveImages({ html: migratedHtml, subDir: ctx.subDir });
      migratedHtml = baked.html;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[publishToDir] image bake failed; publishing without responsive images", err);
    }
  }

  // Self-host Google Fonts. Soft-fail.
  if (process.env.OPENLEN_FONT_BAKE !== "0") {
    try {
      const fonts = await bakeGoogleFonts({ html: migratedHtml, subDir: ctx.subDir });
      migratedHtml = fonts.html;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[publishToDir] font bake failed; keeping Google Fonts links", err);
    }
  }

  // Cache-on-publish for Unsplash hotlinks. Failures fall back to hotlinks.
  try {
    migratedHtml = await migrateUnsplashAssets({
      html: migratedHtml,
      subDir: ctx.subDir,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[publishToDir] unsplash migration failed; using hotlinks", err);
  }

  // Wire <form>s to the OpenLen submit endpoint. Soft-fail.
  try {
    migratedHtml = wirePublishedForms(migratedHtml, ctx.sub, ctx.formConfigs, page);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[publishToDir] form wiring failed; publishing without it", err);
  }

  // Per-project logo (favicon + fallback og:image). Soft-fail.
  if (ctx.logoUrl) {
    try {
      migratedHtml = injectLogoIntoHtml({
        html: migratedHtml,
        logoUrl: ctx.logoUrl,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[publishToDir] logo injection failed; publishing without it", err);
    }
  }

  // Analytics tracker snippet — AFTER all other rewrites.
  if (ctx.projectId && ctx.analyticsEnabled) {
    migratedHtml = injectAnalyticsSnippet(migratedHtml, ctx.projectId, page);
  }

  // URL self-cleaner — strips tracking params (fbclid/utm_*) from the address
  // bar on load. Unconditional (no projectId needed); before the seal so its
  // inline-script hash is sealed into the CSP. Pure + soft-fail.
  if (process.env.OPENLEN_TRACKING_STRIP !== "0") {
    try {
      migratedHtml = injectTrackingStrip(migratedHtml);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[publishToDir] tracking-strip inject failed; publishing without it", err);
    }
  }

  // Non-null exactly when the assistant bakes its bubble — the anchor of the
  // right-corner FAB stack (18 px), so the chat and WhatsApp offsets below can
  // never disagree with what actually shipped.
  const assistantFab =
    process.env.OPENLEN_ASSISTANT !== "0" && ctx.assistant?.enabled === true
      ? ctx.assistant
      : null;
  // AI→human handoff merges the two visitor bubbles into ONE launcher. Only when
  // BOTH surfaces are on AND the chat is a guest self-serve space (handoff mints
  // a guest — invite-only/account-mode chats keep their own bubble + legacy lead
  // form). Single source of truth so the assistant CTA, the chat's FAB-less
  // handoff-target bake, and the WhatsApp stacking all agree; includes both env
  // kill switches so flipping either can't leave the chat unreachable.
  const handoffMerged =
    assistantFab !== null &&
    process.env.OPENLEN_CHAT !== "0" &&
    ctx.chat?.enabled === true &&
    ctx.chat?.selfServeJoin !== false &&
    ctx.chat?.identityMode !== "account";

  // Site assistant — visitor-facing AI chat widget. Last, so the IIFE sits
  // just before </body> after every other rewrite.
  if (assistantFab) {
    try {
      migratedHtml = bakeAssistantWidget(migratedHtml, {
        sub: ctx.sub,
        apiBase: assistantApiBase(),
        businessName: assistantFab.businessName,
        accent: assistantFab.accent,
        greeting: assistantFab.greeting,
        // Both surfaces on (mergeable) → the assistant is the single launcher and
        // hands off to the human chat (window.__openlenChat) instead of a
        // dead-end lead form.
        chatHandoff: handoffMerged,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[publishToDir] assistant widget inject failed; publishing without it", err);
    }
  }

  // Acento del sitio para los widgets brand-matched (comments/bookings/chat):
  // UN escaneo compartido — ningún bake entre estos tres toca --ol-accent
  // (Minor de la revisión del pase de superficies, 2026-07-15).
  const siteAccent = detectSiteAccent(migratedHtml) ?? undefined;

  // Private chat widget — BEFORE video-embed (so its sealed
  // script hash enters the CSP). Gated on OPENLEN_CHAT != "0" and chat.enabled.
  //
  // Single-launcher rule: when the assistant is ALSO enabled AND the chat can
  // merge into it, IT owns the one bubble and the chat bakes as a handoff
  // target — no FAB of its own, exposing window.__openlenChat so the assistant
  // can open it after an AI→human handoff. We force the FAB host to bake even
  // for mount:"section" so the openable floating panel exists. With no
  // assistant, the chat keeps its own FAB at the default corner (18 px);
  // WhatsApp (baked after) stacks above it.
  if (process.env.OPENLEN_CHAT !== "0" && ctx.chat?.enabled) {
    try {
      const handoff = handoffMerged;
      const chatMount =
        handoff && ctx.chat.mount === "section" ? "both" : ctx.chat.mount;
      migratedHtml = bakeChatWidget(migratedHtml, {
        sub: ctx.sub,
        // Two bubbles when the assistant is on but this chat can NOT merge into
        // it (account / invite-only spaces keep their own launcher): take the
        // slot above the assistant. Without this both FABs land on the same
        // pixel at the same z-index and the assistant — baked first — ends up
        // completely covered and unclickable. 68 px is the step the WhatsApp
        // stacking below already assumes for each prior FAB.
        bottomPx: !handoff && assistantFab ? 18 + 68 : 18,
        // Brand-match the widget to the page's own accent ("con el color de tu
        // página"); falls back to the widget's coral when undetectable.
        accent: ctx.chat.accent ?? siteAccent,
        mount: chatMount,
        selfServeJoin: ctx.chat.selfServeJoin,
        title: ctx.chat.title,
        identityMode: ctx.chat.identityMode,
        welcome: ctx.chat.welcome,
        quickReplies: ctx.chat.quickReplies,
        theme: ctx.chat.theme,
        chatAsHandoffTarget: handoff,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[publishToDir] chat widget inject failed; publishing without it", err);
    }
  }

  // SIETE HORNEADOS RETIRADOS el 2026-08-26 — vídeo, mapas, motion, música, 3D,
  // carrusel y conductas. Los siete existían porque el JavaScript estaba
  // prohibido: un carrusel necesita JS, y como no se le dejaba escribirlo al
  // modelo, horneábamos el NUESTRO. Los de vídeo y mapas eran el caso más
  // claro — devolvían el `<iframe>` que el saneador acababa de quitar.
  //
  // Lo que queda en esta cadena necesita SERVIDOR o datos que el modelo no
  // tiene: los formularios cableados al buzón, la analítica, el chat, las
  // colecciones, la banda de plataformas (los enlaces del perfil de negocio) y
  // el horneado de imágenes y fuentes, que el modelo no puede bajar.

  // Resource hint for self-hosted video: warm the cross-origin media host
  // (uploads/R2) so a cinema autoplay hero starts without a cold handshake.
  // No-op when there's no absolute-https <video>/<source> on the page.
  try {
    migratedHtml = bakeMediaPreconnect(migratedHtml);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[publishToDir] media preconnect bake failed; skipping", err);
  }

  // Social meta must be ABSOLUTE for crawlers — re-absolutize any og:image /
  // twitter:image / og:url that an asset migration above relativized (e.g. an
  // Unsplash hero og:image → /assets/<hash>.webp). No-op for the hosted-PNG
  // card + already-absolute heroes. MUST run after every URL rewrite above.
  try {
    migratedHtml = absolutizeSocialMeta(
      migratedHtml,
      `https://${ctx.sub}.${publishedBaseHost()}`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[publishToDir] social meta absolutize failed; skipping", err);
  }

  return migratedHtml;
}

function assistantApiBase(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://openlen.com";
}

export interface PublishResult {
  /** First 12 chars of sha256 over every release file. Stable per content. */
  sha: string;
  /** The optimized ROOT HTML actually written to disk (used by R2 backup). */
  html: string;
  /** True if a new release dir was created. False if `releases/<sha>/` already existed (idempotent re-publish). */
  written: boolean;
  /** Locale codes published as /<locale>/index.html variants. */
  locales: string[];
  /** Los que el dueño pidió y NO salieron.
   *
   *  Vacío es lo normal. Existe porque este fallo era MUDO: `localizeForPublish`
   *  cae blando por idioma y la raíz se publica igual, así que el dueño
   *  encendía tres banderas, la app le decía que fue bien, y no había ninguna
   *  traducción. Medido el 2026-08-28: la función llevaba desde su estreno sin
   *  traducir una sola página —0 filas en projectTranslations sobre 41 páginas
   *  publicadas— y nadie lo supo porque nada lo contaba.
   *
   *  Un log que nadie lee no es un aviso. Esto viaja hasta la interfaz. */
  localesFallidos: string[];
  /** Site-page slugs published as /<slug>/index.html. */
  pages: string[];
  /** Gated slugs — stub in the release, real doc under protected/<sha>/. */
  /** Documentos que salieron SIN su CSP sellada, por etiqueta ("/", "es",
   *  "/precios"). Vacío es lo normal. Antes esto se tiraba: el sellador
   *  devuelve `sealed` y la llamada se quedaba sólo con `.html`, así que una
   *  página podía publicarse sin política y nadie se enteraba jamás. */
}

/**
 * Publish `html` as a new release for `subdomain` and atomically flip the
 * `current` symlink. The release directory is content-addressed by SHA, so
 * re-publishing identical HTML is a no-op (just re-flips the symlink to the
 * same target, which is also a no-op).
 *
 * Either the new release is current, or the previous one still is. Never an
 * in-between (symlink swap via rename(2) is atomic on POSIX).
 */
/**
 * El pase terminal del release. Ya NO emite CSP —se retiró el 2026-08-26, ver
 * crates/html-engine/src/publish/seal.rs— pero sigue haciendo dos
 * endurecimientos del marcado que no son política: quita los `<base>` (una
 * etiqueta perdida secuestra TODA URL relativa de la página) y pone
 * `rel=noopener` en cada `target=_blank`.
 *
 * `unsealed` desaparece con la política, y con él `OPENLEN_CSP_SEAL=strict`.
 * Ese modo convertía «este documento salió sin CSP» en un aborto de la
 * publicación, y estaba apagado esperando el día en que una página llevara
 * JavaScript del modelo — porque entonces publicar sin política dejaba de ser
 * una pérdida y pasaba a ser un agujero. Ese día llegó y la respuesta fue la
 * contraria: quitar la jaula y acotar el daño por dominio.
 *
 * El contrato se mantiene: el pase puede fallar, la publicación nunca.
 */
function seal(html: string, label: string): string {
  try {
    return sealRelease(html).html;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[publishToDir] el endurecimiento LANZÓ en ${label}; sale tal cual`, err);
    return html;
  }
}

export async function publishToDir(
  params: PublishParams,
): Promise<PublishResult> {
  const v = validateSubdomain(params.subdomain);
  if (!v.ok) {
    throw new Error(`publishToDir: invalid subdomain (${v.reason})`);
  }
  // `data-op-id` es el OTRO marcador de modo-editor, y hasta el 2026-08-23 esta
  // puerta no lo miraba: el Agente guardó 60 de ellos en `data.html` en un
  // proyecto real y de aquí habrían salido al subdominio del usuario.
  //
  // Se QUITA en vez de rechazar, al revés que `data-slot-path`. No es indulgencia:
  // el slot-path significa que llegó un documento de una tubería que no existe
  // —no hay nada que salvar—, mientras que un op-id es un atributo inerte sobre
  // un documento por lo demás correcto. Rechazar castigaría al usuario, dejándolo
  // sin publicar, por un fallo NUESTRO aguas arriba.
  //
  // Va antes del saneador para que lo que se sella sea ya el documento limpio.
  // La cápsula no se ve afectada: su hash se comprueba en `lib/projects.ts`
  // ANTES de llegar aquí, y sirve para autorizar, no se vuelve a validar contra
  // los bytes que se escriben.
  const sinMarcadores = stripOpIds(params.html);

  // LA PUERTA, no el saneador. Lo que hay en `data.html` ya pasó por SU puerta
  // al entrar: el pegado por `from-html`, el remix por `remixProject`, el
  // cuerpo del editor por `PATCH /html`. Volver a recortarlo aquí no defendía
  // de nada — sólo garantizaba que un `<script>` legítimo no llegara jamás a la
  // página, que es exactamente por lo que existía la cápsula. Queda el rechazo
  // duro de `data-slot-path`, que sí es invariante de arquitectura.
  const sanitized = gateReservedMarker(sinMarcadores);
  if (sanitized.html === null) {
    throw new Error(
      "publishToDir: refusing to write HTML containing data-slot-path (editor-mode leaked into publish path)",
    );
  }
  const publishHtml = sanitized.html;

  const sub = v.value;
  const root = getRoot();
  const subDir = safeJoin(root, sub);
  const releasesDir = safeJoin(subDir, "releases");
  await mkdir(releasesDir, { recursive: true });

  // Where the SECTION modules are allowed to land. A band anywhere on the site
  // scopes the bake to the documents that carry one; no band anywhere keeps the
  // append-everywhere fallback. Scanned over the raw documents — the same
  // strings bakeDocument re-checks per page.
  const siteDocs = [
    params.html,
    ...(params.pages ?? []).map((p) => p.html),
  ];

  // The full per-document bake (optimize → assets → images → fonts →
  // unsplash → forms → logo → analytics → motion → music). SHA is computed
  // AFTER these rewrites so a republish with identical content still
  // dedupes to one release.
  const bakeCtx: BakeDocumentCtx = {
    sub,
    subDir,
    projectId: params.projectId,
    formConfigs: params.formConfigs,
    analyticsEnabled: params.analyticsEnabled ?? true,
    logoUrl: params.logoUrl,
    assistant: params.assistant,
    collections: params.collections,
    liveData: params.liveData,
    orders: params.orders,
    chat: params.chat,
    platforms: params.platforms,
  };
  let migratedHtml = await bakeDocument(publishHtml, bakeCtx);


  // Speak Every Language: translated locale variants of the final baked
  // page, written as /<locale>/index.html inside the same release. Soft-
  // fail — the root page always publishes; a failed locale is just absent.
  let localeDocs: Array<{ locale: string; html: string }> = [];
  if (params.buildLocaleDocs && process.env.OPENLEN_LOCALIZE !== "0") {
    try {
      localeDocs = (await params.buildLocaleDocs(migratedHtml)).filter((d) =>
        /^[a-z]{2,5}$/.test(d.locale),
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[publishToDir] localization failed; publishing root only", err);
    }
  }

  // SEO + navigation cluster: canonical on every doc; with variants, the
  // reciprocal hreflang set + the pure-<a> language switcher too.
  const baseUrl = `https://${sub}.${publishedBaseHost()}`;
  const sourceLang =
    params.sourceLang?.trim() || detectHtmlLang(migratedHtml) || "en";
  const cluster: ClusterMember[] = [
    { lang: sourceLang, path: "/" },
    ...localeDocs.map((d) => ({ lang: d.locale, path: `/${d.locale}/` })),
  ];
  migratedHtml = annotateLanguageCluster(migratedHtml, {
    baseUrl,
    selfPath: "/",
    cluster,
  });
  localeDocs = localeDocs.map((d) => ({
    locale: d.locale,
    html: annotateLanguageCluster(d.html, {
      baseUrl,
      selfPath: `/${d.locale}/`,
      cluster,
    }),
  }));

  // Seal the release: hash-locked CSP meta over the page's closed script
  // set + <base> strip + noopener, per document. MUST stay the LAST html
  // transform — any script injected after this point would be blocked by
  // the page's own policy (the pass self-checks and falls back to unsealed
  // output on drift, so a future mis-ordered injector degrades, never breaks).
  // El runtime del modelo entra AQUÍ y en ningún otro sitio: después del
  // sanitizador y de todos los bakes de primera parte, y justo antes del
  // sellado — que es quien calcula el hash de este script para meterlo en la
  // CSP. Inyectarlo después del sellado lo dejaría fuera de la política y el
  // navegador lo bloquearía; inyectarlo antes del sanitizador lo borraría.
  // Ese orden ya lo defiende behaviors-sanitize-order.test.ts para los
  // nuestros, y ahora también para éste.
  //
  // Y EN SUS VARIANTES DE IDIOMA. Una variante es la MISMA página traducida,
  // del mismo release: publicarla muda significaba que el carrito del usuario
  // funcionaba en `/` y no en `/en/`, sin nada que lo explicara. Se autoriza
  // una sola vez, contra el documento guardado; el locale es un derivado del
  // mismo modo que lo es el raíz ya horneado, que tampoco se re-verifica.
  //
  // NADA QUE INYECTAR. El `<script>` del modelo vive DENTRO de `data.html`
  // desde el 2026-08-26 y llega aquí como parte del documento, igual que su
  // `<h1>`. La inyección existía porque el saneador de más arriba lo borraba
  // primero: quitar esa pasada dejó a ésta sin trabajo — y sin ella no hace
  // falta la cápsula que decidía qué código merecía volver.
  //
  // Las variantes de idioma lo llevan solo, porque se construyen a partir de
  // este mismo documento.

  // El endurecimiento del marcado: quita los `<base>` y pone `rel=noopener`.
  // Ya no hay política que emitir ni interruptor que apagarla — ver la nota
  // sobre `seal` más arriba.
  {
    migratedHtml = seal(migratedHtml, "/");
    localeDocs = localeDocs.map((d) => ({
      locale: d.locale,
      html: seal(d.html, d.locale),
    }));
  }

  // Multi-page: bake each site page through the same chain, stamp its own
  // canonical, and seal it. A page that carries editor markers fails the
  // whole publish — half a site must never ship silently.
  const pageDocs: Array<{ slug: string; html: string }> = [];
  for (const page of params.pages ?? []) {
    // Misma cura que el documento raíz: una subpágina llega por las mismas
    // tuberías y puede traer los mismos op-ids.
    const pageSanitized = gateReservedMarker(stripOpIds(page.html));
    if (pageSanitized.html === null) {
      throw new Error(
        `publishToDir: refusing to write page /${page.slug} containing data-slot-path`,
      );
    }
    let doc = await bakeDocument(pageSanitized.html, bakeCtx, page.slug);
    doc = annotateLanguageCluster(doc, {
      baseUrl,
      selfPath: `/${page.slug}/`,
      cluster: [{ lang: sourceLang, path: `/${page.slug}/` }],
    });
    doc = seal(doc, `/${page.slug}`);
    pageDocs.push({ slug: page.slug, html: doc });
  }


  // Site pages enter the sitemap as plain entries — they are NOT language
  // alternates of home, so they stay outside the hreflang cluster.
  let sitemap = buildSitemap(baseUrl, cluster);
  if (pageDocs.length > 0) {
    const extra = pageDocs
      .map((p) => `  <url>\n    <loc>${baseUrl}/${p.slug}/</loc>\n  </url>`)
      .join("\n");
    sitemap = sitemap.replace("</urlset>", `${extra}\n</urlset>`);
  }

  // Lo ÚLTIMO que le pasa a un documento antes de ser un fichero. Cloudflare
  // reescribe los correos de lo que proxea y mete un script para descifrarlos
  // que nuestra propia CSP bloquea, así que el visitante lee el marcador de
  // Cloudflare en vez del correo del negocio. Va aquí —después de optimizar,
  // hornear y sellar— para que ningún parser posterior pueda moverlo.
  migratedHtml = optOutOfEmailObfuscation(migratedHtml);

  const releaseFiles: Array<{ path: string; content: string }> = [
    { path: "index.html", content: migratedHtml },
    ...localeDocs.map((d) => ({
      path: `${d.locale}/index.html`,
      content: optOutOfEmailObfuscation(d.html),
    })),
    ...pageDocs.map((p) => ({
      path: `${p.slug}/index.html`,
      content: optOutOfEmailObfuscation(p.html),
    })),
    { path: "sitemap.xml", content: sitemap },
    { path: "robots.txt", content: buildRobots(baseUrl) },
    {
      path: "llms.txt",
      content: buildLlmsTxt({
        html: migratedHtml,
        baseUrl,
        pages: pageDocs.map((p) => ({ slug: p.slug, title: pageTitle(p.html) })),
      }),
    },
  ];

  // Protected docs shape the sha (an edit to a gated page must mint a new
  // release) without ever entering the release dir — the __protected__/
  // prefix only exists inside this hash input.
  const sha = computeShaFiles(releaseFiles);

  const releaseDir = safeJoin(releasesDir, sha);
  let written = false;

  // Skip the write if this exact release already exists (re-publish of
  // identical content). We still flip the symlink below so the live site
  // reliably points at the latest call.
  let releaseExists = false;
  try {
    await stat(releaseDir);
    releaseExists = true;
  } catch {
    // ENOENT — first publish for this content hash.
  }

  if (!releaseExists) {
    const tmpDir = safeJoin(releasesDir, `.tmp-${sha}-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
    try {
      for (const f of releaseFiles) {
        const dst = path.join(tmpDir, f.path);
        await mkdir(path.dirname(dst), { recursive: true });
        await writeFile(dst, f.content, "utf8");
      }
      await rename(tmpDir, releaseDir);
      written = true;
    } finally {
      // If rename succeeded, tmpDir is consumed and this is a no-op.
      // If rename failed (e.g. race with another publish that won), clean
      // up the orphaned tmpdir.
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Atomically flip the current symlink. symlink(target, current.new) then
  // rename(current.new, current) is atomic across POSIX. We use a relative
  // target so the symlink survives the dir being moved (and so a `cp -a` of
  // /var/www/openlen for backup/restore preserves it).
  const currentPath = safeJoin(subDir, "current");
  const currentNew = safeJoin(subDir, `.current-${randomUUID()}.new`);
  await symlink(path.join("releases", sha), currentNew).catch(async (err) => {
    // On Windows symlinks need admin/dev-mode. In tests, fall back to a
    // marker file so the test environment still works.
    if ((err as NodeJS.ErrnoException).code === "EPERM") {
      await writeFile(currentNew, sha, "utf8");
      return;
    }
    throw err;
  });
  await rename(currentNew, currentPath);

  // Best-effort prune of old releases. Keep the RELEASES_KEEP newest by
  // mtime; never delete the one `current` points at, just in case the
  // caller is currently rolling back.
  await pruneOldReleases(releasesDir, sha).catch(() => {});

  // Keep the protected store in lockstep — drop protected/<sha> dirs whose
  // release no longer exists. Best-effort, same posture as the prune above.
  await pruneProtectedDirs(subDir, releasesDir).catch(() => {});

  return {
    sha,
    html: migratedHtml,
    written,
    locales: localeDocs.map((d) => d.locale),
    localesFallidos: (params.localesPedidos ?? []).filter(
      (code) => !localeDocs.some((d) => d.locale === code),
    ),
    pages: pageDocs.map((p) => p.slug),
  };
}

/** Remove protected/<sha> dirs whose release was pruned. The release set is
 *  the source of truth; anything protected without a matching release is
 *  unreachable (getCurrentReleaseSha can never name it). */
async function pruneProtectedDirs(
  subDir: string,
  releasesDir: string,
): Promise<void> {
  const protectedRoot = path.join(subDir, "protected");
  let names: string[];
  try {
    names = await readdir(protectedRoot);
  } catch {
    return; // no protected dir — site has no gated pages
  }
  let releaseNames: Set<string>;
  try {
    releaseNames = new Set(await readdir(releasesDir));
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((n) => !n.startsWith(".") && !releaseNames.has(n))
      .map((n) =>
        rm(path.join(protectedRoot, n), { recursive: true, force: true }).catch(
          () => {},
        ),
      ),
  );
}

/** Read a gated page's protected document for the CURRENT release. Null when
 *  the sub isn't published, the slug is malformed, or this sha has no
 *  protected doc for the page (e.g. rolled back to a pre-gating release). */
export async function readProtectedPage(
  subdomain: string,
  slug: string,
): Promise<string | null> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) return null;
  const s = validatePageSlug(slug);
  if (!s.ok || s.slug !== slug) return null;
  const sha = await getCurrentReleaseSha(v.value);
  if (!sha) return null;
  const file = safeJoin(getRoot(), v.value, "protected", sha, slug, "index.html");
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Roll back the live site for `subdomain` to a prior release. Just flips
 * the `current` symlink — no HTML regeneration. Caller is responsible for
 * updating `projects.publishedHtml` + cache purge.
 */
export async function rollbackToSha(
  subdomain: string,
  sha: string,
): Promise<void> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) {
    throw new Error(`rollbackToSha: invalid subdomain (${v.reason})`);
  }
  if (!/^[a-f0-9]{1,64}$/.test(sha)) {
    throw new Error("rollbackToSha: invalid sha");
  }

  const root = getRoot();
  const subDir = safeJoin(root, v.value);
  const releaseDir = safeJoin(subDir, "releases", sha);
  try {
    await stat(releaseDir);
  } catch {
    throw new ReleaseNotFoundError(v.value, sha);
  }

  const currentPath = safeJoin(subDir, "current");
  const currentNew = safeJoin(subDir, `.current-${randomUUID()}.new`);
  await symlink(path.join("releases", sha), currentNew).catch(async (err) => {
    if ((err as NodeJS.ErrnoException).code === "EPERM") {
      await writeFile(currentNew, sha, "utf8");
      return;
    }
    throw err;
  });
  await rename(currentNew, currentPath);
}

/**
 * Read the HTML of a specific release. Used by the rollback handler to
 * sync `projects.publishedHtml` with the on-disk content.
 */
export async function readRelease(
  subdomain: string,
  sha: string,
): Promise<string> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) {
    throw new Error(`readRelease: invalid subdomain (${v.reason})`);
  }
  if (!/^[a-f0-9]{1,64}$/.test(sha)) {
    throw new Error("readRelease: invalid sha");
  }
  const root = getRoot();
  const file = safeJoin(root, v.value, "releases", sha, "index.html");
  try {
    return await readFile(file, "utf8");
  } catch {
    throw new ReleaseNotFoundError(v.value, sha);
  }
}

export interface ReleaseSummary {
  sha: string;
  mtime: Date;
  isCurrent: boolean;
}

/**
 * List releases for a subdomain (newest first by mtime). Used by the
 * "Previous deploys" UI in TopBar.
 */
export async function listReleases(
  subdomain: string,
): Promise<ReleaseSummary[]> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) return [];
  const root = getRoot();
  const releasesDir = safeJoin(root, v.value, "releases");
  let names: string[];
  try {
    names = await readdir(releasesDir);
  } catch {
    return [];
  }
  const currentSha = await getCurrentReleaseSha(v.value);
  const items = await Promise.all(
    names
      .filter((n) => !n.startsWith("."))
      .map(async (sha) => {
        try {
          const s = await stat(path.join(releasesDir, sha));
          if (!s.isDirectory()) return null;
          return { sha, mtime: s.mtime, isCurrent: sha === currentSha };
        } catch {
          return null;
        }
      }),
  );
  return items
    .filter((x): x is ReleaseSummary => x !== null)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/**
 * Resolve the SHA the `current` symlink points at. Returns null if the
 * symlink doesn't exist (subdomain never published or unpublished).
 */
export async function getCurrentReleaseSha(
  subdomain: string,
): Promise<string | null> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) return null;
  const root = getRoot();
  const currentPath = safeJoin(root, v.value, "current");
  try {
    const target = await readlink(currentPath);
    // target is like "releases/abc123def456"
    const m = target.match(/(?:^|[\\/])releases[\\/](.+)$/);
    return m ? m[1] : null;
  } catch {
    // Fallback for the EPERM marker-file path (Windows test env).
    try {
      const content = await readFile(currentPath, "utf8");
      const trimmed = content.trim();
      return /^[a-f0-9]{1,64}$/.test(trimmed) ? trimmed : null;
    } catch {
      return null;
    }
  }
}

/**
 * Remove the entire subdomain directory (including all historical
 * releases). Idempotent. Called by `unpublishProject`.
 */
export async function unpublishDir(subdomain: string): Promise<void> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) {
    throw new Error(`unpublishDir: invalid subdomain (${v.reason})`);
  }
  const dir = safeJoin(getRoot(), v.value);
  await rm(dir, { recursive: true, force: true });
}

/**
 * Drop a single site page from the LIVE release so the deleted subpage stops
 * serving immediately (Caddy 404s `<sub>/<slug>/`). The live site is
 * `<sub>/current` → `releases/<sha>/`; we remove the slug dir under it. Prior
 * releases are untouched, so a rollback can still restore the page. Idempotent.
 * Called by the page-delete route. Best-effort: the caller soft-fails.
 */
export async function unpublishPageDir(
  subdomain: string,
  slug: string,
): Promise<void> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) {
    throw new Error(`unpublishPageDir: invalid subdomain (${v.reason})`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) {
    throw new Error(`unpublishPageDir: invalid slug (${slug})`);
  }
  const pageDir = safeJoin(getRoot(), v.value, "current", slug);
  await rm(pageDir, { recursive: true, force: true });
}

/**
 * Sweep stale tmp dirs under each subdomain. Called once at app startup
 * (instrumentation.ts).
 */
export async function cleanupStaleTmpDirs(): Promise<void> {
  const root = getRoot();
  let subs: string[];
  try {
    subs = await readdir(root);
  } catch {
    return;
  }
  const cutoff = Date.now() - 60 * 60 * 1000;
  await Promise.all(
    subs.map(async (sub) => {
      if (sub.startsWith(".") || sub === "_default") return;
      const releasesDir = path.join(root, sub, "releases");
      let entries: string[];
      try {
        entries = await readdir(releasesDir);
      } catch {
        return;
      }
      await Promise.all(
        entries
          .filter((n) => n.startsWith(".tmp-") || n.startsWith(".current-"))
          .map(async (name) => {
            const full = path.join(releasesDir, name);
            try {
              const s = await stat(full);
              if (s.mtimeMs < cutoff) {
                await rm(full, { recursive: true, force: true });
              }
            } catch {
              // Race or already gone.
            }
          }),
      );
    }),
  );
}

async function pruneOldReleases(
  releasesDir: string,
  protectSha: string,
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(releasesDir);
  } catch {
    return;
  }
  const entries = await Promise.all(
    names
      .filter((n) => !n.startsWith("."))
      .map(async (sha) => {
        try {
          const s = await stat(path.join(releasesDir, sha));
          if (!s.isDirectory()) return null;
          return { sha, mtimeMs: s.mtimeMs };
        } catch {
          return null;
        }
      }),
  );
  const valid = entries.filter(
    (x): x is { sha: string; mtimeMs: number } => x !== null,
  );
  if (valid.length <= RELEASES_KEEP) return;
  valid.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const toDelete = valid.slice(RELEASES_KEEP).filter((x) => x.sha !== protectSha);
  await Promise.all(
    toDelete.map((x) =>
      rm(path.join(releasesDir, x.sha), { recursive: true, force: true }).catch(
        () => {},
      ),
    ),
  );
}
