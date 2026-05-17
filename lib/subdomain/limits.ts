import type { Plan } from "@/lib/limits";

// ─────────────────────────────────────────────────────────────────────────────
// Per-plan subdomain caps for Session 11.
//
// Separate from PLAN_LIMITS in lib/limits.ts because those are sliding-window
// rate limits (events/hour, events/month). Subdomain caps are a hard "total
// active subdomains right now" count — checked against the projects table,
// not the rate_limit_events log.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_SUBDOMAINS_PER_PLAN = {
  free: 1,
  pro: 10,
} as const satisfies Record<Plan, number>;

export function subdomainLimitForPlan(plan: Plan): number {
  return MAX_SUBDOMAINS_PER_PLAN[plan];
}
