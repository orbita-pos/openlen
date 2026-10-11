// Las herramientas de OpenLen. Se registran todas aquí; cada una vive en su fichero.
import type { McpServer } from "@modelcontextprotocol/server";
import { runGuarded, type ToolDefinition } from "./define";
import { getDiagnosticsTool } from "./diagnostics";
import { getDocsTool } from "./docs";
import { editFileTool } from "./edit";
import { readFileTool, searchFilesTool } from "./files";
import { getProjectTool, listProjectsTool } from "./projects";
import { viewPageTool } from "./view";
import { deleteFileTool, writeFileTool } from "./write";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ALL_TOOLS: ToolDefinition<any>[] = [
  listProjectsTool,
  getProjectTool,
  readFileTool,
  searchFilesTool,
  getDocsTool,
  getDiagnosticsTool,
  viewPageTool,
  editFileTool,
  writeFileTool,
  deleteFileTool,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerOpenLenTools(server: McpServer, tools: ToolDefinition<any>[] = ALL_TOOLS): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      async (args: unknown, ctx) => runGuarded(tool, args as never, ctx.http?.authInfo),
    );
  }
}
