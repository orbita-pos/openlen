import { formatFileSize, persistedOutput } from "./formato";
/**
 * LOS FICHEROS DE LA TERMINAL DE LEN (F1 de plans/len-agente-2026).
 *
 * La terminal ve los MISMOS ficheros que Read, Edit y Write —un solo mundo, la
 * regla de DeepSeek (`implemented/feature/2026-07-06-sandbox.md`): las páginas,
 * las migraciones en `/supabase`, la memoria en `/memoria` y el manual en
 * `/AGENTS.md`—, más un `/tmp` que vive lo que dura el turno. Corre sobre
 * `just-bash`, un bash escrito en TypeScript sobre ficheros en memoria: no crea
 * procesos, no toca el disco del servidor ni la red.
 *
 * Esto es la mitad PURA: qué árbol se le da y qué cambió después de cada
 * comando. Lo cambiado se guarda por el mismo camino que `Write`, con sus
 * guardas (`lib/agent/herramientas-de-ficheros.ts`), y lo que no se puede
 * guardar se deshace en la terminal: lo que ve el siguiente comando es lo que
 * de verdad quedó. Sin imports pesados: lo prueba vitest sin base ni binding.
 */

/** Las carpetas que no son del proyecto: las que pone `just-bash` y la de usar
 *  y tirar. Lo que se escribe ahí no se guarda en ninguna parte. */
const DEL_SISTEMA = /^\/(?:tmp|bin|usr|dev|proc)(?:\/|$)/;

/** F5 · la carpeta de SÓLO LECTURA, `/.openlen` (resultados, bandeja, catálogo
 *  de fotos y versiones). Se calcula al leerla (`solo-lectura.ts`) y nadie la
 *  escribe: el hilo contesta EROFS (`trabajador.mjs`, con la misma expresión).
 *  Oculta, como el `.git` de DeepSeek: una búsqueda del sitio no entra en ella. */
export const DE_SOLO_LECTURA = /^\/\.openlen(?:\/|$)/;

export function esDeSoloLectura(ruta: string): boolean {
  return DE_SOLO_LECTURA.test(ruta);
}

export function esDelProyecto(ruta: string): boolean {
  return !DEL_SISTEMA.test(ruta) && !DE_SOLO_LECTURA.test(ruta);
}

/** Lo que cambió en los ficheros del proyecto entre dos fotos del árbol. */
export type CambioDeLaTerminal =
  | { readonly tipo: "escrito"; readonly ruta: string; readonly contenido: string; readonly crea: boolean }
  | { readonly tipo: "borrado"; readonly ruta: string };

/**
 * Los cambios en el orden de las rutas (determinista: dos corridas iguales
 * guardan en el mismo orden). Un fichero que se movió (`mv`) sale como un
 * borrado y una creación, que es lo que es.
 */
export function cambiosDeLaTerminal(
  antes: Readonly<Record<string, string>>,
  despues: Readonly<Record<string, string>>,
): CambioDeLaTerminal[] {
  const cambios: CambioDeLaTerminal[] = [];
  for (const ruta of Object.keys(despues).filter(esDelProyecto).sort()) {
    const ahora = despues[ruta]!;
    if (!Object.hasOwn(antes, ruta)) cambios.push({ tipo: "escrito", ruta, contenido: ahora, crea: true });
    else if (antes[ruta] !== ahora) cambios.push({ tipo: "escrito", ruta, contenido: ahora, crea: false });
  }
  for (const ruta of Object.keys(antes).filter(esDelProyecto).sort()) {
    if (!Object.hasOwn(despues, ruta)) cambios.push({ tipo: "borrado", ruta });
  }
  return cambios;
}

/** Hasta dónde llega la salida que lee el modelo: el de Claude Code (binario
 *  2.1.293): lo que pasa de aquí va a un fichero (`persistedOutput`). */
export const MAX_SALIDA = 30_000;

/** Lo que lee el modelo de un comando sin salida: el texto de Claude Code
 *  para un resultado vacío, `(${tool} completed with no output)`. */
const SIN_SALIDA = "(bash completed with no output)";
/** El recorte de la salida de un fallo, su `cu`: 10.000 caracteres (5.000 del
 *  principio y 5.000 del final), y sólo si pasa de 10.000 + 1.024. */
const MAX_FALLO = 10_000;
const HOLGURA_DEL_FALLO = 1_024;

function recortarFallo(texto: string): string {
  if (texto.length <= MAX_FALLO + HOLGURA_DEL_FALLO) return texto;
  const mitad = Math.floor(MAX_FALLO / 2);
  return `${texto.slice(0, mitad)}\n\n... [${texto.length - MAX_FALLO} characters truncated] ...\n\n${texto.slice(texto.length - (MAX_FALLO - mitad))}`;
}

/**
 * LA SALIDA DE UN COMANDO COMO LA DEVUELVE EL `Bash` DE CLAUDE CODE (leído en
 * su binario 2.1.293: `mapToolResultToToolResultBlockParam` y, si falla, el
 * error `YW` que formatea `MKr`): si no falla, lo que escribió —sin líneas en
 * blanco delante ni espacio detrás— y, si pasa de 30.000 caracteres, el bloque
 * `<persisted-output>`; si falla, «Exit code N» en la primera línea y lo que
 * escribió, recortado por el medio a 10.000. Detrás, lo que pasó al guardar.
 * Un guardado rechazado es un fallo con código 1 aunque el comando terminara
 * bien: el comando no hizo lo que se le pidió.
 */
export function salidaDeLaTerminal(r: {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** Si el código es un fallo (`esFalloDeLaTerminal`: un `grep` sin nada da 1 y
   *  no lo es). Sin él, todo código distinto de 0. */
  readonly fallo?: boolean;
  /** Lo que dijeron las guardas de cada fichero tocado. */
  readonly guardado?: readonly string[];
  /** Algún fichero no se pudo guardar. */
  readonly rechazado?: boolean;
  /** La terminal se reinició (tiempo agotado): lo siguiente empieza de cero. */
  readonly reiniciada?: string;
  /** Dónde se guardó la salida entera, si no cabía (`/tmp/tool-results/N.txt`). */
  readonly persistida?: string;
}): { texto: string; exitCode: number } {
  const exitCode = r.rechazado && r.exitCode === 0 ? 1 : r.exitCode;
  const fallo = r.rechazado === true || (r.fallo ?? exitCode !== 0);
  const partes = [r.stdout, r.stderr].filter((p) => p !== "");
  const cuerpo = partes.join(partes[0]?.endsWith("\n") ? "" : "\n");
  const notas = [...(r.guardado ?? []), ...(r.reiniciada ? [r.reiniciada] : [])];
  if (fallo) {
    const texto = [`Exit code ${exitCode}`, cuerpo.trim(), ...notas].filter((p) => p !== "").join("\n").trim();
    return { texto: recortarFallo(texto), exitCode };
  }
  let salida = cuerpo.replace(/^(\s*\n)+/, "").trimEnd();
  if (cuerpo.length > MAX_SALIDA) {
    salida = r.persistida
      ? persistedOutput({ path: r.persistida, text: cuerpo })
      : `${cuerpo.slice(0, MAX_SALIDA)}\nOutput too large (${formatFileSize(cuerpo.length)}). It could not be saved, so only the first ${formatFileSize(MAX_SALIDA)} are shown; the rest was dropped. If the tool can page or filter its results, call it again for the part you need.`;
  }
  const texto = [salida, ...notas].filter((p) => p !== "").join("\n");
  return { texto: texto === "" ? SIN_SALIDA : texto, exitCode };
}
