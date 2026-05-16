import { and, eq, gt, sql as sqlOp } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting + plan-based quotas.
//
// One Postgres table backs everything (rate_limit_events). Each row is a
// timestamped event for a namespaced key — `user:<id>:generate`,
// `ip:<addr>:register`, etc. checkAndConsume runs an atomic "count rows in
// window → reject if over → insert" sequence per limit.
//
// Plan tiers are hardcoded here for now. Stripe webhook will mutate
// users.plan in Phase 3 — the limits map below is the single source of
// truth for what each tier gets.
// ─────────────────────────────────────────────────────────────────────────────

export type Plan = "free" | "pro";

export interface LimitWindow {
  /** Sliding window in milliseconds (e.g. 60 * 60 * 1000 for 1 hour). */
  windowMs: number;
  /** Max events allowed in that window. */
  max: number;
  /** Short label for error messages: "monthly", "hourly". */
  label: string;
}

export interface PlanLimits {
  generate: LimitWindow[];
  regen: LimitWindow[];
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    generate: [
      { windowMs: HOUR, max: 5, label: "hourly" },
      { windowMs: MONTH, max: 3, label: "monthly" },
    ],
    regen: [
      { windowMs: HOUR, max: 10, label: "hourly" },
      { windowMs: MONTH, max: 30, label: "monthly" },
    ],
  },
  pro: {
    generate: [
      { windowMs: HOUR, max: 30, label: "hourly" },
      { windowMs: MONTH, max: 100, label: "monthly" },
    ],
    regen: [
      { windowMs: HOUR, max: 60, label: "hourly" },
      { windowMs: MONTH, max: 500, label: "monthly" },
    ],
  },
};

// IP-based limits for unauthenticated endpoints. Higher than per-user
// because legitimate traffic could share an IP (corporate NAT, dev sharing
// a wifi).
export const IP_LIMITS: Record<string, LimitWindow[]> = {
  register: [
    { windowMs: HOUR, max: 5, label: "hourly" },
    { windowMs: DAY, max: 20, label: "daily" },
  ],
  forgot: [
    { windowMs: HOUR, max: 5, label: "hourly" },
    { windowMs: DAY, max: 20, label: "daily" },
  ],
  reset: [
    { windowMs: HOUR, max: 10, label: "hourly" },
  ],
};

export interface LimitDecision {
  ok: boolean;
  /** When ok=false, which window blocked. */
  blocked?: LimitWindow;
  /** Approximate UTC timestamp when the oldest event leaves the window. */
  resetAt?: Date;
  /** Per-window remaining counts (after this call would have been recorded). */
  remaining: Array<{ window: LimitWindow; remaining: number }>;
}

/**
 * Atomic check + record. If any window is over its limit, returns
 * { ok: false } WITHOUT inserting a new event. Otherwise inserts and
 * returns { ok: true } with remaining counts.
 *
 * Postgres handles concurrency: COUNT happens before INSERT and the index
 * keeps both fast. Two concurrent requests right at the limit might both
 * pass — acceptable slop for a quota system, not for a money-critical lock.
 */
export async function checkAndConsume(
  key: string,
  windows: LimitWindow[],
): Promise<LimitDecision> {
  // Count rows per window in parallel.
  const counts = await Promise.all(
    windows.map(async (w) => {
      const since = new Date(Date.now() - w.windowMs);
      const rows = await db
        .select({ count: sqlOp<number>`count(*)::int` })
        .from(schema.rateLimitEvents)
        .where(
          and(
            eq(schema.rateLimitEvents.key, key),
            gt(schema.rateLimitEvents.createdAt, since),
          ),
        );
      return { window: w, count: rows[0]?.count ?? 0 };
    }),
  );

  const blocked = counts.find((c) => c.count >= c.window.max);
  if (blocked) {
    // Find the oldest event in this window — when it ages out the limit
    // resets enough to allow one more.
    const since = new Date(Date.now() - blocked.window.windowMs);
    const oldest = await db
      .select({ createdAt: schema.rateLimitEvents.createdAt })
      .from(schema.rateLimitEvents)
      .where(
        and(
          eq(schema.rateLimitEvents.key, key),
          gt(schema.rateLimitEvents.createdAt, since),
        ),
      )
      .orderBy(schema.rateLimitEvents.createdAt)
      .limit(1);
    const resetAt = oldest[0]
      ? new Date(oldest[0].createdAt.getTime() + blocked.window.windowMs)
      : new Date(Date.now() + blocked.window.windowMs);
    return {
      ok: false,
      blocked: blocked.window,
      resetAt,
      remaining: counts.map((c) => ({
        window: c.window,
        remaining: Math.max(0, c.window.max - c.count),
      })),
    };
  }

  await db.insert(schema.rateLimitEvents).values({ key });

  return {
    ok: true,
    remaining: counts.map((c) => ({
      window: c.window,
      remaining: Math.max(0, c.window.max - c.count - 1),
    })),
  };
}

/**
 * Read-only version of checkAndConsume — counts rows but doesn't insert.
 * Used by the /api/usage endpoint to surface remaining quota in the UI.
 */
export async function getUsage(
  key: string,
  windows: LimitWindow[],
): Promise<Array<{ window: LimitWindow; remaining: number; used: number }>> {
  const counts = await Promise.all(
    windows.map(async (w) => {
      const since = new Date(Date.now() - w.windowMs);
      const rows = await db
        .select({ count: sqlOp<number>`count(*)::int` })
        .from(schema.rateLimitEvents)
        .where(
          and(
            eq(schema.rateLimitEvents.key, key),
            gt(schema.rateLimitEvents.createdAt, since),
          ),
        );
      const used = rows[0]?.count ?? 0;
      return { window: w, used, remaining: Math.max(0, w.max - used) };
    }),
  );
  return counts;
}

export async function getUserPlan(userId: string): Promise<Plan> {
  const rows = await db
    .select({ plan: schema.users.plan })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const raw = rows[0]?.plan ?? "free";
  return raw === "pro" ? "pro" : "free";
}

export function userLimitKey(
  userId: string,
  action: "generate" | "regen",
): string {
  return `user:${userId}:${action}`;
}

export function ipLimitKey(ip: string, action: string): string {
  return `ip:${ip}:${action}`;
}

/**
 * Best-effort client IP extraction from common proxy headers. Order matters:
 * Vercel and Cloudflare set their own header first; x-forwarded-for is the
 * fallback (take the leftmost = original client).
 */
export function getClientIp(req: Request): string {
  const headers = req.headers;
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf;
  const vercel = headers.get("x-real-ip");
  if (vercel) return vercel;
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}
