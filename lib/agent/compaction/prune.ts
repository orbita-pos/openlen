// PODAR SIN MODELO, el primer paso de la compactación del arnés de DeepSeek
// (`packages/compaction/compaction-tool-result-pruner` @ 5badb15, MIT): todo
// resultado de herramienta de más de 8.192 puntos de código se queda con sus
// primeros 4.096, el marcador y sus últimos 1.024. Puntos de código, como allí:
// un emoji no cuenta doble ni se parte por la mitad. Sólo se poda lo que el
// modelo YA vio (antes de `protectFrom`). El texto entero puede quedar en un
// fichero de recuperación (`spill-policy` de DeepSeek): quien llama lo guarda
// ANTES y pasa las rutas.
//
// SE PODA EL TEXTO QUE EL MODELO VE (`contenidoDeRespuesta`, el del puente): el
// `tool_result` de las herramientas de ficheros, o el JSON de las demás. Una
// respuesta que viajaba como objeto pasa a viajar como su JSON podado, que es
// lo que el modelo ya leía, cortado por el medio.
import type { Message } from "@/lib/ai-gateway";
import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";
import { contenidoDeRespuesta } from "@/lib/agent/fireworks-bridge";

export const PRUNE_MARKER = "\n\n[... tool result middle pruned ...]\n\n";
export const PRUNE_DEFAULTS = { thresholdChars: 8_192, headChars: 4_096, tailChars: 1_024 } as const;

/** Los puntos de código del texto si pasa del umbral; `null` si cabe. */
function codePointsIfOversized(text: string): string[] | null {
  // Un texto nunca tiene más puntos de código que unidades UTF-16: el corto
  // se descarta sin recorrerlo.
  if (text.length <= PRUNE_DEFAULTS.thresholdChars) return null;
  const points = Array.from(text);
  return points.length > PRUNE_DEFAULTS.thresholdChars ? points : null;
}

export function oversizedResults(messages: readonly Message[], protectFrom: number): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  messages.forEach((m, i) => {
    if (i >= protectFrom) return;
    m.functionResponses?.forEach((fr, j) => {
      const text = contenidoDeRespuesta(fr.response);
      if (codePointsIfOversized(text)) out.push({ key: `${i}:${j}`, text });
    });
  });
  return out;
}

export function pruneToolResults(
  messages: readonly Message[],
  protectFrom: number,
  paths: ReadonlyMap<string, string>,
): { messages: Message[]; count: number } {
  let count = 0;
  const out = messages.map((m, i) => {
    if (i >= protectFrom || !m.functionResponses) return m;
    let changed = false;
    const functionResponses = m.functionResponses.map((fr, j) => {
      const points = codePointsIfOversized(contenidoDeRespuesta(fr.response));
      if (!points) return fr;
      changed = true;
      count += 1;
      const path = paths.get(`${i}:${j}`);
      const marker = path ? PRUNE_MARKER.replace(" ...]", ` ...; the full result is in ${path}]`) : PRUNE_MARKER;
      const pruned =
        points.slice(0, PRUNE_DEFAULTS.headChars).join("") + marker + points.slice(-PRUNE_DEFAULTS.tailChars).join("");
      const response = typeof fr.response[CLAVE_TOOL_RESULT] === "string" ? { ...fr.response, [CLAVE_TOOL_RESULT]: pruned } : { [CLAVE_TOOL_RESULT]: pruned };
      return { ...fr, response };
    });
    return changed ? { ...m, functionResponses } : m;
  });
  return { messages: out, count };
}
