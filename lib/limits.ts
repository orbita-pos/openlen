import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  checkAndConsumePersistent,
  getUsagePersistent,
  type LimitWindow as RsLimitWindow,
} from "@/lib/rate-limit-rs";

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting + plan-based quotas.
//
// One Postgres table backs everything (rateLimitEvents). Each row is a
// timestamped event for a namespaced key — `user:<id>:generate`,
// `ip:<addr>:register`, etc. checkAndConsume runs an atomic-ish "count rows
// in window → reject if over → insert" sequence per limit.
//
// Engine: as of F4 the actual SQL lives in Rust (`crates/rate-limit`). This
// module preserves the export surface every caller in the repo relies on
// (checkAndConsume, getUsage, PLAN_LIMITS, helpers) and delegates the
// hot path to the napi binding. The race window the TS comment used to
// describe ("two concurrent requests right at the limit might both pass")
// is preserved verbatim — same SQL pattern, just executed from Rust.
// ─────────────────────────────────────────────────────────────────────────────

export type Plan = "free" | "pro";

// Tunable agent-seat caps per plan.
export const AGENT_LIMITS: Record<Plan, number> = { free: 0, pro: 3 };

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

// The monthly budget is enforced by the credit system (lib/credits.ts).
// These windows are only anti-burst abuse protection — a per-hour ceiling.
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    generate: [{ windowMs: HOUR, max: 5, label: "hourly" }],
    regen: [{ windowMs: HOUR, max: 10, label: "hourly" }],
  },
  pro: {
    generate: [{ windowMs: HOUR, max: 30, label: "hourly" }],
    regen: [{ windowMs: HOUR, max: 60, label: "hourly" }],
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
  // Credentials sign-in (brute-force / credential-stuffing). Loose enough for
  // shared NAT and a user fat-fingering their password, tight enough to make
  // online guessing infeasible. Enforced in app/api/auth/[...nextauth]/route.ts.
  login: [
    { windowMs: 15 * 60 * 1000, max: 20, label: "15-minute" },
    { windowMs: HOUR, max: 60, label: "hourly" },
  ],
  chat_register: [
    { windowMs: HOUR, max: 8, label: "hourly" },
    { windowMs: DAY, max: 30, label: "daily" },
  ],
  chat_login: [
    { windowMs: 15 * 60 * 1000, max: 20, label: "15-minute" },
    { windowMs: HOUR, max: 60, label: "hourly" },
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
 * Atomic-ish check + record — delegates to the Rust limiter. If any window
 * is over its limit, returns { ok: false } WITHOUT inserting a new event.
 * Otherwise inserts and returns { ok: true } with remaining counts.
 *
 * Throws `RateLimitError` (from `lib/rate-limit-rs.ts`) on infrastructure
 * failures — same propagation contract as before; existing callers that
 * don't catch were already letting Next.js 500.
 */
export async function checkAndConsume(
  key: string,
  windows: LimitWindow[],
): Promise<LimitDecision> {
  const decision = await checkAndConsumePersistent(key, toRsWindows(windows));
  return {
    ok: decision.ok,
    blocked: decision.blocked ? fromRsWindow(decision.blocked) : undefined,
    resetAt: decision.resetAt,
    remaining: decision.remaining.map((r) => ({
      window: fromRsWindow(r.window),
      remaining: r.remaining,
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
  const usage = await getUsagePersistent(key, toRsWindows(windows));
  return usage.map((u) => ({
    window: fromRsWindow(u.window),
    used: u.used,
    remaining: u.remaining,
  }));
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

// ─── Native <-> shim window conversions ──────────────────────────────────

function toRsWindows(windows: LimitWindow[]): RsLimitWindow[] {
  return windows.map((w) => ({
    windowMs: w.windowMs,
    max: w.max,
    label: w.label,
  }));
}

function fromRsWindow(w: RsLimitWindow): LimitWindow {
  return { windowMs: w.windowMs, max: w.max, label: w.label };
}
