// lib/functions/admission.ts — ¿ENTRA ESTA LLAMADA? (spec local 2026-10-11,
// Parte 3). En orden: una plaza a la vez del proyecto, +1 en la cuota del mes,
// y la reserva del PEOR caso en la bolsa de su plan. Lo que falla deshace lo de
// antes. Al acabar, `release` liquida lo real (recortado al peor caso: Lambda
// nunca cobra más que su tiempo límite) y suelta la plaza. Así el tope de dinero
// NO se pasa nunca, ni con muchas llamadas a la vez.
// Y de aquí salen los avisos (fase 3): la cuota al 80 % y al 100 %, y la bolsa al 80 %.

import type { Plan } from "@/lib/plan";

import type { ConcurrencyLimiter } from "./concurrency";
import { FUNCTION_LIMITS, poolOf, type FunctionLimits, type Pool } from "./limits";
import { costNanoUsd, monthKey, worstCaseNanoUsd, type PoolCaps } from "./meter";
import type { UsageStore } from "./usage";

export type Admission =
  | { readonly ok: true; readonly limits: FunctionLimits; release(actualMs: number): Promise<void> }
  | { readonly ok: false; readonly reason: "concurrency" | "quota" | "cap" };

/** Los avisos que salen de contar (spec local 2026-10-11, Partes 5 y 6). No
 *  esperan ni lanzan: quien los pone los manda por su cuenta. */
export interface AdmissionAlerts {
  /** El proyecto llegó al 80 % o al 100 % de sus llamadas del mes (una vez por nivel y mes). */
  quota?(o: { readonly projectId: string; readonly percent: 80 | 100; readonly calls: number; readonly quota: number }): void;
  /** Lo gastado en una bolsa pasó del 80 % de su tope (una vez al mes por bolsa). */
  pool?(o: { readonly pool: Pool; readonly month: string; readonly spentNanoUsd: number; readonly capNanoUsd: number }): void;
}

export async function admit(o: {
  readonly projectId: string;
  readonly plan: Plan;
  readonly now: Date;
  readonly usage: UsageStore;
  readonly limiter: ConcurrencyLimiter;
  readonly caps: PoolCaps;
  readonly alerts?: AdmissionAlerts;
}): Promise<Admission> {
  const limits = FUNCTION_LIMITS[o.plan];
  const soltar = o.limiter.tryAcquire(o.projectId, limits.concurrent);
  if (!soltar) return { ok: false, reason: "concurrency" };
  const month = monthKey(o.now);
  try {
    const calls = await o.usage.consumeCall(o.projectId, month, limits.callsPerMonth);
    if (calls === null) {
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
    // El aviso de cuota lo da la PRIMERA llamada que entra con el mes en el 80 %
    // o en el 100 %, una vez por nivel. No «la que cae justo en el umbral»: si
    // a ésa la rechaza la bolsa y se devuelve mientras otra ya pasó con el
    // número siguiente, el aviso no saldría nunca.
    if (o.alerts?.quota && calls >= Math.ceil(limits.callsPerMonth * 0.8)) {
      const percent = calls >= limits.callsPerMonth ? 100 : 80;
      if (await o.usage.claimQuotaAlert(o.projectId, month, percent).catch(() => false)) {
        o.alerts.quota({ projectId: o.projectId, percent, calls, quota: limits.callsPerMonth });
      }
    }
    let hecho = false;
    return {
      ok: true,
      limits,
      async release(actualMs: number) {
        if (hecho) return;
        hecho = true;
        try {
          const { poolSpentNanoUsd } = await o.usage.settle({ pool, month, reservedNanoUsd: peor, actualNanoUsd: Math.min(costNanoUsd(actualMs), peor), projectId: o.projectId });
          const umbral = Math.floor(o.caps[pool] * 0.8);
          if (o.alerts?.pool && poolSpentNanoUsd >= umbral && (await o.usage.claimPoolAlert(pool, month, umbral).catch(() => false))) {
            o.alerts.pool({ pool, month, spentNanoUsd: poolSpentNanoUsd, capNanoUsd: o.caps[pool] });
          }
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
