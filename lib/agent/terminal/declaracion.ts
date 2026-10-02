/**
 * LA HERRAMIENTA `bash` TAL COMO LA VE EL MODELO (F1 de plans/len-agente-2026).
 *
 * El contrato es el de la terminal del modo mínimo de DeepSeek, con el que se
 * evaluó V4.1 (un parámetro, `command`; salida cortada por el principio; la
 * línea del código de salida), contado con palabras nuestras y con lo que es
 * distinto aquí: no hay red ni procesos, los ficheros son los del sitio y lo
 * que se escribe se guarda como una versión.
 *
 * Detrás de `OPENLEN_TERMINAL=1`, la palanca de los dos brazos de la medición
 * de F1: con ella encendida, `bash` entra y salen Grep y Glob (Claude Code en
 * Linux tampoco los tiene: busca con la terminal). Read, Edit y Write se
 * quedan. Puro: lo importan el catálogo y sus pruebas.
 */
import { MAX_SALIDA } from "./ficheros";

export const NOMBRE_BASH = "bash";

/** ¿Está encendida la terminal? Sólo el literal "1": cualquier otra cosa, apagada. */
export function terminalEncendida(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_TERMINAL === "1";
}

/** Las herramientas que la terminal sustituye. */
export const SUSTITUIDAS_POR_LA_TERMINAL: readonly string[] = ["Grep", "Glob"];

const DESCRIPCION = `Runs … whose files are this website's files. The working directory and variables persist between calls; shell functions do not.

The files:
- /index.html is the home page and /<slug>/index.html each other page.
- /datos/<store>.json holds the rows of each store the pages declare.
- /memoria/dueno.md and /memoria/proyecto.md are the memory (lines can only be added).
- /AGENTS.md is the platform manual (read-only).
- /tmp is scratch space that lasts this turn and is never saved.

Every file a command changes is saved like a Write: through the same checks, as its own version the user can undo. A change that cannot be saved (the manual, deleting a page, HTML the checks reject) is reported in the output and the file is put back as it was.

This shell interprets commands, it does not run programs: there is no network (no curl or wget) and no node, npm, python or git. grep, sed, awk, jq, find, diff, sort, xargs and the usual text tools are there. To see or use the rendered page, use mirar_pagina and usar_pagina.

Output longer than ${MAX_SALIDA.toLocaleString("en-US")} characters is cut, keeping the beginning; the last line always says the exit code. Commands are cheap: run one, read what it prints, and adjust.`;

export const DECLARACION_BASH: Record<string, unknown> = {
  name: NOMBRE_BASH,
  description: DESCRIPCION,
  parameters: {
    type: "OBJECT",
    properties: {
      command: { type: "STRING", description: "The bash command to run." },
    },
    required: ["command"],
  },
};
