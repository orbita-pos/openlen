// TypeScript shim over the Rust `@openlen/html-engine` napi-rs binding.
//
// Why this file exists: napi-rs serializes `Option<T>` as an *absent
// property* in struct returns (`undefined` in JS), and existing TS consumers
// in this repo (lib/html-ops.ts, lib/publish/optimize-html.ts, etc.) treat
// `null` as the canonical "no result" sentinel — never `undefined`. This
// wrapper normalises `undefined` → `null` at every call site that has an
// Option<T> on the Rust side, so consumers can rely on `result.html === null`
// without writing `?? null` themselves.
//
// Public surface for the Motor HTML cutover (F1 S9): every TS consumer that
// used to live behind `lib/shadow-soak.ts` now imports from here directly.
// `lib/shadow-soak.ts` is kept as reusable infrastructure for future
// TS → Rust migrations. The HtmlStream class is re-exported verbatim — its
// constructor/write/end signatures don't touch Option<T>.
//
// Build prerequisite: `cd crates/html-engine && npm run build` must have
// produced `index.js` + `index.d.ts` for this module to type-check.

import {
  applyOps as rustApplyOps,
  buildScopedView as rustBuildScopedView,
  applyPhotoSlots as rustApplyPhotoSlots,
  consolidateUnsplashCredits as rustConsolidateUnsplashCredits,
  ensureThemeScripts as rustEnsureThemeScripts,
  extractLogo as rustExtractLogo,
  extractPhotoSlots as rustExtractPhotoSlots,
  extractTranslatables as rustExtractTranslatables,
  HtmlStream as RustHtmlStream,
  injectLogo as rustInjectLogo,
  normalizeBornCanonical as rustNormalizeBornCanonical,
  optimizeForPublish as rustOptimizeForPublish,
  outerHtmlByOpId as rustOuterHtmlByOpId,
  parseOps as rustParseOps,
  reinjectTranslatables as rustReinjectTranslatables,
  rejectDocumentWideOps as rustRejectDocumentWideOps,
  resolveOpIdByPath as rustResolveOpIdByPath,
  rewriteResponsiveImages as rustRewriteResponsiveImages,
  roundTrip as rustRoundTrip,
  sanitizeForPublish as rustSanitizeForPublish,
  sealRelease as rustSealRelease,
  stripOpIds as rustStripOpIds,
  tagWithOpIds as rustTagWithOpIds,
  wirePublishedForms as rustWirePublishedForms,
} from "@openlen/html-engine";

import { extractTwConfig, injectTwCarrier } from "@/lib/publish/tw-config";

import type {
  ApplyError as RustApplyError,
  ApplyResult as RustApplyResult,
  ConsolidationResult as RustConsolidationResult,
  HtmlStreamOpts,
  HtmlStreamRemovedCounts,
  HtmlStreamResult,
  Op as RustOp,
  OptimizeResult as RustOptimizeResult,
  OptimizeStats,
  ParseResult as RustParseResult,
  RejectResult as RustRejectResult,
  PhotoApplyResult as RustPhotoApplyResult,
  PhotoAssignment as RustPhotoAssignment,
  PhotoSlot as RustPhotoSlot,
  ResponsiveImageEntry,
  RewriteImagesResult as RustRewriteImagesResult,
  SanitizeRemovedCounts,
  SanitizeResult as RustSanitizeResult,
  SealResult,
  ScopedView,
  TaggedHtmlResult,
  UnsplashCredit as RustUnsplashCredit,
  WireFormConfig,
} from "@openlen/html-engine";

// ─── Re-exported types ──────────────────────────────────────────────────────
//
// All types are pass-through except those that contain an `Option<String>`
// field — those get a shape with `string | null` instead of `string |
// undefined` so callers can use the canonical null-sentinel pattern.

export type {
  HtmlStreamOpts,
  HtmlStreamRemovedCounts,
  HtmlStreamResult,
  OptimizeStats,
  ResponsiveImageEntry,
  SanitizeRemovedCounts,
  ScopedView,
  SealResult,
  TaggedHtmlResult,
  WireFormConfig,
};

// ─── F1.5 publish-time types ────────────────────────────────────────────────

export interface ExtractedLogo {
  href: string;
  isDataUri: boolean;
}

export interface UnsplashCredit {
  author: string;
  authorUrl: string;
}

export interface ConsolidationResult {
  html: string;
  credits: UnsplashCredit[];
  anonymousUnsplashCount: number;
}

export interface SanitizeResult {
  html: string | null;
  errors: string[];
  removed: SanitizeRemovedCounts;
}

export interface OptimizeResult {
  html: string | null;
  errors: string[];
  stats: OptimizeStats;
}

export interface OpAttr {
  name: string;
  /** `null` QUITA el atributo. La cadena vacía lo ESCRIBE (`data-ol-reink=""`
   *  es como la re-tinta anota «este elemento no tenía color propio»). */
  value: string | null;
}

export interface Op {
  type: string;
  target: string;
  newHtml?: string;
  /** Sólo para `type: "attrs"`. */
  attrs?: OpAttr[];
}

export interface ApplyError {
  opIndex: number;
  op: string;
  target: string;
  reason: string;
}

export interface ApplyResult {
  html: string | null;
  errors: ApplyError[];
  appliedCount: number;
}

export interface ParseResult {
  ops: Op[];
  errors: string[];
}

// ─── Plain re-exports (no shim needed) ─────────────────────────────────────

export function roundTrip(html: string): string {
  return rustRoundTrip(html);
}

export function normalizeBornCanonical(html: string): string {
  return rustNormalizeBornCanonical(html);
}

export function stripOpIds(html: string): string {
  return rustStripOpIds(html);
}

export function tagWithOpIds(html: string): TaggedHtmlResult {
  return rustTagWithOpIds(html);
}

export function parseOps(rawHtml: string): ParseResult {
  const r = rustParseOps(rawHtml) as RustParseResult;
  return {
    ops: r.ops.map(opFromRust),
    errors: r.errors,
  };
}

// ─── Shimmed exports (Option<T> → null) ────────────────────────────────────
//
// Each function below pulls the underlying napi result and replaces any
// `undefined` Option field with `null`. The transformation is structural,
// not behavioral — values that are present pass through verbatim.

export function sanitizeForPublish(html: string): SanitizeResult {
  // La paleta del tailwind.config viaja como DATOS, no como JS: se extrae y
  // valida ANTES del sanitize de Rust (que mataría el script) y se re-inyecta
  // como carrier generado por nosotros DESPUÉS. Sin esto, 53/450 templates
  // (y las generaciones donde el modelo emite config) pierden sus colores al
  // clonar — fondos desaparecidos, blanco-sobre-blanco, hovers rotos
  // (cazado 2026-07-17). Ver lib/publish/tw-config.ts.
  const { html: pre, extend } = extractTwConfig(html);
  const r = rustSanitizeForPublish(pre) as RustSanitizeResult;
  const clean = r.html ?? null;
  // Reparación de tema (bug 2026-07-29): el strip de Rust mata los
  // <script data-ol-{radius,space,type}> pero sus <style> hermanos sobreviven
  // — sin esto cada save/publish dejaba las utilities del editor sin mapeo
  // var() y los sliders Tier-3 morían en silencio. Repair-only con bytes
  // canónicos del crate: nunca inyecta en documentos sin marcadores (el
  // scrape de autofill pasa por aquí), y un script forjado con el mismo
  // atributo ya murió en el strip de arriba — el sanitizer no se relajó.
  const healed = clean !== null ? rustEnsureThemeScripts(clean) : null;
  const out =
    healed !== null && extend !== null ? injectTwCarrier(healed, extend) : healed;
  // `removed` es lo que el llamador PERDIÓ, no lo que la capa de Rust tocó a
  // media tubería: el conteo crudo cobraba los tres carriers que la reparación
  // de arriba acaba de devolver, y el gate creativo se lo decía al modelo como
  // "3 script element(s) were removed" en cada patch desde el 2º turno
  // (`warningsFor`), igual que `sanitizeAviso` al Agente. Se descuenta SOLO el
  // carrier que volvió idéntico: uno forjado vuelve con bytes canónicos, o sea
  // que sí perdió su contenido y tiene que seguir contando.
  const removed = out === null
    ? r.removed
    : { ...r.removed, scripts: Math.max(0, r.removed.scripts - healedThemeCarriers(pre, out)) };
  // Defensa en profundidad del invariante slot-path: como el config script se
  // extrajo ANTES del gate de Rust, el marcador no pasó por él. El validador
  // del extend ya rechaza data-slot-path en claves y valores; este guard final
  // es el cinturón: si por lo que sea el marcador aparece en la salida, se
  // rechaza el documento entero (jamás llega a disco NI a la DB).
  if (out !== null && out.includes("data-slot-path=")) {
    return { html: null, errors: [...r.errors, "slot-path marker in output"], removed };
  }
  return { html: out, errors: r.errors, removed };
}

const THEME_CARRIERS = ["radius", "space", "type"] as const;

/** Cuerpos de TODOS los scripts que llevan el atributo, en orden. El atributo
 *  tiene que terminar ahí (`(?=[\s=/>])`) o `data-ol-radius-loquesea` contaría
 *  como carrier, y va precedido de espacio o `x-data-ol-radius` también. */
function themeCarrierBodies(html: string, name: string): string[] {
  const pattern = new RegExp(`<script\\b[^>]*\\sdata-ol-${name}(?=[\\s=/>])[^>]*>([\\s\\S]*?)</script>`, "gi");
  const bodies: string[] = [];
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) bodies.push(match[1] ?? "");
  return bodies;
}

/** Cuántos carriers volvieron intactos. Se emparejan por CUERPO y de a uno
 *  (multiconjunto), no por nombre: un documento puede traer dos scripts con el
 *  mismo atributo y la reparación devuelve uno solo, así que comparar el
 *  primero de cada lado cobraría de más según el orden del documento. */
function healedThemeCarriers(before: string, after: string): number {
  let healed = 0;
  for (const name of THEME_CARRIERS) {
    const survivors = themeCarrierBodies(after, name);
    for (const body of themeCarrierBodies(before, name)) {
      const index = survivors.indexOf(body);
      if (index === -1) continue;
      survivors.splice(index, 1);
      healed += 1;
    }
  }
  return healed;
}

export function optimizeForPublish(html: string): OptimizeResult {
  const r = rustOptimizeForPublish(html) as RustOptimizeResult;
  return {
    html: r.html ?? null,
    errors: r.errors,
    stats: r.stats,
  };
}

export function applyOps(taggedHtml: string, ops: Op[]): ApplyResult {
  const r = rustApplyOps(taggedHtml, ops.map(opToRust)) as RustApplyResult;
  return {
    html: r.html ?? null,
    errors: r.errors.map(applyErrorFromRust),
    appliedCount: r.appliedCount,
  };
}

export interface RejectResult {
  ops: Op[];
  rejected: Op[];
}

export function rejectDocumentWideOps(
  taggedHtml: string,
  ops: readonly Op[],
): RejectResult {
  const r = rustRejectDocumentWideOps(
    taggedHtml,
    ops.map(opToRust),
  ) as RustRejectResult;
  return { ops: r.ops.map(opFromRust), rejected: r.rejected.map(opFromRust) };
}

export function resolveOpIdByPath(
  taggedHtml: string,
  path: string,
): string | null {
  const r = rustResolveOpIdByPath(taggedHtml, path);
  return r ?? null;
}

/** El outerHTML EXACTO —byte a byte— del elemento con esa op-id. */
export function outerHtmlByOpId(
  taggedHtml: string,
  opId: string,
): string | null {
  return rustOuterHtmlByOpId(taggedHtml, opId) ?? null;
}

export function buildScopedView(
  taggedHtml: string,
  pinnedOpId: string,
): ScopedView | null {
  const r = rustBuildScopedView(taggedHtml, pinnedOpId);
  return r ?? null;
}

// ─── Class re-export ───────────────────────────────────────────────────────
//
// `HtmlStream` is both a runtime constructor and a TypeScript type — re-export
// it as-is. No shim layer because the class's constructor / write / end
// signatures don't surface any `Option<T>` field on JS.

export { RustHtmlStream as HtmlStream };

// ─── Higher-level helpers ──────────────────────────────────────────────────
//
// Built on the shimmed primitives above for callers that need a single-shot
// boolean instead of the full sanitize result.

/**
 * LA ÚNICA PUERTA QUE SE APLICA A TODO EL MUNDO — la nuestra incluida.
 *
 * `sanitizeForPublish` es para HTML **ajeno** — el que pega el usuario, el que
 * viene de un remix, el de una plantilla subida. Ahí borrar scripts, `on*`,
 * iframes y URLs peligrosas es lo correcto: no sabemos quién lo escribió.
 *
 * Para lo que sale de nuestro propio generador NO lo es, y ésa fue la
 * decisión de Jesús del 2026-08-26: **el código que escribe el modelo ES el
 * código de la página**. Saneárnoslo a nosotros mismos era la raíz de toda la
 * maquinaria que vino después — la cápsula con hash, el interruptor, los
 * módulos que reimplementaban a mano lo que hace un `<script>`.
 *
 * MIRA LO QUE DESAPARECE. `sanitizeForPublish` extrae la paleta del
 * `tailwind.config` ANTES de que Rust mate ese script, y luego la re-inyecta
 * como «carrier» propio. Tres pasos que existen sólo para deshacer el cuarto.
 * Si no destruimos, no hay nada que rescatar: el script del modelo se queda.
 *
 * LO QUE SÍ SE QUEDA, y es lo único: la puerta de `data-slot-path=`. Es un
 * marcador reservado del modo editor y es invariante de arquitectura — no
 * puede llegar al disco ni a la base venga de donde venga, ni siquiera de
 * nosotros. Por eso esto no es «no sanear»: es sanear lo que de verdad hay
 * que sanear.
 *
 * TAMBIÉN ES LA PUERTA DE PUBLICACIÓN. Allí el HTML ya pasó por SU puerta al
 * entrar —el pegado se saneó en `from-html`, el remix en `remixProject`, el
 * cuerpo del editor en `PATCH /html`—, así que volver a recortarlo no defiende
 * de nada: sólo garantiza que un `<script>` legítimo no llegue nunca a la
 * página. Esa segunda pasada era la razón de existir de la cápsula: el
 * publicador borraba el script del documento y volvía a inyectar el código
 * «bendecido» por un hash. Sin la pasada, no hace falta la bendición.
 */
export function gateReservedMarker(html: string): SanitizeResult {
  const nadaQuitado = {
    scripts: 0,
    eventHandlers: 0,
    dangerousUrls: 0,
    iframes: 0,
    metaRefresh: 0,
  };
  if (detectSlotPath(html)) {
    return {
      html: null,
      errors: ["data-slot-path detectado en la salida del modelo"],
      removed: nadaQuitado,
    };
  }
  // `removed` en cero no es un detalle: es la afirmación. No le hemos quitado
  // NADA. Devolver la misma forma que `sanitizeForPublish` la hace sustituible
  // donde la puerta recibe el saneador por dependencia (`HtmlGateDeps`), que
  // es como una sola línea cambia Crear, el Chat y Len a la vez.
  return { html, errors: [], removed: nadaQuitado };
}

/** Detect whether `html` contains the editor-mode `data-slot-path=` marker
 *  in any of its known variants (literal, mixed-case, entity-encoded,
 *  whitespace-around-equals). Defers to Rust's `sanitize_for_publish`
 *  slot-path gate (S3 + S5 cross-chunk scanner) which catches variants the
 *  inline `html.includes("data-slot-path=")` check misses.
 *
 *  Returns true when the gate fires. Use this everywhere the publish /
 *  ingestion paths reject editor-mode HTML — consolidates the inline call
 *  sites under one Rust-backed implementation. */
export function detectSlotPath(html: string): boolean {
  const r = sanitizeForPublish(html);
  return r.html === null;
}

// ─── F1.5 publish-time helpers ──────────────────────────────────────────────
//
// Each function here corresponds to one of the four non-Motor-HTML consumers
// F1 S9 left behind on the legacy TS parser. See
// crates/html-engine/src/publish/ for the Rust implementations and the
// per-function contracts; docs/rust-f1-5-handoff.md for the migration log.

/** Extract the page's favicon / logo URL — first `<link rel>` whose rel
 *  tokens contain "icon", or fall back to `<meta property="og:image">`.
 *  Returns null when nothing matched. The caller decides what to do with a
 *  data: URI (upload to storage vs. keep inline). */
export function extractLogo(html: string): ExtractedLogo | null {
  const r = rustExtractLogo(html);
  return r ?? null;
}

/** Bake the project's resolved logo URL into `<head>` as `<link rel="icon">`
 *  + (conditionally) `<meta property="og:image">`. Removes any existing
 *  rel="icon" / rel="shortcut" links — apple-touch-icon / mask-icon are
 *  preserved (their rel tokens are multi-char strings that don't equal
 *  either of those literals). Soft-fails to the original HTML on any
 *  no-op condition. */
export function injectLogo(html: string, logoUrl: string): string {
  return rustInjectLogo(html, logoUrl);
}

/** Defense-in-depth Unsplash attribution: harvests photographers from
 *  inline credit spans, counts anonymous (paste-URL / template-baked)
 *  Unsplash images, and injects a sr-only `<aside>` + per-credit
 *  `<meta name="image-source">` tags. Idempotent — re-running on a doc
 *  with prior artifacts strips them before writing fresh ones. */
export function consolidateUnsplashCredits(html: string): ConsolidationResult {
  const r = rustConsolidateUnsplashCredits(html) as RustConsolidationResult;
  return {
    html: r.html,
    credits: r.credits.map((c: RustUnsplashCredit) => ({
      author: c.author,
      authorUrl: c.authorUrl,
    })),
    anonymousUnsplashCount: r.anonymousUnsplashCount,
  };
}

export interface RewriteImagesResult {
  html: string;
  rewritten: number;
  lazied: number;
  heroSrc: string | null;
}

/** Rewrite manifest-matched `<img>` tags to local srcset variants with
 *  sizes / intrinsic dimensions / lazy-loading, mark the LCP hero with
 *  fetchpriority=high and inject its `<link rel=preload imagesrcset>`.
 *  Author markup wins: existing srcset / <picture> / loading / dimension
 *  attributes are never overridden. See crates/html-engine/src/publish/
 *  images.rs for the full contract. */
export function rewriteResponsiveImages(
  html: string,
  images: ResponsiveImageEntry[],
): RewriteImagesResult {
  const r = rustRewriteResponsiveImages(html, images) as RustRewriteImagesResult;
  return {
    html: r.html,
    rewritten: r.rewritten,
    lazied: r.lazied,
    heroSrc: r.heroSrc ?? null,
  };
}

export interface PhotoSlot {
  subject: string;
  hasText: boolean;
}

export interface PhotoAssignment {
  /** Largest variant → the `src`. Empty string = leave this slot untouched. */
  src: string;
  srcset: string;
  alt: string;
}

export interface PhotoApplyResult {
  html: string;
  applied: number;
}

/** Find the `[data-ol-photo]` image slots an AI-generated page marks, in
 *  document order, with each slot's subject hint + whether it has overlaid
 *  text. Pair with applyPhotoSlots, which walks the SAME order. See
 *  crates/html-engine/src/publish/photos.rs. */
export function extractPhotoSlots(html: string): PhotoSlot[] {
  return (rustExtractPhotoSlots(html) as RustPhotoSlot[]).map((s) => ({
    subject: s.subject,
    hasText: s.hasText,
  }));
}

/** Inject a curated photo into each marked slot (by document order). An
 *  empty `src` leaves that slot as its gradient placeholder. The marker
 *  attribute is always removed. */
export function applyPhotoSlots(
  html: string,
  assignments: PhotoAssignment[],
): PhotoApplyResult {
  const r = rustApplyPhotoSlots(
    html,
    assignments as RustPhotoAssignment[],
  ) as RustPhotoApplyResult;
  return { html: r.html, applied: r.applied };
}

/** Every translatable string of the document — visible text nodes plus
 *  human-facing attributes (alt/title/placeholder/aria-label, OG metas,
 *  submit values) — in document order. Pair with reinjectTranslatables,
 *  which walks the SAME order. See crates/html-engine/src/publish/
 *  translate.rs for the slot rules. */
export function extractTranslatables(html: string): string[] {
  return rustExtractTranslatables(html);
}

/** Replace the document's translatable strings with `texts` (extracted from
 *  the SAME html) and stamp `<html lang>`. Returns null when the slot count
 *  doesn't match — the caller must skip that locale rather than ship a
 *  half-translated page. */
export function reinjectTranslatables(
  html: string,
  texts: string[],
  lang: string,
): string | null {
  return rustReinjectTranslatables(html, texts, lang) ?? null;
}

/** Terminal publish pass: strips `<base>` elements and adds `rel=noopener` to
 *  `target=_blank` anchors. Neither decides anything about design.
 *
 *  🔴 CORRECTED 2026-09-01. This block described a hash-locked CSP meta
 *  (`script-src 'sha256-…'` / `'none'`, `object-src 'none'`, `base-uri 'none'`,
 *  `form-action 'self'` + the submit origin) and a self-check that returned the
 *  original html on hash drift. ALL of it went away with the policy on
 *  2026-08-26 — the header of crates/html-engine/src/publish/seal.rs says why,
 *  and says the self-check went with it ("sin hashes que emitir no hay deriva
 *  posible"). That sweep annotated the Rust side and the retired helper right
 *  below this one, but missed THIS docblock — the one every TypeScript caller
 *  reads. `SealResult.script_hashes` is still computed and still returned;
 *  nothing consumes it as a policy, and `sealed` now only means "the pass ran".
 *
 *  The old ordering rule ("MUST run after every script-injecting step") was a
 *  consequence of the hashes: a script injected afterwards would not be covered
 *  by `script-src` and the browser would block it. With no policy there is no
 *  such trap. What remains is weaker and different in kind — run it after
 *  anything that can introduce a `<base>` or a `target=_blank` anchor, or those
 *  two hardenings simply miss it. Today's single caller
 *  (lib/publish/filesystem.ts) already sits at the end of the pipeline.
 *
 *  See crates/html-engine/src/publish/seal.rs. */
export function sealRelease(html: string): SealResult {
  // Los dos extras alimentaban `form-action` y `connect-src`. La firma de Rust
  // los conserva por ahora; aquí ya no se pasan.
  return rustSealRelease(html, undefined, undefined) as SealResult;
}

/**
 * RETIRADA el 2026-08-26 con la CSP.
 *
 * Decidía el `connect-src` de la política: a dónde podía hablar el JavaScript
 * de una página publicada. Jesús ya lo había abierto a `https: wss:` el
 * 2026-08-24 —como vercel.app, netlify.app, github.io y pages.dev, que no
 * restringen ninguno— porque sin eso no se puede pedir el clima, un tipo de
 * cambio ni datos en vivo, que es la mitad de lo que hace útil el JavaScript.
 *
 * Ahora no hay política que alimentar. La página habla con quien quiera, igual
 * que cualquier página web.
 */
/** Wire every `<form>` in `html` to OpenLen's submit endpoint at `action`,
 *  baking per-form config (success message / redirect URL) keyed by
 *  document-order index, plus the inline submit-via-fetch script (once
 *  per doc). The caller pre-computes `action` from `NEXT_PUBLIC_SITE_URL +
 *  /api/f/<subdomain>` — env-var access stays TS-side. Returns the
 *  original string verbatim when the doc has no `<form>` elements. */
export function wirePublishedForms(
  html: string,
  action: string,
  configs: WireFormConfig[],
): string {
  return rustWirePublishedForms(html, action, configs);
}

// ─── Conversion helpers ────────────────────────────────────────────────────

function opFromRust(o: RustOp): Op {
  return {
    type: o.type,
    target: o.target,
    newHtml: o.newHtml ?? undefined,
    // `undefined` (el atributo se quita) vuelve como `null`, que es el
    // centinela canónico de este fichero.
    attrs: o.attrs?.map((a) => ({ name: a.name, value: a.value ?? null })),
  };
}

function opToRust(o: Op): RustOp {
  return {
    type: o.type,
    target: o.target,
    newHtml: o.newHtml ?? undefined,
    // `null` (quitar) viaja como `undefined`: napi lee los dos como `None`, y
    // ésa es justo la distinción que la op necesita frente a `""`.
    attrs: o.attrs?.map((a) => ({ name: a.name, value: a.value ?? undefined })),
  } as RustOp;
}

function applyErrorFromRust(e: RustApplyError): ApplyError {
  return {
    opIndex: e.opIndex,
    op: e.op,
    target: e.target,
    reason: e.reason,
  };
}
