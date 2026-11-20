// WHO MAY SEE AN MCP TOOL (MCP Apps, SEP-1865): a server marks a tool `_meta.ui.visibility: ["app"]` when only its own UI
// is meant to call it. Len is the model's side of that line, so a tool the server kept for its app never becomes one of
// his tools — for an installed tool's operations (operations.ts) and for the person's connectors (lib/mcp-connectors) alike.
// ONE rule, here: a tool is hidden from the model iff its `visibility` is an array that doesn't name "model". Fail closed
// where the server wrote something that declares a list — `[]`, `["app"]`, a typo like `["App"]` — and open where it
// declared none (absent, or not an array): a server from before the standard has no field and keeps its tools.
// Pure. Reads either the raw tool a server listed (`_meta.ui.visibility`) or one already normalized (`visibility`).

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** The strings a server declared in the tool's visibility list, once each — `undefined` when it declared no list
 *  (absent or not an array). An empty array is a list: `[]`, not `undefined`. */
export function declaredVisibility(tool: unknown): string[] | undefined {
  const t = record(tool);
  const own = t?.visibility;
  const listed = Array.isArray(own) ? own : record(record(t?._meta)?.ui)?.visibility;
  if (!Array.isArray(listed)) return undefined;
  return [...new Set(listed.filter((v): v is string => typeof v === "string"))];
}

/** Whether the model may see and call this tool. */
export function modelMaySee(tool: unknown): boolean {
  const declared = declaredVisibility(tool);
  return declared === undefined || declared.includes("model");
}
