/**
 * LA MEMORIA DEL PROYECTO COMO MENSAJE DURADERO — `dsh-agent-instructions` de
 * DeepSeek (deepseek-harness, MIT): las instrucciones son contenido de la
 * conversación. La primera vez, una línea base; después, NUNCA se reinyecta un
 * fichero que no cambió («An unchanged path with an unchanged digest is never
 * injected again»), y lo que cambió va en un mensaje nuevo más abajo. El de
 * arriba no se toca, así que todo lo que va detrás sigue en caché ($0,006/M
 * contra $0,30/M, lib/ai/tarifas.ts).
 *
 * Sólo lo del PROYECTO (`/LEN.md`, `MEMORY.md`): la conversación es compartida
 * entre los miembros, y el `~/.len/LEN.md` de cada uno es privado — ése va en
 * el contexto de cada turno (`context.ts`).
 *
 * Puro.
 */
import { createHash } from "node:crypto";

export interface MemoryFile {
  readonly path: string;
  readonly label: string;
  readonly text: string | null | undefined;
}

/** Ruta → sha1 del texto normalizado; `""` si está vacío. */
export type MemoryDigests = Readonly<Record<string, string>>;

export const PROJECT_MEMORY_MAX = 16_000;

const OPEN = "<system-reminder>\n";
const CLOSE = "</system-reminder>\n";

const clean = (t: string | null | undefined) => (t ?? "").replace(/\r\n/g, "\n").trim();
// El texto de un fichero no puede cerrar el marco (el invariante de DeepSeek).
const escape = (t: string) => t.replace(/<\/system-reminder>/g, "<\\/system-reminder>");
const sha1 = (t: string) => (t ? createHash("sha1").update(t).digest("hex") : "");

export function digestMemory(files: readonly MemoryFile[]): MemoryDigests {
  return Object.fromEntries(files.map((f) => [f.path, sha1(clean(f.text))]));
}

/**
 * Lo que el modelo ya conoce: las huellas de TODAS las filas que el historial
 * reenvía, de la más vieja a la más nueva (la más nueva gana). Cada fila guarda
 * sólo lo que ELLA mostró, así que lo que salió de la ventana de turnos
 * (`TURNOS_DEL_HISTORIAL`) deja de contar como visto y vuelve a entrar.
 */
export function foldMemoryDigests(
  rows: readonly { readonly transcript: { readonly memoriaHuellas?: MemoryDigests } | null }[],
): MemoryDigests | null {
  let known: Record<string, string> | null = null;
  for (const row of rows) {
    const h = row.transcript?.memoriaHuellas;
    if (h) known = { ...(known ?? {}), ...h };
  }
  return known;
}

const block = (f: MemoryFile, text: string) => `Contents of ${f.path} (${f.label}):\n\n${escape(text)}\n\n`;
const changed = (f: MemoryFile, text: string) =>
  `${f.path} changed — this replaces what you saw before (${f.label}):\n\n${escape(text)}\n\n`;
const emptied = (f: MemoryFile) => `${f.path} is now empty.\n\n`;
const omitted = (path: string) => `(${path} was left out: over the memory budget. Read it if you need it.)\n\n`;

interface Part {
  readonly path: string;
  readonly render: (text: string) => string;
  readonly text: string;
}

/** Como el presupuesto de DeepSeek: se omite primero lo más amplio y, si ni
 *  así cabe, se corta lo más concreto diciendo dónde leer el resto. */
function withinBudget(parts: readonly Part[], maxChars: number): string {
  const notes: string[] = [];
  let kept: readonly Part[] = parts;
  const size = () => OPEN.length + CLOSE.length + notes.join("").length + kept.reduce((n, p) => n + p.render(p.text).length, 0);
  while (kept.length > 1 && size() > maxChars) {
    notes.push(omitted(kept[0]!.path));
    kept = kept.slice(1);
  }
  if (size() > maxChars && kept.length === 1) {
    const last = kept[0]!;
    const marker = `\n…[truncated: Read ${last.path} for the rest]`;
    const room = maxChars - (size() - last.text.length) - marker.length;
    kept = [{ ...last, text: last.text.slice(0, Math.max(0, room)) + marker }];
  }
  return OPEN + notes.join("") + kept.map((p) => p.render(p.text)).join("") + CLOSE;
}

/**
 * El mensaje de memoria de ESTE turno, o `null` si no hay nada que decir.
 * `known` = lo que el modelo ya ve en el historial (`foldMemoryDigests`);
 * `null` ⇒ no ve nada. Un fichero que no conoce entra entero; uno que conoce y
 * cambió, como refresco. `digests` son sólo los de lo que ESTE mensaje muestra
 * (lo omitido por el presupuesto cuenta: ya se le dijo que lo lea).
 */
export function memoryMessageForTurn(
  files: readonly MemoryFile[],
  known: MemoryDigests | null,
  maxChars: number,
): { readonly text: string; readonly digests: MemoryDigests } | null {
  const now = digestMemory(files);
  const parts = files.flatMap((f): Part[] => {
    const seen = known?.[f.path];
    const text = clean(f.text);
    if (seen === undefined) return text ? [{ path: f.path, render: (t) => block(f, t), text }] : [];
    if (seen === now[f.path]) return [];
    return [{ path: f.path, render: (t) => (text ? changed(f, t) : emptied(f)), text }];
  });
  if (parts.length === 0) return null;
  return { text: withinBudget(parts, maxChars), digests: Object.fromEntries(parts.map((p) => [p.path, now[p.path]!])) };
}
