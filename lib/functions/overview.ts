// lib/functions/overview.ts — LAS FUNCIONES DE UN PROYECTO, PARA SU VISTA (spec
// local 2026-10-11, Parte 6): cuáles hay y dónde, las llamadas del mes contra la
// cuota de su plan y los últimos errores (ya tapados al anotarse). Sin base ni
// motor de verdad: todo entra por `OverviewDeps`.

import type { Plan } from "@/lib/plan";

import type { DeploymentRecord } from "./deployments";
import type { FunctionsEnvironment } from "./engines/types";
import type { InvocationRecord } from "./gateway";
import { FUNCTION_LIMITS } from "./limits";
import { monthKey } from "./meter";

export interface FunctionsOverview {
  readonly available: true;
  readonly blocked: boolean;
  readonly functions: readonly { readonly name: string; readonly draft: boolean; readonly live: boolean; readonly verifyJwt: boolean }[];
  readonly usage: { readonly month: string; readonly calls: number; readonly quota: number };
  readonly errors: readonly {
    readonly environment: FunctionsEnvironment;
    readonly name: string;
    readonly status: number;
    readonly errorCode: string | null;
    readonly error: string | null;
    readonly startedAt: string;
  }[];
}

export interface OverviewDeps {
  deployment(projectId: string, env: FunctionsEnvironment): Promise<DeploymentRecord | null>;
  monthCalls(projectId: string, month: string): Promise<number>;
  plan(projectId: string): Promise<Plan>;
  blocked(projectId: string): Promise<boolean>;
  recentErrors(projectId: string, limit: number): Promise<InvocationRecord[]>;
  now(): Date;
}

const ERRORES = 20;

export async function functionsOverview(projectId: string, deps: OverviewDeps): Promise<FunctionsOverview> {
  const month = monthKey(deps.now());
  const [draft, live, calls, plan, blocked, errores] = await Promise.all([
    deps.deployment(projectId, "draft"),
    deps.deployment(projectId, "live"),
    deps.monthCalls(projectId, month),
    deps.plan(projectId),
    deps.blocked(projectId),
    deps.recentErrors(projectId, ERRORES),
  ]);
  const nombres = [...new Set([...(draft?.functions ?? []), ...(live?.functions ?? [])].map((f) => f.name))].sort();
  return {
    available: true,
    blocked,
    functions: nombres.map((name) => {
      const d = draft?.functions.find((f) => f.name === name);
      const l = live?.functions.find((f) => f.name === name);
      return { name, draft: Boolean(d), live: Boolean(l), verifyJwt: (d ?? l)!.verifyJwt };
    }),
    usage: { month, calls, quota: FUNCTION_LIMITS[plan].callsPerMonth },
    errors: errores.map((e) => ({ environment: e.environment, name: e.name, status: e.status, errorCode: e.errorCode, error: e.error, startedAt: e.startedAt.toISOString() })),
  };
}
