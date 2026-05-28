// TypeScript wrapper over the Rust `@openlen/rate-limit` napi-rs binding.
//
// Why this file exists: the four legacy limit modules (lib/rate-limit.ts,
// lib/limits.ts, lib/analytics/rate-limit.ts, lib/subdomain/limits.ts) had
// each grown their own per-process state, their own GC, and their own
// schema knowledge. F4 consolidates the *engine* behind a single Rust
// type (see crates/rate-limit) but the call sites keep their familiar
// surface — those four modules now delegate through this wrapper instead
// of re-implementing the bucket math / SQL.
//
// Process-wide singleton: the underlying Rust `RateLimiter` owns the
// memory bucket map AND a lazy Postgres pool, so a fresh instance per
// import would defeat both. The first call to `getLimiter()` constructs
// it; every later import reuses the same handle.
//
// Build prerequisite: `cd crates/rate-limit && npm run build` must have
// produced `index.js` + `index.d.ts` for this module to type-check —
// same contract as `@openlen/ai-gateway`. The `serverExternalPackages`
// + `webpack.externals` entries in `next.config.ts` keep the native
// `.node` binary off the bundler graph.

import {
  RateLimiter as NativeRateLimiter,
  type ConsumeOutcome,
  type LimitDecision as NativeLimitDecision,
  type LimitWindow,
  type RemainingWindow,
  type UsageWindow,
} from "@openlen/rate-limit";

export type { ConsumeOutcome, LimitWindow, RemainingWindow, UsageWindow };

/** Same shape as the native binding's `LimitDecision`, but `resetAt` is
 *  a `Date` instead of an ISO string — matches what the existing
 *  `lib/limits.ts` consumers expect. */
export interface LimitDecision {
  ok: boolean;
  blocked?: LimitWindow;
  resetAt?: Date;
  remaining: RemainingWindow[];
}

/** Typed view of the JSON-envelope errors thrown from the Postgres path
 *  (and from the memory path's validation). Mirrors the native crate's
 *  `RateLimitError` variants. */
export type RateLimitErrorKind =
  | "postgres"
  | "invalid_max"
  | "invalid_window"
  | "not_configured";

export class RateLimitError extends Error {
  constructor(
    public readonly kind: RateLimitErrorKind,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let singleton: NativeRateLimiter | null = null;

function getLimiter(): NativeRateLimiter {
  if (!singleton) {
    singleton = new NativeRateLimiter({
      // Empty string == "no URL" on the Rust side — keep it undefined so
      // the lazy connect path triggers the typed `not_configured` envelope
      // when a caller does need persistence but DATABASE_URL isn't set.
      databaseUrl: process.env.DATABASE_URL || undefined,
    });
  }
  return singleton;
}

/** Test-only reset of the process-wide limiter. Clears memory state and
 *  re-opens the (lazy) Postgres pool on the next use. Public so the
 *  legacy shims can swap implementations during unit testing. */
export function __resetForTest(): void {
  singleton = null;
}

// ─── Memory-bucket call site ─────────────────────────────────────────────

/** Sync, in-memory token bucket. Replaces the per-module Map/setInterval
 *  pair that lib/rate-limit.ts and lib/analytics/rate-limit.ts used to
 *  carry. */
export function tryConsumeMemory(
  key: string,
  limit: number,
  windowMs: number,
): ConsumeOutcome {
  return getLimiter().tryConsume(key, limit, windowMs);
}

// ─── Postgres call site ──────────────────────────────────────────────────

/** Async, Postgres-backed sliding window. Replaces the drizzle-driven
 *  count-then-insert in lib/limits.ts. Throws a typed `RateLimitError`
 *  on infrastructure failures (connection refused, schema missing, etc.). */
export async function checkAndConsumePersistent(
  key: string,
  windows: LimitWindow[],
): Promise<LimitDecision> {
  try {
    const raw = await getLimiter().checkAndConsume(key, windows);
    return narrowDecision(raw);
  } catch (err) {
    throw rehydrateError(err);
  }
}

/** Read-only counterpart. Used by the `/api/usage` surface. */
export async function getUsagePersistent(
  key: string,
  windows: LimitWindow[],
): Promise<UsageWindow[]> {
  try {
    return await getLimiter().getUsage(key, windows);
  } catch (err) {
    throw rehydrateError(err);
  }
}

// ─── Internal conversions ────────────────────────────────────────────────

function narrowDecision(d: NativeLimitDecision): LimitDecision {
  return {
    ok: d.ok,
    blocked: d.blocked,
    resetAt: d.resetAt ? new Date(d.resetAt) : undefined,
    remaining: d.remaining,
  };
}

interface ErrorEnvelope {
  kind: RateLimitErrorKind;
  retryable: boolean;
  message: string;
}

function rehydrateError(raw: unknown): Error {
  const env = tryParseEnvelope(raw);
  if (env) return new RateLimitError(env.kind, env.retryable, env.message);
  return raw instanceof Error ? raw : new Error(String(raw));
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
    kind: kind as RateLimitErrorKind,
    retryable,
    message: typeof msg === "string" ? msg : "",
  };
}
