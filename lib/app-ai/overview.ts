// lib/app-ai/overview.ts — WHAT THE AI TAB SHOWS (spec local 2026-10-15, 4.6):
// what the account's apps spent this month against their cap, this project's
// share by environment, and the cap the owner may change (whole credits, 0 …
// the plan; null brings back the default 25 %).

import { CENTICREDITOS_POR_CREDITO } from "@/lib/credits-client";
import { monthKey } from "@/lib/functions/meter";

import { monthlyCap } from "./limits";
import type { AppAiEnvironment, AppAiStore, ProjectMonth } from "./store";

export interface AppAiOverview {
  readonly available: true;
  readonly month: string;
  readonly capCenticredits: number;
  readonly defaultCapCenticredits: number;
  readonly allotmentCenticredits: number;
  readonly explicit: boolean;
  readonly spentCenticredits: number;
  readonly project: Readonly<Record<AppAiEnvironment, ProjectMonth>>;
}

export async function appAiOverview(o: {
  readonly projectId: string;
  readonly ownerId: string;
  readonly allotment: number;
  readonly now: Date;
  readonly store: AppAiStore;
}): Promise<AppAiOverview> {
  const month = monthKey(o.now);
  const [explicit, spent, project] = await Promise.all([
    o.store.explicitCap(o.ownerId),
    o.store.monthSpent(o.ownerId, month),
    o.store.projectMonth(o.projectId, month),
  ]);
  return {
    available: true,
    month,
    capCenticredits: monthlyCap(explicit, o.allotment),
    defaultCapCenticredits: monthlyCap(null, o.allotment),
    allotmentCenticredits: o.allotment,
    explicit: explicit !== null,
    spentCenticredits: spent,
    project,
  };
}

export function parseCapUpdate(body: unknown, allotment: number): { ok: true; cap: number | null } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || !("capCredits" in body)) return { ok: false, error: "capCredits is required" };
  const value = (body as { capCredits: unknown }).capCredits;
  if (value === null) return { ok: true, cap: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return { ok: false, error: "capCredits must be a whole number of credits, 0 or more" };
  const cap = value * CENTICREDITOS_POR_CREDITO;
  if (cap > allotment) return { ok: false, error: `capCredits can be at most ${allotment / CENTICREDITOS_POR_CREDITO}` };
  return { ok: true, cap };
}
