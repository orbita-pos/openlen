import { checkAndConsume, getUsage, getUserPlan, type Plan } from "@/lib/limits";

// Per-site monthly message allotment — the plan metering for the visitor chat.
// Deliberately SEPARATE from generation credits (lib/credits.ts): a popular
// page's visitors must never drain the owner's creation credits (the
// denial-of-wallet failure mode from the research). The cap is also the cost
// ceiling.
//
// MEDIDO el 2026-08-28, contra las páginas publicadas de verdad: el contexto
// del asistente (siteToText) tiene 4.712 caracteres de mediana, así que un
// mensaje sale por ~$0.0017 a tarifa DeepSeek Flash ($0.22/$0.66). O sea:
//
//     free  30 mensajes/mes  ->  $0.05 por sitio y mes
//     pro 1000 mensajes/mes  ->  $1.70 por sitio y mes
//
// La cifra anterior aquí escrita —«Flash-Lite ~$0.0007, el tope Pro ~$0.70»—
// era de otro proveedor y de antes de medir el contexto.
//
// Bundled-into-plan, not per-resolution: the research showed per-resolution
// billing (Intercom Fin $0.99) is enterprise overkill that scares SMBs; the
// SMB-friendly pattern (Crisp) folds AI into the plan. So: free gets a trial
// taste, Pro gets a generous flat allotment.

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_MS = 30 * DAY;

/** Monthly visitor-message cap per published site, by the owner's plan. */
export const ASSISTANT_MONTHLY_CAP: Record<Plan, number> = {
  free: 30,
  pro: 1000,
};

function quotaKey(projectId: string): string {
  return `assistant-quota:${projectId}`;
}

export interface QuotaCheck {
  ok: boolean;
  cap: number;
}

/** Check + consume one monthly message for a site, sized by the OWNER's plan.
 *  Rolling 30-day window keyed per project. Consuming before the model call
 *  means an over-cap request never reaches Gemini. */
export async function consumeAssistantMessage(
  projectId: string,
  ownerUserId: string,
): Promise<QuotaCheck> {
  const cap = ASSISTANT_MONTHLY_CAP[await getUserPlan(ownerUserId)];
  const decision = await checkAndConsume(quotaKey(projectId), [
    { windowMs: WINDOW_MS, max: cap, label: "monthly" },
  ]);
  return { ok: decision.ok, cap };
}

export interface QuotaUsage {
  used: number;
  cap: number;
  remaining: number;
}

/** Read-only usage for the owner-facing panel (no consume). */
export async function getAssistantUsage(
  projectId: string,
  ownerUserId: string,
): Promise<QuotaUsage> {
  const cap = ASSISTANT_MONTHLY_CAP[await getUserPlan(ownerUserId)];
  const [row] = await getUsage(quotaKey(projectId), [
    { windowMs: WINDOW_MS, max: cap, label: "monthly" },
  ]);
  const used = row?.used ?? 0;
  return { used, cap, remaining: Math.max(0, cap - used) };
}
