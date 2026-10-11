// QUÉ PUEDE CADA CONEXIÓN. Una sola tabla (decisión D1 de
// plans/mcp-de-openlen/README.md): Free conecta y lee; los planes de pago
// escriben y publican (Parte 2). «Todo de pago» = poner "paid" aquí.
import { getUserPlan } from "@/lib/limits";
import type { Plan } from "@/lib/plan";
import type { McpCaller } from "./auth";
import type { McpScope } from "./config";
import { toolError, type ToolResult } from "./results";

export type ToolName =
  | "list_projects"
  | "get_project"
  | "read_file"
  | "search_files"
  | "get_docs"
  | "get_diagnostics"
  | "view_page";

export const TOOL_RULES: Record<ToolName, { scope: McpScope | null; minPlan: "free" | "paid" }> = {
  list_projects: { scope: "projects:read", minPlan: "free" },
  get_project: { scope: "projects:read", minPlan: "free" },
  read_file: { scope: "projects:read", minPlan: "free" },
  search_files: { scope: "projects:read", minPlan: "free" },
  get_docs: { scope: null, minPlan: "free" },
  get_diagnostics: { scope: "projects:read", minPlan: "free" },
  view_page: { scope: "projects:read", minPlan: "free" },
};

/** null = puede; si no, el error que recibe el modelo. */
export async function checkToolAllowed(
  caller: McpCaller,
  tool: ToolName,
  planOf: (userId: string) => Promise<Plan> = getUserPlan,
): Promise<ToolResult | null> {
  const rule = TOOL_RULES[tool];
  if (rule.scope && !caller.scopes.has(rule.scope)) {
    return toolError(
      "insufficient_scope",
      `This connection was not granted "${rule.scope}". Ask the user to reconnect OpenLen and allow it.`,
    );
  }
  if (rule.minPlan === "paid" && (await planOf(caller.userId)) === "free") {
    return toolError(
      "plan_required",
      "This action needs a paid OpenLen plan. Reading and viewing work on every plan; tell the user they can upgrade at openlen.com.",
    );
  }
  return null;
}
