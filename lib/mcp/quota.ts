// LOS CUPOS de lo que le cuesta cómputo a OpenLen (Chromium, el comprobador de
// tipos). Por persona y herramienta, en Postgres (sobreviven a un reinicio).
import { checkAndConsume, getUserPlan, type LimitWindow } from "@/lib/limits";
import type { Plan } from "@/lib/plan";
import type { McpCaller } from "./auth";
import type { ToolName } from "./plan-policy";
import { toolError, type ToolResult } from "./results";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// Escribir y publicar son de pago (TOOL_RULES los para antes en el plan
// gratis): `free` repite `paid` sólo para que el tipo cuadre. Las tres
// escrituras comparten el cubo de write_file.
const WRITE_WINDOWS: LimitWindow[] = [{ windowMs: MIN, max: 60, label: "per minute" }, { windowMs: DAY, max: 3000, label: "per day" }];
const PUBLISH_WINDOWS: LimitWindow[] = [{ windowMs: 60 * MIN, max: 20, label: "per hour" }, { windowMs: DAY, max: 100, label: "per day" }];

export const TOOL_QUOTAS: Partial<Record<ToolName, { free: LimitWindow[]; paid: LimitWindow[] }>> = {
  write_file: { free: WRITE_WINDOWS, paid: WRITE_WINDOWS },
  publish: { free: PUBLISH_WINDOWS, paid: PUBLISH_WINDOWS },
  view_page: {
    free: [{ windowMs: MIN, max: 5, label: "per minute" }, { windowMs: DAY, max: 20, label: "per day" }],
    paid: [{ windowMs: MIN, max: 15, label: "per minute" }, { windowMs: DAY, max: 400, label: "per day" }],
  },
  get_diagnostics: {
    free: [{ windowMs: MIN, max: 6, label: "per minute" }, { windowMs: DAY, max: 100, label: "per day" }],
    paid: [{ windowMs: MIN, max: 20, label: "per minute" }, { windowMs: DAY, max: 1000, label: "per day" }],
  },
};

export async function consumeQuota(
  caller: McpCaller,
  tool: ToolName,
  planOf: (userId: string) => Promise<Plan> = getUserPlan,
): Promise<ToolResult | null> {
  const q = TOOL_QUOTAS[tool];
  if (!q) return null;
  const plan = await planOf(caller.userId);
  try {
    const d = await checkAndConsume(`mcp:${tool}:${caller.userId}`, plan === "free" ? q.free : q.paid);
    if (d.ok) return null;
    const when = d.resetAt ? ` Try again after ${d.resetAt.toISOString()}.` : "";
    return toolError("quota_exceeded", `The ${tool} quota (${d.blocked?.label ?? "limit"}) is used up.${when}`);
  } catch {
    // Sin la base de los cupos no se gasta Chromium a ciegas.
    return toolError("quota_unavailable", "OpenLen could not check the usage quota right now. Try again in a minute.");
  }
}
