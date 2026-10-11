// lib/agent/user-language.ts — EL IDIOMA EN QUE ESCRIBE EL USUARIO, para
// nombrarlo en el contexto del turno (`buildAgentContext.writingLanguage`).
//
// El contexto nombraba el idioma de la INTERFAZ (4b376555, por un dueño con la
// interfaz en español al que Len narraba en inglés). Con la interfaz en inglés y
// escribiendo en español —Jesús, 10/10, la app Holi— Len contestó en inglés a
// «puedes hacerme que el hero que se vea como el hero de airbnb». Lo que se
// nombra ahora es el idioma en que escribe:
//   1. el de su mensaje, si lo dice claro;
//   2. si no («continua», un aviso en inglés pegado), el de sus mensajes de
//      antes, sumando la poca señal del de ahora;
//   3. si tampoco, `null`, y el contexto nombra el de la interfaz, como antes.
// Sólo sus PALABRAS (`userText` de cada fila): en el historial del modelo van
// pegadas a los avisos del sistema, que están en inglés y le darían la razón.
import { languageSignal } from "@/lib/language/detect";
import type { IdiomaDelCorreo } from "@/lib/projects/correos-del-proyecto";

/** Palabras que lo delatan a partir de las cuales el mensaje manda solo. */
const CLEAR_SIGNAL = 3;
/** Cuántos mensajes suyos de antes se miran. */
const PREVIOUS_MESSAGES = 6;

/** `previous`: sus mensajes anteriores de la charla, del más viejo al más nuevo. */
export function userWritingLanguage(current: string, previous: readonly string[]): IdiomaDelCorreo | null {
  const now = languageSignal(current);
  if (now && now.points >= CLEAR_SIGNAL) return now.language;
  const points = new Map<IdiomaDelCorreo, number>();
  for (const s of [now, ...previous.slice(-PREVIOUS_MESSAGES).reverse().map(languageSignal)]) {
    if (s) points.set(s.language, (points.get(s.language) ?? 0) + s.points);
  }
  let best: IdiomaDelCorreo | null = null;
  let bestPoints = 0;
  for (const [language, n] of points) {
    if (n > bestPoints) {
      best = language;
      bestPoints = n;
    }
  }
  return best;
}
