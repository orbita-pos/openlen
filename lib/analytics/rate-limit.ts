// In-memory per-IP rate limiter for the analytics collector endpoint.
//
// Sized for casual abuse, not adversaries — 100 events/min per IP is
// generous for legitimate use (a session of ~50 outbound clicks) but
// enough of a ceiling that a quick scripted flood gets dropped.
// Single-instance state; if we ever run the app on multiple Hetzner
// boxes behind a load balancer, swap this for Redis-backed limiting.
//
// Memory bound: each entry is ~80 bytes, the map is swept every N
// requests to evict windows that have aged out — practical ceiling
// is "active IPs in the last 2 minutes" which is bounded by traffic.

const LIMIT_PER_MIN = 100;
const WINDOW_MS = 60_000;
const SWEEP_EVERY = 1000;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();
let opsSinceSweep = 0;

function sweepStale(): void {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [ip, b] of buckets) {
    if (b.windowStart < cutoff) buckets.delete(ip);
  }
}

/** Returns true when the given IP has exceeded the per-minute window
 *  and should be silently dropped. Side-effecting: increments the
 *  counter on success. */
export function shouldDropForRateLimit(ip: string | null): boolean {
  if (!ip) return false; // no IP signal, can't apply per-IP limit
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.windowStart >= WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
  } else if (b.count >= LIMIT_PER_MIN) {
    return true;
  } else {
    b.count++;
  }
  opsSinceSweep++;
  if (opsSinceSweep >= SWEEP_EVERY) {
    opsSinceSweep = 0;
    sweepStale();
  }
  return false;
}

/** Resolve the most-trustworthy client IP available, in order:
 *  CF-Connecting-IP (set by Cloudflare for the original client), then
 *  X-Real-IP (set by nginx). Both null when the request didn't traverse
 *  CF/nginx — local dev hits localhost directly. */
export function getClientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}
