// A11 · `/compact`, el de Claude Code: «Free up context by summarizing the
// conversation so far», con `argumentHint: "<optional custom summarization
// instructions>"`. Es el primer comando con «/» del chat de Len. Puro.

/** «/compact» o «/compact <instrucciones>» → lo que pide; otro texto → `null`. */
export function parseCompactCommand(text: string): { instructions: string | null } | null {
  const m = /^\/compact(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const instructions = m[1]?.trim() ?? "";
  return { instructions: instructions === "" ? null : instructions };
}
