// read_file y search_files: el árbol del proyecto tal como lo ve Len
// (`cargarFicherosDeLaTerminal`: páginas, carpeta, memoria y el manual).
import { RE2JS } from "re2js";
import * as z from "zod4";
import { cargarFicherosDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import { sugerirRuta } from "@/lib/agent/ficheros/sitio";
import { realDeps } from "@/lib/agent/tools";
import { openProject } from "../access";
import type { McpCaller } from "../auth";
import { textResult, toolError, type ToolResult } from "../results";
import { mcpAgentSession } from "../session";
import { defineTool, READ_ONLY } from "./define";

/** ~20k tokens: por debajo de los 25k que corta Claude Code. */
export const MAX_READ_CHARS = 80_000;
const DEFAULT_LIMIT = 2000;
const MAX_MATCHES = 200;

async function loadTree(
  caller: McpCaller,
  projectId: string,
): Promise<{ ok: true; tree: Record<string, string> } | { ok: false; result: ToolResult }> {
  const open = await openProject(caller, projectId, "ver");
  if (!open.ok) return open;
  const session = mcpAgentSession({ projectId, ownerId: open.acceso.duenoId, personId: caller.userId, app: open.row.data.app });
  return { ok: true, tree: await cargarFicherosDeLaTerminal(session, realDeps()) };
}

/** La ruta que seguramente quería: la misma con otras mayúsculas, o la página parecida. */
function suggestPath(path: string, existing: readonly string[]): string | undefined {
  const lower = path.toLowerCase();
  return existing.find((p) => p.toLowerCase() === lower) ?? sugerirRuta(path, existing);
}

export function formatNumbered(path: string, text: string, offset: number, limit: number): string {
  const lines = text.split("\n");
  const from = Math.max(1, offset);
  const out: string[] = [];
  let used = 0;
  let last = from - 1;
  for (let n = from; n <= Math.min(lines.length, from + limit - 1); n++) {
    const line = `${String(n).padStart(6)}\t${lines[n - 1]}`;
    if (used + line.length + 1 > MAX_READ_CHARS) break;
    out.push(line);
    used += line.length + 1;
    last = n;
  }
  const header = `${path} — lines ${from}-${last} of ${lines.length}`;
  const more = last < lines.length ? `\n[${lines.length - last} more lines: call read_file with offset=${last + 1}]` : "";
  return `${header}\n${out.join("\n")}${more}`;
}

export const readFileTool = defineTool({
  name: "read_file",
  title: "Read file",
  description:
    "Reads one file of a project with line numbers (like cat -n). Paths: /index.html is the home page, /<slug>/index.html other pages, " +
    "/src/... an app's source, /AGENTS.md OpenLen's manual. Long files come in parts: use offset and limit (lines).",
  inputSchema: z.object({
    project_id: z.string().min(1),
    path: z.string().min(1).describe("Absolute path inside the project, e.g. /src/App.tsx"),
    offset: z.number().int().min(1).optional().describe("First line to read (1-based)."),
    limit: z.number().int().min(1).max(DEFAULT_LIMIT).optional().describe(`How many lines (default ${DEFAULT_LIMIT}).`),
  }),
  annotations: READ_ONLY,
  async run({ project_id, path, offset = 1, limit = DEFAULT_LIMIT }, caller) {
    const t = await loadTree(caller, project_id);
    if (!t.ok) return t.result;
    if (!Object.hasOwn(t.tree, path)) {
      const like = suggestPath(path, Object.keys(t.tree));
      return toolError("not_found", `There is no file at ${path}.${like ? ` Did you mean ${like}?` : ""} get_project lists every file.`);
    }
    return textResult(formatNumbered(path, t.tree[path] ?? "", offset, limit));
  },
});

export const searchFilesTool = defineTool({
  name: "search_files",
  title: "Search files",
  description:
    "Searches the project's files with a regular expression (RE2 / ripgrep syntax: no lookarounds or backreferences) and returns " +
    "matching lines as path:line: text, optionally with context lines. Narrow it with path (a folder or file prefix, e.g. /src/components).",
  inputSchema: z.object({
    project_id: z.string().min(1),
    pattern: z.string().min(1).describe("A regular expression in RE2 / ripgrep syntax."),
    path: z.string().optional().describe("Only files whose path starts with this (default /)."),
    case_insensitive: z.boolean().optional(),
    context: z.number().int().min(0).max(5).optional().describe("Lines of context before and after each match."),
    max_results: z.number().int().min(1).max(MAX_MATCHES).optional().describe("Default 100."),
  }),
  annotations: READ_ONLY,
  async run({ project_id, pattern, path = "/", case_insensitive = false, context = 0, max_results = 100 }, caller) {
    // RE2 y no RegExp: el patrón lo escribe cualquiera y corre en el hilo que
    // atiende a todos. Con RegExp, `(a+)+$` sobre 28 caracteres bloqueó el
    // proceso 15,7 s (medido el 11/10/2026); RE2 garantiza tiempo lineal.
    let re: RE2JS;
    try {
      re = RE2JS.compile(pattern, case_insensitive ? RE2JS.CASE_INSENSITIVE : 0);
    } catch (e) {
      return toolError(
        "invalid_pattern",
        `The pattern is not valid RE2 / ripgrep syntax (no lookarounds or backreferences): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const t = await loadTree(caller, project_id);
    if (!t.ok) return t.result;
    const out: string[] = [];
    let matches = 0;
    for (const file of Object.keys(t.tree).sort()) {
      if (!file.startsWith(path)) continue;
      const lines = (t.tree[file] ?? "").split("\n");
      for (let i = 0; i < lines.length && matches < max_results; i++) {
        if (!re.test(lines[i]!)) continue;
        matches++;
        for (let c = Math.max(0, i - context); c < i; c++) out.push(`${file}-${c + 1}- ${lines[c]}`);
        out.push(`${file}:${i + 1}: ${lines[i]}`);
        for (let c = i + 1; c <= Math.min(lines.length - 1, i + context); c++) out.push(`${file}-${c + 1}- ${lines[c]}`);
      }
      if (matches >= max_results) break;
    }
    if (matches === 0) return textResult(`No matches for /${pattern}/ under ${path}.`);
    const capped = matches >= max_results ? `\n[stopped at ${max_results} matches: narrow path or pattern]` : "";
    return textResult(`${out.join("\n")}${capped}`);
  },
});
