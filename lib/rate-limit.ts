// Legacy shim — kept so existing callers keep importing `consumeToken` /
// `RATE_LIMITS` from this path. The engine lives in Rust now; see
// `lib/rate-limit-rs.ts` for the unified wrapper and
// `crates/rate-limit/` for the napi binding.
//
// History: this module used to own its own `Map<key, Bucket>` and a
// `setInterval` GC sweep. Both moved into the Rust limiter as of F4
// (commit on rust/f4-rate-limit). The per-process singleton in the
// wrapper keeps state continuity across imports.

import { tryConsumeMemory } from "./rate-limit-rs";

interface BucketSpec {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** ms until next token if not allowed; 0 if allowed. */
  retryAfterMs: number;
  /** Total limit for this bucket — useful for response headers. */
  limit: number;
}

export function consumeToken(key: string, spec: BucketSpec): RateLimitResult {
  const out = tryConsumeMemory(key, spec.limit, spec.windowMs);
  return {
    allowed: out.allowed,
    remaining: out.remaining,
    retryAfterMs: out.retryAfterMs,
    limit: out.limit,
  };
}

/** Preset specs for the features we rate-limit today. */
export const RATE_LIMITS = {
  /** Autofill: image extraction + Gemini fill. Expensive (~\$0.002/call) but
   *  not abusive at 10/hour for free users. Adjust per pricing tier later. */
  autofill: { limit: 10, windowMs: 60 * 60 * 1000 },
  /** Image / audio / logo uploads. Shared per-user budget across every
   *  image-upload endpoint (key `upload:<userId>`) so abuse can't be spread
   *  across routes. 100/hour clears a batch photo page yet caps a scripted
   *  flood at ~100 × 8 MB ≈ 800 MB/hour/user. */
  upload: { limit: 100, windowMs: 60 * 60 * 1000 },
  /** Video uploads — the biggest storage/egress lever (50 MB each). Its own
   *  key (`upload-video:<userId>`) at a much lower ceiling. */
  uploadVideo: { limit: 20, windowMs: 60 * 60 * 1000 },
  /** Same-origin image proxy for the in-place editor (fetches upstream bytes,
   *  up to 15 MB each). Own key (`proxy-image:<userId>`). Egress lever, not a
   *  storage write — 60/hour clears an editing session yet caps a scripted
   *  fetch flood at ~60 × 15 MB ≈ 900 MB/hour/user. */
  proxyImage: { limit: 60, windowMs: 60 * 60 * 1000 },
  /** Referencia visual por URL: lanza Chrome contra una web ajena Y paga una
   *  llamada de visión. Es la operación más cara por petición de todo el
   *  producto, y además nuestro servidor sale a internet a una dirección que
   *  escribe el visitante — un scraper sin tope es un proxy abierto con
   *  nuestra IP. Propio cubo (`style-ref:<userId>`), 20/hora: bastan de sobra
   *  para probar referencias mientras se diseña, y cortan un guión que
   *  intentara usarnos de rastreador. */
  styleReference: { limit: 20, windowMs: 60 * 60 * 1000 },
} as const;

function formatRetry(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.ceil(sec / 60)} min`;
}

/** Standard 429 for a blocked token-bucket result. Spanish copy to match the
 *  app's other rate-limit surfaces (autofill/curate). `noun` names what was
 *  capped ("imágenes", "videos", "archivos"). */
export function rateLimitedResponse(
  result: RateLimitResult,
  noun = "solicitudes",
): Response {
  const retryAfterSec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return new Response(
    JSON.stringify({
      error: `Rate limit excedido — máximo ${result.limit} ${noun} por hora. Probá de nuevo en ${formatRetry(retryAfterSec)}.`,
      retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(retryAfterSec),
        "x-ratelimit-limit": String(result.limit),
        "x-ratelimit-remaining": "0",
      },
    },
  );
}
