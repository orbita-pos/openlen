// CÓMO SE DEFINE Y SE CORRE UNA HERRAMIENTA. `run` recibe los argumentos ya
// validados y quién llama; todo lo común (token, ráfaga, permisos, plan,
// errores, registro) pasa aquí, una vez.
import { captureException } from "@inariwatch/capture";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type * as z from "zod4";
import { consumeToken } from "@/lib/rate-limit";
import { errorCodeOf, recordAudit } from "../audit";
import { callerFrom, type McpCaller } from "../auth";
import { checkToolAllowed, type ToolName } from "../plan-policy";
import { toolError, type ToolResult } from "../results";

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
  /** `_meta` del registro, p. ej. `anthropic/requiresUserInteraction` (Claude pide confirmación). */
  meta?: Record<string, unknown>;
  run(args: z.infer<S>, caller: McpCaller): Promise<ToolResult>;
}

export function defineTool<S extends z.ZodObject>(def: ToolDefinition<S>): ToolDefinition<S> {
  return def;
}

/** Ráfaga por token: 120 llamadas por minuto, en memoria (un solo proceso). */
const BURST = { limit: 120, windowMs: 60_000 };

export async function runGuarded<S extends z.ZodObject>(
  tool: ToolDefinition<S>,
  args: z.infer<S>,
  authInfo: AuthInfo | undefined,
): Promise<ToolResult> {
  const caller = callerFrom(authInfo);
  if (!caller) return toolError("unauthorized", "The OpenLen connection is not signed in. Ask the user to reconnect it.");
  const started = Date.now();
  const result = await runForCaller(tool, args, caller);
  const raw = (args as { project_id?: unknown } | undefined)?.project_id;
  // Sin esperar: el registro no retrasa la respuesta, y nunca lleva los argumentos.
  void recordAudit({
    userId: caller.userId,
    tokenId: caller.tokenId,
    tool: tool.name,
    projectId: typeof raw === "string" ? raw : null,
    ok: !result.isError,
    errorCode: errorCodeOf(result),
    durationMs: Date.now() - started,
  });
  return result;
}

async function runForCaller<S extends z.ZodObject>(tool: ToolDefinition<S>, args: z.infer<S>, caller: McpCaller): Promise<ToolResult> {
  const burst = consumeToken(`mcp:burst:${caller.tokenId}`, BURST);
  if (!burst.allowed) {
    return toolError("rate_limited", `Too many calls. Wait ${Math.ceil(burst.retryAfterMs / 1000)} s and continue.`);
  }
  const denied = await checkToolAllowed(caller, tool.name);
  if (denied) return denied;
  try {
    return await tool.run(args, caller);
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), { route: "mcp", tool: tool.name, userId: caller.userId });
    return toolError("internal", "Something failed on OpenLen's side running this tool. Try once more; if it repeats, tell the user.");
  }
}
