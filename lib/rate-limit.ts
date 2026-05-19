// In-memory rate limiter — token bucket per actor (typically userId).
//
// Designed for single-instance Hetzner deploys. If we ever scale to
// multiple Next.js instances, swap the Map for Redis. The API is
// instance-agnostic so callers don't need to change.
//
// Buckets reset on a sliding 1-hour window: each call decrements remaining
// tokens; tokens regenerate by (limit / windowMs) per millisecond capped at
// limit. This gives the natural "10/hour" feel: spam 10 in 30s, then wait
// 6 minutes per next token.

interface Bucket {
  /** Remaining tokens at lastRefill instant. */
  tokens: number;
  /** ms timestamp of the last refill computation. */
  lastRefill: number;
}

interface BucketSpec {
  limit: number;
  windowMs: number;
}

const buckets = new Map<string, Bucket>();

// Garbage-collect idle buckets every hour. Stops the Map from growing
// unbounded on a long-lived process.
const GC_INTERVAL_MS = 60 * 60 * 1000;
let gcStarted = false;
function startGc() {
  if (gcStarted) return;
  gcStarted = true;
  if (typeof setInterval === "undefined") return;
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now - b.lastRefill > 6 * 60 * 60 * 1000) buckets.delete(k);
    }
  }, GC_INTERVAL_MS).unref?.();
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
  startGc();
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: spec.limit - 1, lastRefill: now };
    buckets.set(key, bucket);
    return { allowed: true, remaining: bucket.tokens, retryAfterMs: 0, limit: spec.limit };
  }
  // Refill since last check.
  const elapsed = now - bucket.lastRefill;
  const refillRate = spec.limit / spec.windowMs;
  const refilled = elapsed * refillRate;
  bucket.tokens = Math.min(spec.limit, bucket.tokens + refilled);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: 0,
      limit: spec.limit,
    };
  }

  const msUntilNext = Math.ceil((1 - bucket.tokens) / refillRate);
  return {
    allowed: false,
    remaining: 0,
    retryAfterMs: msUntilNext,
    limit: spec.limit,
  };
}

/** Preset specs for the features we rate-limit today. */
export const RATE_LIMITS = {
  /** Autofill: image extraction + Kimi fill. Expensive (~\$0.002/call) but
   *  not abusive at 10/hour for free users. Adjust per pricing tier later. */
  autofill: { limit: 10, windowMs: 60 * 60 * 1000 },
} as const;
