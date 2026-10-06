/**
 * LA PÁGINA A MEDIAS — los «live tool deltas» de DeepSeek
 * (`packages/client/ui-chat/README.md:96` de deepseek-harness), para el lienzo.
 *
 * El cliente de Fireworks cede los argumentos de cada llamada a trozos
 * (`function_call_delta`). Esto lee de esos trozos la ruta y el contenido de un
 * `Write` ANTES de que la llamada termine, y dice cuándo merece la pena pintar.
 * Sólo se enseña: lo que se guarda sigue siendo la llamada armada, que pasa por
 * las guardas de `Write` como siempre.
 *
 * Puro, sin imports pesados: lo prueba vitest sin binding ni base.
 */
import { paginaDeRuta } from "./ficheros/sitio";

/** Cada cuántos caracteres NUEVOS se repinta. El lienzo es un iframe: pintarlo
 *  a cada trozo (unos pocos caracteres) sería repintar cientos de veces. */
export const PREVIEW_STEP_CHARS = 1_500;

export interface PagePreview {
  readonly page: string | null;
  readonly html: string;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/** El valor de una clave de cadena en un JSON que puede estar cortado.
 *  `complete` dice si llegó la comilla de cierre. Un escape a medias al final
 *  se deja fuera: se completará con el trozo siguiente. */
function readStringField(src: string, key: string): { value: string; complete: boolean } | null {
  // Dentro de una cadena JSON una comilla va escapada (`\"`), así que
  // `"clave":"` sin barra delante sólo puede ser una clave de verdad.
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(src);
  if (!match) return null;
  let i = match.index + match[0].length;
  let value = "";
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '"') return { value, complete: true };
    if (ch !== "\\") {
      value += ch;
      i++;
      continue;
    }
    if (i + 1 >= src.length) break;
    const esc = src[i + 1]!;
    if (esc === "u") {
      const hex = src.slice(i + 2, i + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break;
      value += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    const decoded = ESCAPES[esc];
    if (decoded === undefined) break;
    value += decoded;
    i += 2;
  }
  return { value, complete: false };
}

/** La ruta (sólo si está entera) y el contenido (hasta donde haya llegado). */
export function readPartialWrite(argsSoFar: string): { filePath: string | null; content: string | null } {
  const path = readStringField(argsSoFar, "file_path");
  const content = readStringField(argsSoFar, "content");
  return {
    filePath: path?.complete ? path.value : null,
    content: content ? content.value : null,
  };
}

/** Junta los trozos por llamada y devuelve una vista previa cuando un `Write`
 *  de una PÁGINA lleva `step` caracteres nuevos desde la última. */
export function createWritePreview(step: number = PREVIEW_STEP_CHARS) {
  const calls = new Map<number, { name?: string; args: string; painted: number }>();
  return {
    push(delta: { readonly index: number; readonly name?: string; readonly argsDelta: string }): PagePreview | null {
      const prev = calls.get(delta.index);
      const call = {
        name: delta.name ?? prev?.name,
        args: (prev?.args ?? "") + delta.argsDelta,
        painted: prev?.painted ?? 0,
      };
      calls.set(delta.index, call);
      if (call.name !== "Write") return null;
      const { filePath, content } = readPartialWrite(call.args);
      if (filePath === null || content === null) return null;
      const target = paginaDeRuta(filePath);
      if (!target) return null;
      if (content.length - call.painted < step) return null;
      call.painted = content.length;
      return { page: target.page, html: content };
    },
  };
}
