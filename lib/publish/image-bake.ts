// ─────────────────────────────────────────────────────────────────────────────
// Publish-time responsive-image bake.
//
// Published pages today carry single-src <img> tags (one 2000px WebP at
// best), so phones download desktop-sized heroes. This step fans every
// <img> source out into multi-width WebP variants in the subdomain's
// shared assets dir and hands the Rust `rewrite_responsive_images` pass a
// manifest to rewrite the DOM: srcset/sizes, intrinsic width/height (CLS),
// loading=lazy below the LCP hero, fetchpriority=high + <link rel=preload
// imagesrcset> on the hero itself.
//
// Byte sources, in order of preference:
//   - relative `/assets/<file>` — LocalFs uploads already migrated to disk
//     by migrateLocalAssets (read locally, no network)
//   - absolute URLs on hosts we own (images/uploads/templates.openlen.com,
//     R2 public bases) plus images.unsplash.com — fixed allowlist, so the
//     publish-time fetcher never touches arbitrary user-controlled origins
//   - las SUBIDAS DEL PROPIO DUEÑO (`…/api/projects/<id>/assets/<fichero>`),
//     leídas por la capa de almacenamiento y no por la red. Se reconocen por la
//     RUTA, no por el host: en desarrollo no hay R2 y nuestro propio subidor
//     devuelve `http://localhost:3000/…`, que nunca podrá estar en la lista de
//     arriba. Sin esta rama esa URL salía TAL CUAL al HTML publicado —imagen
//     rota para cualquier visitante, y en silencio— y el Agente se negaba a
//     colocar las fotos del dueño por ese motivo, con razón (2026-08-27).
//     También cubre una instalación autoalojada con dominio propio, que hoy
//     chocaba con la misma lista.
// Everything else (foreign hotlinks, data URIs, SVG/GIF) passes through
// untouched.
//
// Runs BEFORE migrateUnsplashAssets so Unsplash heroes are encoded from the
// original bytes (one lossy hop, not two); whatever this step rewrites no
// longer matches the Unsplash regex, and non-<img> refs (CSS url(),
// og:image) still get localized by that legacy step.
//
// Variants are content-addressed by a hash of the SOURCE bytes with a
// `<hash>.bake.json` sidecar, so a republish skips both the encode and the
// writes. AVIF is deliberately out of v1: on the single prod box it would
// add tens of seconds to an image-heavy Deploy for a marginal win over
// right-sized WebP.
//
// Safety contract mirrors the Tailwind bake: every failure path — fetch,
// decode, encode, disk — degrades to the original markup for that image,
// and the caller wraps the whole step in try/catch. Publish is never
// blocked.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";


import {
  rewriteResponsiveImages,
  type ResponsiveImageEntry,
} from "@/lib/html-engine";
import { processImage } from "@/lib/images";

const BAKE_WIDTHS = [400, 800, 1400, 2000];
const WEBP_QUALITY = 82;
// AVIF at q65 matches the proven upload-path quality (no blur complaints) and
// is ~20-30% smaller than the WebP@82 it sits in front of via <picture>.
const AVIF_QUALITY = 65;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
// v2: the variant set now also bakes AVIF; the bump invalidates v1 (WebP-only)
// sidecars so existing pages pick up AVIF on their next publish.
const SIDECAR_VERSION = 2;

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const SRCSET_ATTR_RE = /\bsrcset\s*=/i;

/** Same conservative entity set as the Unsplash migration in filesystem.ts —
 *  only what realistically appears inside an attribute URL. */
function decodeHtmlEntitiesInUrl(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/");
}

function hostOf(base: string | undefined): string | null {
  if (!base) return null;
  try {
    return new URL(base).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function allowedRemoteHosts(): Set<string> {
  const hosts = new Set([
    "images.unsplash.com",
    "images.openlen.com",
    "uploads.openlen.com",
    "templates.openlen.com",
  ]);
  for (const base of [
    process.env.R2_PUBLIC_URL,
    process.env.R2_IMAGES_PUBLIC_URL,
    process.env.R2_TEMPLATES_PUBLIC_URL,
  ]) {
    const h = hostOf(base);
    if (h) hosts.add(h);
  }
  return hosts;
}

export type Source =
  | { kind: "local"; file: string }
  | { kind: "remote"; url: string }
  /** Una subida del PROPIO usuario, por nuestra capa de almacenamiento. */
  | { kind: "propia"; projectId: string; filename: string };

/**
 * `…/api/projects/<id>/assets/<fichero>` — una imagen que el dueño subió por
 * OpenLen, venga del host que venga.
 *
 * EL FALLO QUE CIERRA. En desarrollo no hay R2, así que nuestro propio subidor
 * devuelve `http://localhost:3000/api/projects/…`. Ese host no está —ni puede
 * estar— en la lista de hosts remotos permitidos, así que el horneado lo
 * ignoraba y la URL salía TAL CUAL al HTML publicado: imagen rota para
 * cualquier visitante, y sin que nadie lo dijera (el flight-check mide
 * velocidad, no imágenes).
 *
 * MEDIDO el 2026-08-27: Jesús adjuntó una foto suya y el Agente se negó a
 * colocarla explicándole que esa URL «sólo existe en tu máquina». Tenía razón en
 * el fondo — y el remedio que ofrecía, «súbela desde el tab Contenido», es el
 * MISMO subidor y daba la misma URL. El defecto era nuestro.
 *
 * Se reconoce por la RUTA, no por el host: así vale para localhost en dev, para
 * una instalación autoalojada con dominio propio —que hoy choca con la misma
 * lista— y para el día que el host cambie. Los bytes se leen por la capa de
 * almacenamiento, no por la red: están en nuestro disco, y salir a buscarlos
 * por HTTP era el rodeo que fallaba.
 */
const RUTA_ASSET_PROPIO = /^\/api\/projects\/([^/]+)\/assets\/([^/?#]+)$/;

/** Classify an entity-decoded <img src> URL into a byte source, or null when
 *  it's out of scope (foreign host, data URI, SVG/GIF, traversal-shaped). */
export function classifySource(url: string): Source | null {
  if (url.startsWith("/assets/")) {
    const file = url.slice("/assets/".length).split(/[?#]/)[0];
    if (!/^[A-Za-z0-9._-]+$/.test(file) || file.includes("..")) return null;
    if (/\.(svg|gif)$/i.test(file)) return null;
    return { kind: "local", file };
  }
  if (/^https?:\/\//i.test(url)) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    // NUESTRA propia subida, por la ruta y no por el host — ver
    // RUTA_ASSET_PROPIO. Va ANTES de la lista de hosts a propósito: en
    // desarrollo el host es `localhost`, que nunca estará en ella.
    const propio = RUTA_ASSET_PROPIO.exec(u.pathname);
    if (propio) {
      if (/\.(svg|gif)$/i.test(u.pathname)) return null;
      return { kind: "propia", projectId: propio[1]!, filename: propio[2]! };
    }
    if (!allowedRemoteHosts().has(u.hostname.toLowerCase())) return null;
    if (/\.(svg|gif)$/i.test(u.pathname)) return null;
    return { kind: "remote", url };
  }
  return null;
}

/** Scan raw HTML for <img> tags without an author srcset and return their
 *  entity-decoded src values, deduped, in document order. Pure — exported
 *  for unit tests. */
export function collectImgSrcCandidates(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  IMG_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_TAG_RE.exec(html)) !== null) {
    const tag = m[0];
    if (SRCSET_ATTR_RE.test(tag)) continue;
    const src = SRC_ATTR_RE.exec(tag);
    const raw = src?.[1] ?? src?.[2];
    if (!raw) continue;
    const decoded = decodeHtmlEntitiesInUrl(raw.trim());
    if (!decoded || seen.has(decoded)) continue;
    seen.add(decoded);
    out.push(decoded);
  }
  return out;
}

function looksLikeGifOrSvg(bytes: Buffer): boolean {
  if (bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "GIF8") return true;
  const head = bytes.toString("utf8", 0, Math.min(bytes.length, 256)).trimStart();
  return head.startsWith("<svg") || head.startsWith("<?xml");
}

async function resolveBytes(
  source: Source,
  assetsDir: string,
): Promise<Buffer | null> {
  if (source.kind === "local") {
    try {
      const bytes = await readFile(path.join(assetsDir, source.file));
      return bytes.length > 0 && bytes.length <= MAX_SOURCE_BYTES ? bytes : null;
    } catch {
      return null;
    }
  }
  if (source.kind === "propia") {
    // Por la capa de almacenamiento: los bytes están en NUESTRO disco (o en
    // nuestro bucket), así que ir a buscarlos por HTTP es dar un rodeo que
    // depende de que el propio servidor se pueda alcanzar a sí mismo — que es
    // justo lo que falla en desarrollo.
    try {
      // Import PEREZOSO: `lib/projects/assets` es `server-only`, y este módulo
      // lo importan sitios que no lo son. Traerlo sólo cuando de verdad hay una
      // subida propia que hornear deja el resto del fichero como estaba.
      const { getAssetStorage } = await import("@/lib/projects/assets");
      const encontrado = await getAssetStorage().get(source.projectId, source.filename);
      if (!encontrado) return null;
      const bytes = encontrado.contents;
      return bytes.length > 0 && bytes.length <= MAX_SOURCE_BYTES ? bytes : null;
    } catch {
      return null;
    }
  }
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(source.url, {
        redirect: "follow",
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_SOURCE_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

interface VariantMeta {
  file: string;
  width: number;
}

interface BakeMeta {
  /** Intrinsic dimensions of the largest variant (aspect-ratio source). */
  width: number;
  height: number;
  variants: VariantMeta[];
  /** AVIF variants (same widths); empty when AVIF encoding was unavailable. */
  avifVariants: VariantMeta[];
}

async function readSidecar(
  sidecarPath: string,
  assetsDir: string,
): Promise<BakeMeta | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(sidecarPath, "utf8"));
  } catch {
    return null;
  }
  const p = parsed as {
    v?: unknown;
    width?: unknown;
    height?: unknown;
    variants?: unknown;
    avifVariants?: unknown;
  };
  if (
    p?.v !== SIDECAR_VERSION ||
    typeof p.width !== "number" ||
    typeof p.height !== "number" ||
    !Array.isArray(p.variants) ||
    p.variants.length === 0
  ) {
    return null;
  }
  const parseMetas = (raw: unknown): VariantMeta[] | null => {
    if (!Array.isArray(raw)) return null;
    const out: VariantMeta[] = [];
    for (const v of raw as { file?: unknown; width?: unknown }[]) {
      if (typeof v?.file !== "string" || typeof v?.width !== "number") return null;
      if (!/^[A-Za-z0-9._-]+$/.test(v.file)) return null;
      out.push({ file: v.file, width: v.width });
    }
    return out;
  };
  const variants = parseMetas(p.variants);
  if (!variants || variants.length === 0) return null;
  // avifVariants may legitimately be absent/empty (AVIF unavailable that run).
  const avifVariants = p.avifVariants === undefined ? [] : parseMetas(p.avifVariants);
  if (avifVariants === null) return null;
  // All referenced files must still exist — a pruned/partial assets dir
  // invalidates the sidecar and forces a re-encode.
  try {
    await Promise.all(
      [...variants, ...avifVariants].map((v) => stat(path.join(assetsDir, v.file))),
    );
  } catch {
    return null;
  }
  return { width: p.width, height: p.height, variants, avifVariants };
}

/** Encode (or reuse) the multi-width variant set for one source image and
 *  return its metadata. Content-addressed by source-byte hash; the sidecar
 *  makes republished pages skip the encode entirely. */
async function ensureVariants(
  bytes: Buffer,
  assetsDir: string,
): Promise<BakeMeta | null> {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const sidecarPath = path.join(assetsDir, `${hash}.bake.json`);
  const cached = await readSidecar(sidecarPath, assetsDir);
  if (cached) return cached;

  const { variants } = await processImage({
    input: bytes,
    // WebP (fallback) + AVIF (the <picture> winner) at every width, one decode.
    variants: BAKE_WIDTHS.flatMap((w) => [
      { width: w, format: "webp" as const, quality: WEBP_QUALITY },
      { width: w, format: "avif" as const, quality: AVIF_QUALITY },
    ]),
    autoOrient: true,
    withoutEnlargement: true,
  });

  // withoutEnlargement clamps targets to the intrinsic width, so a small source
  // produces duplicate widths — keep one variant per (format, width), ascending.
  const collect = (fmt: "webp" | "avif") => {
    const byWidth = new Map<number, (typeof variants)[number]>();
    for (const v of variants) {
      if (v.format === fmt && !byWidth.has(v.width)) byWidth.set(v.width, v);
    }
    return [...byWidth.values()].sort((a, b) => a.width - b.width);
  };
  const write = async (
    uniques: typeof variants,
    fmt: "webp" | "avif",
  ): Promise<VariantMeta[]> => {
    const metas: VariantMeta[] = [];
    for (const v of uniques) {
      const file = `${hash}-${v.width}w.${fmt}`;
      const dst = path.join(assetsDir, file);
      try {
        await stat(dst);
      } catch {
        await writeFile(dst, v.bytes);
      }
      metas.push({ file, width: v.width });
    }
    return metas;
  };

  const webpUnique = collect("webp");
  if (webpUnique.length === 0) return null;
  const variantsMeta = await write(webpUnique, "webp");
  // AVIF is best-effort: if the encoder produced none, we still ship WebP.
  const avifVariants = await write(collect("avif"), "avif");

  const largest = webpUnique[webpUnique.length - 1];
  const meta: BakeMeta = {
    width: largest.width,
    height: largest.height,
    variants: variantsMeta,
    avifVariants,
  };
  await writeFile(
    sidecarPath,
    JSON.stringify({ v: SIDECAR_VERSION, ...meta }),
  );
  return meta;
}

export interface ImageBakeResult {
  html: string;
  /** <img> tags rewritten to local srcset variants. */
  rewritten: number;
  /** Images that gained loading="lazy". */
  lazied: number;
  /** Original src of the detected LCP hero, when one was found. */
  heroSrc: string | null;
}

/**
 * Fan <img> sources out into local multi-width WebP variants and rewrite
 * the HTML to serve them responsively. Per-image failures degrade to the
 * original markup; an empty manifest returns the input verbatim.
 */
export async function bakeResponsiveImages(params: {
  html: string;
  subDir: string;
}): Promise<ImageBakeResult> {
  const { html, subDir } = params;
  const unchanged: ImageBakeResult = {
    html,
    rewritten: 0,
    lazied: 0,
    heroSrc: null,
  };

  const candidates = collectImgSrcCandidates(html)
    .map((url) => ({ url, source: classifySource(url) }))
    .filter((c): c is { url: string; source: Source } => c.source !== null);
  if (candidates.length === 0) return unchanged;

  const assetsDir = path.join(subDir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const entries = (
    await Promise.all(
      candidates.map(async ({ url, source }): Promise<ResponsiveImageEntry | null> => {
        try {
          const bytes = await resolveBytes(source, assetsDir);
          if (!bytes || looksLikeGifOrSvg(bytes)) return null;
          const meta = await ensureVariants(bytes, assetsDir);
          if (!meta) return null;
          const largest = meta.variants[meta.variants.length - 1];
          return {
            src: url,
            fallbackSrc: `/assets/${largest.file}`,
            srcset: meta.variants
              .map((v) => `/assets/${v.file} ${v.width}w`)
              .join(", "),
            width: meta.width,
            height: meta.height,
            // Present → the Rust pass wraps this <img> in a <picture> with an
            // AVIF <source>; absent → the WebP <img srcset> path is used.
            avifSrcset: meta.avifVariants.length
              ? meta.avifVariants
                  .map((v) => `/assets/${v.file} ${v.width}w`)
                  .join(", ")
              : undefined,
          };
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[image-bake] variant generation failed", url, err);
          return null;
        }
      }),
    )
  ).filter((e): e is ResponsiveImageEntry => e !== null);
  if (entries.length === 0) return unchanged;

  const r = rewriteResponsiveImages(html, entries);
  return {
    html: r.html,
    rewritten: r.rewritten,
    lazied: r.lazied,
    heroSrc: r.heroSrc,
  };
}
