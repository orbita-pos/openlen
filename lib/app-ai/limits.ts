// lib/app-ai/limits.ts — THE AI GATEWAY'S LIMITS (spec local 2026-10-15, 4.2,
// 4.4 and 4.5): per project and plan, the body size, the account's monthly cap
// and the free plan's daily pool. One place, like FUNCTION_LIMITS.

import { CENTICREDITOS_POR_CREDITO, USD_PER_CREDIT } from "@/lib/credits-client";
import type { Plan } from "@/lib/plan";

export interface AppAiLimits {
  readonly requestsPerMinute: number;
  readonly concurrent: number;
}

export const APP_AI_LIMITS: Readonly<Record<Plan, AppAiLimits>> = {
  free: { requestsPerMinute: 20, concurrent: 2 },
  pro: { requestsPerMinute: 120, concurrent: 10 },
  max: { requestsPerMinute: 240, concurrent: 20 },
  ultra: { requestsPerMinute: 600, concurrent: 50 },
};

export const MAX_BODY_BYTES = 1024 * 1024;

/** The default monthly cap of an account's apps: a quarter of its plan. */
export const DEFAULT_CAP_SHARE = 0.25;

/** The month's cap, in centicredits: the owner's own (0 … the whole plan) or the default. */
export function monthlyCap(explicit: number | null, allotment: number): number {
  if (explicit === null || !Number.isFinite(explicit)) return Math.floor(allotment * DEFAULT_CAP_SHARE);
  return Math.min(Math.max(0, Math.floor(explicit)), allotment);
}

const DEFAULT_FREE_DAILY_USD = 2;

/** All free-plan apps together, per UTC day, in centicredits. */
export function freeDailyCapCenticredits(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env.OPENLEN_APP_AI_FREE_DAILY_USD;
  const usd = raw === undefined || raw.trim() === "" ? DEFAULT_FREE_DAILY_USD : Number(raw);
  const value = Number.isFinite(usd) && usd >= 0 ? usd : DEFAULT_FREE_DAILY_USD;
  return Math.round((value / USD_PER_CREDIT) * CENTICREDITOS_POR_CREDITO);
}
