// WHAT LEN SEES OF A CONNECTOR'S TOOLS (spec local 2026-11-06-conectores-mcp, §3, §5.4). DeepSeek's v1 naming contract
// (dsh-mcp-client, archived note 2026-07-07-mcp-client-plugin): `mcp__<serverName>__<rawName>`, a pure function of the
// two; invalid characters become `_`, and when that changed the name or it is over 64 characters, it is cut and gets
// `_` + 12 hex of sha256(serverName \0 rawName), so distinct identities never collapse. Only the raw name goes on the
// wire. The schema rules are those of an installed tool's operations (`lib/tools/mcp/schema.ts`). Pure.
import { createHash } from "node:crypto";

import type { McpTool } from "@/lib/tools/mcp/client";
import { hasRef, MCP_DESCRIPTION_MAX, MCP_SCHEMA_MAX_BYTES, structureProblem } from "@/lib/tools/mcp/schema";

const NAME_MAX = 64;

export interface ReviewedTool {
  readonly publicName: string;
  readonly rawName: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export function publicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, "_");
  if (normalized === joined && normalized.length <= NAME_MAX) return normalized;
  const hash = createHash("sha256").update(`${serverName}\0${rawName}`).digest("hex").slice(0, 12);
  return `${normalized.slice(0, NAME_MAX - 13)}_${hash}`;
}

export function reviewTools(serverName: string, tools: readonly McpTool[]): { tools: ReviewedTool[]; problems: string[] } {
  const seen = new Set<string>();
  for (const t of tools) {
    // DeepSeek: a list naming the same tool twice is invalid — refused whole, the previous one stays.
    if (seen.has(t.name)) return { tools: [], problems: [`duplicate tool name "${t.name}": the list was refused`] };
    seen.add(t.name);
  }
  const ok: ReviewedTool[] = [];
  const problems: string[] = [];
  for (const tool of tools) {
    const { $schema: _dropped, ...schema } = tool.inputSchema ?? {};
    if (schema.type !== "object") {
      problems.push(`${tool.name}: its inputSchema must be an object (type: "object")`);
      continue;
    }
    const broken = structureProblem(schema);
    if (broken) {
      problems.push(`${tool.name}: its inputSchema ${broken}`);
      continue;
    }
    if (hasRef(schema)) {
      problems.push(`${tool.name}: its inputSchema uses $ref, which the model's provider doesn't take`);
      continue;
    }
    if (new TextEncoder().encode(JSON.stringify(schema)).byteLength > MCP_SCHEMA_MAX_BYTES) {
      problems.push(`${tool.name}: its inputSchema is over ${MCP_SCHEMA_MAX_BYTES} bytes`);
      continue;
    }
    const description = [tool.title, tool.description].filter((s): s is string => typeof s === "string" && s.trim() !== "").join(" — ") || tool.name;
    ok.push({ publicName: publicToolName(serverName, tool.name), rawName: tool.name, description: description.slice(0, MCP_DESCRIPTION_MAX), inputSchema: schema });
  }
  return { tools: ok, problems };
}
