// Los planes, y cómo se lee el de la base.
//
// Sin dependencias a propósito: lo importan módulos que tocan la base
// (lib/limits.ts, lib/credits.ts) y componentes de cliente por igual.
//
// 04/10: Max entra como tercer plan (Pro $9.99 y Max $19.99, «vender a mayoreo»).
// Max es Pro con más créditos: mismos topes en todo lo demás (decisión de
// Jesús), así que los mapas por plan le dan los valores de Pro.

// 09/10: Ultra ($99.99) entra como cuarto plan, por encima de Max, con la misma
// regla: es Pro con más créditos.

export type Plan = "free" | "pro" | "max" | "ultra";

/** `users.plan` es texto libre en la base: lo que no sea un plan de pago
 *  conocido es Gratis, nunca un plan de pago por error. */
export function planFromDb(raw: unknown): Plan {
  if (raw === "ultra") return "ultra";
  if (raw === "max") return "max";
  if (raw === "pro") return "pro";
  return "free";
}

/** Los planes de pago que vende Polar (04/10: Pro $9.99 y Max $19.99; 09/10:
 *  Ultra $99.99). */
export type PaidPlan = Exclude<Plan, "free">;

/** Lo que pide el checkout, leído con cuidado: lo que no sea Max o Ultra es Pro. */
export function paidPlanFrom(raw: unknown): PaidPlan {
  return raw === "max" || raw === "ultra" ? raw : "pro";
}

/** El orden de los planes. Subir da los créditos del plan nuevo; quedarse o
 *  bajar, no. */
export const PLAN_RANK: Record<Plan, number> = { free: 0, pro: 1, max: 2, ultra: 3 };
