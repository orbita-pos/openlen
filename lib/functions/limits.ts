// lib/functions/limits.ts — LOS TOPES DE LAS EDGE FUNCTIONS POR PLAN (spec local
// 2026-10-11, Parte 5). Los de memoria y tiempo son los de Supabase.
// Max y Ultra tienen más llamadas que Pro (decidido por Jesús el 11/10, aunque
// lib/plan.ts diga «Max y Ultra = Pro salvo créditos» para los demás topes).

import type { Plan } from "@/lib/plan";

export interface FunctionLimits {
  readonly callsPerMonth: number;
  readonly concurrent: number;
  readonly timeoutSec: number;
}

export const FUNCTION_LIMITS: Readonly<Record<Plan, FunctionLimits>> = {
  free: { callsPerMonth: 10_000, concurrent: 2, timeoutSec: 150 },
  pro: { callsPerMonth: 100_000, concurrent: 10, timeoutSec: 400 },
  max: { callsPerMonth: 300_000, concurrent: 20, timeoutSec: 400 },
  ultra: { callsPerMonth: 2_000_000, concurrent: 50, timeoutSec: 400 },
};

export const FUNCTION_MEMORY_MB = 256;

/** El cuerpo de una petición. `Invoke` de Lambda admite 6 MB de JSON y el
 *  cuerpo viaja en base64 (×4/3): 4 MB es lo que cabe con margen. */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

export type Pool = "free" | "paid";

/** Gratis tiene su bolsa: su abuso nunca apaga a los de pago. */
export const poolOf = (plan: Plan): Pool => (plan === "free" ? "free" : "paid");
