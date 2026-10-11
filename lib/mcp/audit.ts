// EL REGISTRO DE CADA LLAMADA AL MCP. Nunca lanza ni retrasa la respuesta de
// verdad: si la base falla, se avisa en la consola y la llamada sigue.
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ToolResult } from "./results";

export interface AuditEntry {
  userId: string;
  tokenId: string;
  tool: string;
  projectId: string | null;
  ok: boolean;
  errorCode: string | null;
  durationMs: number;
}

export function errorCodeOf(result: ToolResult): string | null {
  if (!result.isError) return null;
  const first = result.content.find((c) => c.type === "text");
  return first && first.type === "text" ? /^Error \(([a-z_]+)\)/.exec(first.text)?.[1] ?? "unknown" : "unknown";
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(schema.mcpAudit).values({ ...entry, durationMs: Math.round(entry.durationMs) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[mcp] no se pudo registrar la llamada:", err instanceof Error ? err.message : err);
  }
}

export async function listAudit(userId: string, limit = 100) {
  return db
    .select()
    .from(schema.mcpAudit)
    .where(eq(schema.mcpAudit.userId, userId))
    .orderBy(desc(schema.mcpAudit.createdAt))
    .limit(limit);
}
