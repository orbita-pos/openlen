// TypeScript wrapper over the Rust `@openlen/images` napi-rs binding.
//
// Why this file exists: the binding's public surface is one function —
// `processImage` — but our app-code consumers want a stable, typed API
// with rehydrated error classes (the binding throws `Error` whose
// `.message` is a JSON envelope) and a couple of opinionated presets
// that fit the upload + republish paths.
//
// Build prerequisite: `cd crates/images && npm run build` must have
// produced `index.js` + `index.d.ts` for this module to type-check —
// same contract as `@openlen/ai-gateway` and `@openlen/rate-limit`.
// The `serverExternalPackages` + `webpack.externals` entries in
// `next.config.ts` keep the native `.node` binary off the bundler graph.

import {
  processImage as nativeProcessImage,
  type ProcessRequestJs,
  type ProcessResultJs,
  type VariantOutputJs,
} from "@openlen/images";

export type ImageFormat = "webp" | "avif" | "jpeg" | "png";

export interface ProcessVariantSpec {
  /** Target max width in pixels. `0` = use the input's intrinsic width. */
  width: number;
  /** Optional companion bound on the height. When present, the variant
   *  is scaled by the SMALLER of the width and height bounds — sharp's
   *  `{ width, height, fit: 'inside' }` semantics. Omit to leave the
   *  height unbounded. */
  maxHeight?: number;
  format: ImageFormat;
  /** Encoder quality 1..=100. Ignored for PNG (lossless). */
  quality: number;
}

export interface ProcessImageOptions {
  input: Buffer;
  variants: ProcessVariantSpec[];
  /** Apply EXIF orientation before resizing. Default: true. */
  autoOrient?: boolean;
  /** Clamp target widths to the input's intrinsic width. Default: true. */
  withoutEnlargement?: boolean;
}

export interface VariantOutput {
  width: number;
  height: number;
  format: ImageFormat;
  /** IANA media type — e.g. `"image/webp"`. */
  mime: string;
  bytes: Buffer;
  size: number;
}

export interface ProcessImageResult {
  variants: VariantOutput[];
}

// ─── Typed error envelope ────────────────────────────────────────────────

export type OpenLenImageErrorKind =
  | "decode"
  | "encode"
  | "resize"
  | "invalid_input";

export class OpenLenImageError extends Error {
  constructor(
    public readonly kind: OpenLenImageErrorKind,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "OpenLenImageError";
  }
}

interface ErrorEnvelope {
  kind: OpenLenImageErrorKind;
  retryable: boolean;
  message: string;
}

function tryParseEnvelope(raw: unknown): ErrorEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const message = (raw as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const kind = (parsed as { kind?: unknown }).kind;
  const retryable = (parsed as { retryable?: unknown }).retryable;
  const msg = (parsed as { message?: unknown }).message;
  if (typeof kind !== "string" || typeof retryable !== "boolean") return null;
  return {
    kind: kind as OpenLenImageErrorKind,
    retryable,
    message: typeof msg === "string" ? msg : "",
  };
}

function rehydrateError(raw: unknown): Error {
  const env = tryParseEnvelope(raw);
  if (env) return new OpenLenImageError(env.kind, env.retryable, env.message);
  return raw instanceof Error ? raw : new Error(String(raw));
}

// ─── Public API ──────────────────────────────────────────────────────────

/** Run one decode + N variant encodes through the Rust pipeline. Async;
 *  the heavy CPU work happens inside a tokio blocking thread on the
 *  Rust side so the Node event loop stays unblocked. */
export async function processImage(
  opts: ProcessImageOptions,
): Promise<ProcessImageResult> {
  let raw: ProcessResultJs;
  try {
    const req: ProcessRequestJs = {
      input: opts.input,
      variants: opts.variants.map((v) => ({
        width: v.width,
        maxHeight: v.maxHeight,
        format: v.format,
        quality: v.quality,
      })),
      autoOrient: opts.autoOrient,
      withoutEnlargement: opts.withoutEnlargement,
    };
    raw = await nativeProcessImage(req);
  } catch (err) {
    throw rehydrateError(err);
  }
  return {
    variants: raw.variants.map((v: VariantOutputJs) => ({
      width: v.width,
      height: v.height,
      format: v.format as ImageFormat,
      mime: v.mime,
      bytes: v.bytes,
      size: v.size,
    })),
  };
}

// ─── Presets ─────────────────────────────────────────────────────────────

/** The variant set used by `/api/upload` for user-supplied images. Three
 *  widths (200/400/800) × two modern codecs (WebP + AVIF), plus one
 *  legacy fallback at the largest width so a `<picture>` element can fall
 *  through cleanly. The widths cover the common landing-page hero +
 *  card + thumbnail use cases. */
export function uploadResponsiveVariantSet(
  fallback: ImageFormat = "jpeg",
): ProcessVariantSpec[] {
  const widths = [200, 400, 800];
  const set: ProcessVariantSpec[] = [];
  for (const w of widths) {
    set.push({ width: w, format: "webp", quality: 82 });
    set.push({ width: w, format: "avif", quality: 65 });
  }
  set.push({ width: 800, format: fallback, quality: 85 });
  return set;
}

/** Pick the right legacy fallback format for a given input MIME. PNG
 *  uploads keep alpha-capable PNG fallback; everything else gets JPEG. */
export function fallbackFormatForMime(mime: string): ImageFormat {
  switch (mime) {
    case "image/png":
      return "png";
    default:
      return "jpeg";
  }
}

/** Single-variant preset matching the legacy `sharp` recipe used in
 *  `lib/publish/filesystem.ts` (Unsplash optimize) and
 *  `app/api/projects/[id]/assets/route.ts` (user-asset POST):
 *  one WebP variant at quality 85, capped at 2000 px on the longer
 *  edge (sharp's `{width:2000, height:2000, fit:'inside'}`), EXIF
 *  auto-rotate, no enlargement. Exposed as a preset so the two
 *  consumers stay in sync. */
export function legacyWebp2000Variant(): ProcessVariantSpec {
  return { width: 2000, maxHeight: 2000, format: "webp", quality: 85 };
}
