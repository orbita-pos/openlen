/**
 * LEN.md Y LA CARPETA DE MEMORIA — las rutas (plans/len-md, 2026-10-08).
 *
 * Como Claude Code: `~/.claude/CLAUDE.md` (la persona), `./CLAUDE.md` (el
 * proyecto) y una carpeta de notas con `MEMORY.md` de índice. Aquí el fichero
 * lleva el nombre del agente, como `CLAUDE.md` o `GEMINI.md`. `/AGENTS.md` no:
 * ya es el manual de la plataforma (`manual.ts`).
 *
 * `~` es `/home/user`, el HOME por defecto de la terminal (just-bash, que no
 * lo cambia `trabajador.mjs`): `cat ~/.len/LEN.md` y `Read("~/.len/LEN.md")`
 * abren lo mismo. La carpeta empieza por punto, como `/.openlen`: ningún
 * fichero de la carpeta del proyecto puede llamarse así (`folder.ts`,
 * SEGMENT), y el grep de la terminal no entra.
 *
 * Puro.
 */
export const HOME_DIR = "/home/user";
export const PERSONAL_LEN_MD = `${HOME_DIR}/.len/LEN.md`;
export const PROJECT_LEN_MD = "/LEN.md";
export const MEMORY_DIR = "/.len/memory/";
export const MEMORY_INDEX = `${MEMORY_DIR}MEMORY.md`;

export type MemoryLayer = "personal" | "project" | "index" | "note";

/** Nombre de nota: minúsculas, dígitos y guiones, como el `name:` de Claude Code. */
export const NOTE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const NOTE_NAME_MAX = 60;

export function noteNameOf(path: string): string | null {
  if (!path.startsWith(MEMORY_DIR) || !path.endsWith(".md") || path === MEMORY_INDEX) return null;
  const name = path.slice(MEMORY_DIR.length, -".md".length);
  return name.length <= NOTE_NAME_MAX && NOTE_NAME.test(name) ? name : null;
}

export function notePath(name: string): string {
  return `${MEMORY_DIR}${name}.md`;
}

export function memoryLayerOf(path: string): MemoryLayer | null {
  if (path === PERSONAL_LEN_MD) return "personal";
  if (path === PROJECT_LEN_MD) return "project";
  if (path === MEMORY_INDEX) return "index";
  return noteNameOf(path) !== null ? "note" : null;
}

/** `/memoria/dueno.md` y `/memoria/proyecto.md` hasta el 2026-10-08: las
 *  transcripciones viejas las nombran, y Len las pedirá. */
export function isLegacyMemoryPath(path: string): boolean {
  return path.startsWith("/memoria/");
}
