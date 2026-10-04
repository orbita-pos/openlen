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

/** Hasta dónde llega la salida que lee el modelo: la cifra de la terminal de
 *  DeepSeek (`maxOutputChars`, `packages/shell/tool-bash-persistent`). */
export const MAX_SALIDA = 16_000;

/**
 * La salida de un comando como la devuelve la terminal de DeepSeek: lo que
 * escribió (la salida y los errores), lo que pasó al guardar, el PRINCIPIO si
 * no cabe —con el aviso de que se cortó— y la línea del código de salida.
 * Un guardado rechazado deja el código distinto de 0 aunque el comando
 * terminara bien: el comando no hizo lo que se le pidió.
 */
export function salidaDeLaTerminal(r: {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** Lo que dijeron las guardas de cada fichero tocado. */
  readonly guardado?: readonly string[];
  /** Algún fichero no se pudo guardar. */
  readonly rechazado?: boolean;
  /** La terminal se reinició (tiempo agotado): lo siguiente empieza de cero. */
  readonly reiniciada?: string;
}): { texto: string; exitCode: number } {
  const exitCode = r.rechazado && r.exitCode === 0 ? 1 : r.exitCode;
  const partes = [r.stdout, r.stderr].filter((p) => p !== "");
  let cuerpo = partes.join(partes[0]?.endsWith("\n") ? "" : "\n");
  if (cuerpo.length > MAX_SALIDA) {
    cuerpo = `${cuerpo.slice(0, MAX_SALIDA)}\n[Output truncated: showing the first ${MAX_SALIDA} of ${cuerpo.length} characters. Narrow the command (head, grep, sed -n) to see the rest.]`;
  }
  const notas = [...(r.guardado ?? []), ...(r.reiniciada ? [r.reiniciada] : [])];
  const texto = [cuerpo.replace(/\n+$/, ""), ...notas, `[Command finished with exit code ${exitCode}]`].filter((p) => p !== "").join("\n");
  return { texto, exitCode };
}
