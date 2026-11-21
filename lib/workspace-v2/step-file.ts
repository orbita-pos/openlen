// WHAT A FILE STEP OF LEN'S IS ABOUT, for its words: «la página» is a page's HTML; any other file — an agent's, a skill,
// a stylesheet, notes — is «un fichero» (delivery 1's walk: writing ~/.len/agents/plant-care.md in the space read
// «Escribiendo la página»). The steps card, the live bar and the action card ask the same thing.

/** Len's file tools whose words follow the file (Read, Edit, MultiEdit, Write). */
export const FILE_TOOLS = new Set(["Read", "Edit", "MultiEdit", "Write"] as const);
export type FileTool = typeof FILE_TOOLS extends Set<infer T> ? T : never;

/** The path a file step is about: the first word of its summary, without the «:» Edit writes after it
 *  (`index.html: «…» → «…»`, lib/agent/herramientas-de-ficheros.ts) or MultiEdit's «(N edits)». */
export function stepPath(summary: string | null | undefined): string {
  const first = (summary ?? "").trim().split(/\s/)[0] ?? "";
  return first.replace(/:$/, "");
}

/** A file step about something other than a page. No path (not known yet): false, the words stay a page's. */
export function isOtherFile(summary: string | null | undefined): boolean {
  const path = stepPath(summary);
  return path !== "" && !/\.html?$/i.test(path);
}
