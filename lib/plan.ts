// Los planes, y cómo se lee el de la base.
//
// Sin dependencias a propósito: lo importan módulos que tocan la base
// (lib/limits.ts, lib/credits.ts) y componentes de cliente por igual.
//
// 04/10: Max entra como tercer plan (Pro $10 y Max $20, «vender a mayoreo»).
// Max es Pro con más créditos: mismos topes en todo lo demás (decisión de
// Jesús), así que los mapas por plan le dan los valores de Pro.

export type Plan = "free" | "pro" | "max";

/** `users.plan` es texto libre en la base: lo que no sea un plan de pago
 *  conocido es Gratis, nunca un plan de pago por error. */
export function planFromDb(raw: unknown): Plan {
  if (raw === "max") return "max";
  if (raw === "pro") return "pro";
  return "free";
}

/** El orden de los planes. Subir da los créditos del plan nuevo; quedarse o
 *  bajar, no. */
export const PLAN_RANK: Record<Plan, number> = { free: 0, pro: 1, max: 2 };
