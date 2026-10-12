// lib/functions/overview-real.ts — EL RESUMEN DE LAS FUNCIONES CON LO DE VERDAD
// (spec local 2026-10-11, Parte 6). Sin motor, null: la vista no las enseña.

import "server-only";

import { functionsBlocked } from "./blocks-pg";
import { ownerOf } from "./deploy";
import { pgDeploymentStore } from "./deployments-pg";
import { functionsEnabled } from "./engines";
import { recentFunctionErrors } from "./invocations-pg";
import type { OverviewDeps } from "./overview";
import { monthCalls } from "./usage-pg";

export function realOverviewDeps(): OverviewDeps | null {
  if (!functionsEnabled()) return null;
  return {
    deployment: (p, e) => pgDeploymentStore.get(p, e),
    monthCalls,
    plan: async (p) => (await ownerOf(p))?.plan ?? "free",
    blocked: functionsBlocked,
    recentErrors: (p, n) => recentFunctionErrors(p, n),
    now: () => new Date(),
  };
}
