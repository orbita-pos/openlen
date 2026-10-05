// QUÉ SE RESUME, como `selectCompactableRange` del arnés de DeepSeek
// (`packages/compaction/compaction-basic/src/region.ts` @ 5badb15, MIT): lo más
// viejo desde `firstIndex` (después del prompt de sistema y del manual) hasta
// antes de la cola literal, sin partir NUNCA un asistente con llamadas de su
// respuesta —el `user` con `functionResponses` que le sigue—
// (`toolPairingBalancedBefore`). La cola se cuenta desde el final y se queda con
// el mensaje que cruza `retainTokens`; con cola 0 —un desborde— queda sólo la
// unidad más nueva. Un tramo de un solo mensaje vale, como allí: si su resumen
// no encoge, lo rechaza quien resume.
import type { Message } from "@/lib/ai-gateway";

export interface Span {
  readonly start: number;
  readonly end: number;
}

/** ¿Se puede cortar justo antes de `i` sin separar una respuesta de su llamada? */
function balancedBefore(messages: readonly Message[], i: number): boolean {
  return i >= messages.length || !messages[i]?.functionResponses?.length;
}

export function selectSpan(
  messages: readonly Message[],
  o: { readonly firstIndex: number; readonly retainTokens: number; readonly estimate: (m: Message) => number },
): Span | null {
  let keepFrom = messages.length;
  let kept = 0;
  for (let i = messages.length - 1; i >= o.firstIndex; i -= 1) {
    kept += o.estimate(messages[i]!);
    keepFrom = i;
    if (kept >= o.retainTokens) break;
  }
  if (keepFrom <= o.firstIndex) return null;
  while (keepFrom > o.firstIndex && !balancedBefore(messages, keepFrom)) keepFrom -= 1;
  // Un historial que empieza en una respuesta suelta (su llamada quedó fuera al
  // recortarlo) no se separa de nada: el tramo empieza después.
  let start = o.firstIndex;
  while (start < keepFrom && !balancedBefore(messages, start)) start += 1;
  return keepFrom > start ? { start, end: keepFrom } : null;
}
