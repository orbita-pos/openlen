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
} as const;
