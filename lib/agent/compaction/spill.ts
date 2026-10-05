// LA RETENCIÓN DE RESULTADOS GRANDES — la `spill-policy` de DeepSeek
// (packages/spill/spill-policy @ 5badb15, MIT, LICENSES/deepseek-harness.MIT.txt).
// Al confirmar el resultado de una herramienta (su post-execute), si su texto
// pasa de `maxInlineTokens` estimados, el modelo recibe el principio y el final
// —la mitad del presupuesto para cada extremo, en orden— con el hueco entre
// medias y un aviso con la ruta del texto ENTERO. Si el fichero no se puede
// guardar, el resultado se queda como estaba: el fallo no lo esconde.
//
// Lo distinto aquí es la pista del aviso: el `read` de DeepSeek abre la ruta,
// y el `Read` de Len no ve /tmp (sólo `bash`), así que la pista dice bash.
// Jesús, 05/10: las dudas se deciden como DeepSeek o Claude Code.

/** `maxInlineTokens` del bundle base de DeepSeek (packages/bundle/base/cordis.patch.yml). */
export const SPILL_MAX_INLINE_TOKENS = 12_500;
/** El hueco entre el principio y el final (`GAP` de spill-policy/src/index.ts). */
export const SPILL_GAP = "\n\n[...]\n\n";
/** La pista de cómo leer el fichero (la suya: «Use read with offset/limit, or grep…»). */
const RETRIEVAL_HINT = "Use bash with sed -n for a range of lines, or grep this path to search within it.";
/** La misma cuenta que el resto de la compactación (`estimate.ts`). */
const CHARS_PER_TOKEN = 3.5;

const price = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);
const bytes = (text: string): number => new TextEncoder().encode(text).length;

/** `formatSpillNotice` de DeepSeek, con su forma exacta. */
function notice(omittedBytes: number, path: string): string {
  return `(Omitted ${omittedBytes} bytes. Full formatted result stored at: ${path}. ${RETRIEVAL_HINT})`;
}

/** Los primeros (o últimos) puntos de código que caben en `maxChars` unidades. */
function slice(points: readonly string[], maxChars: number, fromEnd: boolean): string[] {
  const out: string[] = [];
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[fromEnd ? points.length - 1 - i : i]!;
    if (length + p.length > maxChars) break;
    out.push(p);
    length += p.length;
  }
  return fromEnd ? out.reverse() : out;
}

/**
 * El texto retenido si `text` no cabe en `maxTokens`, tras guardar el entero en
 * `path`; `null` si cabe o si no se pudo guardar (se queda el original).
 */
export async function retainOversized(
  text: string,
  o: { readonly maxTokens: number; readonly path: string; save(path: string, text: string): Promise<boolean> },
): Promise<string | null> {
  if (price(text) <= o.maxTokens) return null;
  try {
    if (!(await o.save(o.path, text))) return null;
  } catch {
    return null;
  }
  const worst = notice(bytes(text), o.path);
  const reserved = price(SPILL_GAP) + price(`\n\n${worst}`);
  if (price(worst) > o.maxTokens) return null;
  const halfChars = Math.floor((Math.max(0, o.maxTokens - reserved) * CHARS_PER_TOKEN) / 2);
  const points = Array.from(text);
  const head = slice(points, halfChars, false);
  const tail = slice(points.slice(head.length), halfChars, true);
  const headText = head.join("");
  const tailText = tail.join("");
  const footer = notice(bytes(text) - bytes(headText) - bytes(tailText), o.path);
  return head.length + tail.length === 0 ? footer : `${headText}${SPILL_GAP}${tailText}\n\n${footer}`;
}
