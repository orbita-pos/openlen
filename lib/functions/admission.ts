// lib/functions/admission.ts — ¿ENTRA ESTA LLAMADA? (spec local 2026-10-11,
// Parte 3). En orden: una plaza a la vez del proyecto, +1 en la cuota del mes,
// y la reserva del PEOR caso en la bolsa de su plan. Lo que falla deshace lo de
// antes. Al acabar, `release` liquida lo real (recortado al peor caso: Lambda
// nunca cobra más que su tiempo límite) y suelta la plaza. Así el tope de dinero
// NO se pasa nunca, ni con muchas llamadas a la vez.

import type { Plan } from "@/lib/plan";

import type { ConcurrencyLimiter } from "./concurrency";
import { FUNCTION_LIMITS, poolOf, type FunctionLimits } from "./limits";
import { costNanoUsd, monthKey, worstCaseNanoUsd, type PoolCaps } from "./meter";
import type { UsageStore } from "./usage";

export type Admission =
  | { readonly ok: true; readonly limits: FunctionLimits; release(actualMs: number): Promise<void> }
  | { readonly ok: false; readonly reason: "concurrency" | "quota" | "cap" };

export async function admit(o: {
  readonly projectId: string;
  readonly plan: Plan;
  readonly now: Date;
  readonly usage: UsageStore;
  readonly limiter: ConcurrencyLimiter;
  readonly caps: PoolCaps;
}): Promise<Admission> {
  const limits = FUNCTION_LIMITS[o.plan];
  const soltar = o.limiter.tryAcquire(o.projectId, limits.concurrent);
  if (!soltar) return { ok: false, reason: "concurrency" };
  const month = monthKey(o.now);
  try {
    if (!(await o.usage.consumeCall(o.projectId, month, limits.callsPerMonth))) {
      soltar();
      return { ok: false, reason: "quota" };
    }
    const pool = poolOf(o.plan);
    const peor = worstCaseNanoUsd(limits.timeoutSec);
    if (!(await o.usage.reserve(pool, month, peor, o.caps[pool]))) {
      await o.usage.refundCall(o.projectId, month);
      soltar();
      return { ok: false, reason: "cap" };
    }
    let hecho = false;
    return {
      ok: true,
      limits,
      async release(actualMs: number) {
        if (hecho) return;
        hecho = true;
        try {
          await o.usage.settle({ pool, month, reservedNanoUsd: peor, actualNanoUsd: Math.min(costNanoUsd(actualMs), peor), projectId: o.projectId });
        } finally {
          soltar();
        }
      },
    };
  } catch (e) {
    soltar();
    throw e;
  }
}
