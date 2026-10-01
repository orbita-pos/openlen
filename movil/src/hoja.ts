// Lo que la hoja de Len dice: el último párrafo de lo último que dijo en esa
// página (su cierre resume el trabajo), o que sigue trabajando.
import type { StoredChatTurn } from "@/lib/projects/types";

const MAX = 400;

export function loQueDijoLen(historial: StoredChatTurn[]): { texto: string; enCurso: boolean; fila: string } | null {
  const t = historial.at(-1);
  if (!t) return null;
  const parrafos = t.assistantReasoning.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const texto = (parrafos.at(-1) ?? "").slice(0, MAX);
  return { texto, enCurso: t.enCurso === true, fila: t.id };
}
