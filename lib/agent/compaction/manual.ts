// A11 · `/compact`, el de Claude Code: libera contexto resumiendo la
// conversación hasta ahora, con instrucciones opcionales de cómo resumir
// (su `argumentHint`). Es el primer comando con «/» del chat de Len. Puro.

/** «/compact» o «/compact <instrucciones>» → lo que pide; otro texto → `null`. */
export function parseCompactCommand(text: string): { instructions: string | null } | null {
  const m = /^\/compact(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const instructions = m[1]?.trim() ?? "";
  return { instructions: instructions === "" ? null : instructions };
}
