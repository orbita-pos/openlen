// Per-IP rate limiter for the analytics collector endpoint.
//
// 100 events/min per IP — generous enough for legit traffic (~50 outbound
// clicks in a session) but firm enough to drop scripted floods. The engine
// lives in the Rust limiter (`@openlen/rate-limit` / `lib/rate-limit-rs.ts`);
// this module keeps `shouldDropForRateLimit` + `getClientIp` as the
// invariant call sites import.
//
// History: this file used to own its own `Map<ip, { count, windowStart }>`
// + sweep loop. Replaced with the shared Rust token bucket in F4 so all
// per-process limit state lives in one place. Behaviour is close-enough
// at the ceiling — token bucket continuous refill vs. hard-count discrete
// reset — for an anti-spam guard. Documented in the F4 handoff.

import { tryConsumeMemory } from "@/lib/rate-limit-rs";

const LIMIT_PER_MIN = 100;
const WINDOW_MS = 60_000;

/** Returns true when the given IP has exceeded the per-minute window
 *  and should be silently dropped. Side-effecting: consumes one token
 *  on success. */
export function shouldDropForRateLimit(ip: string | null): boolean {
  if (!ip) return false; // no IP signal, can't apply per-IP limit
  const out = tryConsumeMemory(`analytics:${ip}`, LIMIT_PER_MIN, WINDOW_MS);
  return !out.allowed;
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
