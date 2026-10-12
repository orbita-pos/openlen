// lib/functions/limits.ts — LOS TOPES DE LAS EDGE FUNCTIONS POR PLAN (spec local
// 2026-10-12, Parte 6). El tiempo total es el de Supabase (lo corta la puerta);
// la CPU y las peticiones a fuera de cada llamada las pone el despachador de
// Cloudflare; la memoria es la de un Worker de Cloudflare.
// Max y Ultra tienen más llamadas que Pro (decidido por Jesús el 11/10, aunque
// lib/plan.ts diga «Max y Ultra = Pro salvo créditos» para los demás topes).

import type { Plan } from "@/lib/plan";

export interface FunctionLimits {
  readonly callsPerMonth: number;
  readonly concurrent: number;
  /** El tiempo total de una llamada (esperar a otro servicio también cuenta). */
  readonly timeoutSec: number;
  /** La CPU de una llamada (esperar no cuenta): pasarse la corta con un 546. */
  readonly cpuMs: number;
  /** Las peticiones a fuera (`fetch`) de una llamada. */
  readonly subRequests: number;
}

export const FUNCTION_LIMITS: Readonly<Record<Plan, FunctionLimits>> = {
  free: { callsPerMonth: 10_000, concurrent: 2, timeoutSec: 150, cpuMs: 50, subRequests: 50 },
  pro: { callsPerMonth: 100_000, concurrent: 10, timeoutSec: 400, cpuMs: 200, subRequests: 1_000 },
  max: { callsPerMonth: 300_000, concurrent: 20, timeoutSec: 400, cpuMs: 200, subRequests: 1_000 },
  ultra: { callsPerMonth: 2_000_000, concurrent: 50, timeoutSec: 400, cpuMs: 200, subRequests: 1_000 },
};

/** La de un Worker de Cloudflare (Supabase da 256). El motor local usa la misma. */
export const FUNCTION_MEMORY_MB = 128;

/** El cuerpo de una petición: el de siempre (salió de Lambda; Cloudflare
 *  admitiría más). Viaja en base64 dentro del evento. */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

export type Pool = "free" | "paid";

/** Gratis tiene su bolsa: su abuso nunca apaga a los de pago. */
export const poolOf = (plan: Plan): Pool => (plan === "free" ? "free" : "paid");
