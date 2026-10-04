/**
 * LO QUE CAMBIÓ EN EL TURNO, fichero a fichero: la tarjeta del pie del turno y
 * la lente «Cambios» (plans/len-agente-2026).
 *
 * LA FORMA ES LA DE DEEPSEEK (`deepseek-harness` @ 639ed01,
 * `.agents/notes/implemented/feature/2026-09-11-turn-changed-files-card.md` y
 * `2026-09-15-changed-file-diff-preview.md`): una foto de los ficheros al
 * EMPEZAR el turno y otra al ACABARLO, y la comparación de las dos. Así entra
 * todo lo que escribe Len —Edit, Write, `bash`, las fotos, los módulos— sin
 * tocar cada herramienta, y una línea editada dos veces cuenta una. Ellos
 * descartaron sumar los diffs de cada edición (contaba doble) y comparar con el
 * último commit (metía en el turno el trabajo previo del usuario); aquí lo
 * mismo. Lo que el dueño edite DURANTE el turno se le atribuye al turno, como
 * allí.
 *
 * Los ficheros son los del explorador y la terminal (`cargarFicherosDeLaTerminal`):
 * páginas, `/supabase`, `/memoria` y `/ajustes`. Fuera el manual, que no es del
 * proyecto, y lo de sólo lectura, que nadie escribe.
 *
 * Puro: dos fotos dentro, la lista fuera. Lo prueba vitest.
 */
import { esDelProyecto } from "@/lib/agent/terminal/ficheros";
import { esDeLaPlataforma } from "@/lib/agent/ficheros/manual";

/** Por encima de esto, un lado no viaja: «demasiado grande para compararlo»
 *  (el `oversized` de DeepSeek). Una página normal pesa decenas de KB. */
export const MAX_BYTES_POR_FICHERO = 512_000;

export type FicheroCambiado =
  | {
      readonly ruta: string;
      readonly tipo: "texto";
      /** `null`: no existía al empezar el turno. */
      readonly antes: string | null;
      /** `null`: ya no existe al acabarlo. */
      readonly despues: string | null;
    }
  | {
      readonly ruta: string;
      readonly tipo: "grande";
      readonly nuevo: boolean;
      readonly borrado: boolean;
    };

/** Los ficheros que cambiaron entre las dos fotos, por ruta (orden de código, como allí). */
export function cambiosEntreFotos(
  antes: Readonly<Record<string, string>>,
  despues: Readonly<Record<string, string>>,
): FicheroCambiado[] {
  const rutas = [...new Set([...Object.keys(antes), ...Object.keys(despues)])]
    .filter((r) => !esDeLaPlataforma(r) && esDelProyecto(r))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: FicheroCambiado[] = [];
  for (const ruta of rutas) {
    const a = Object.hasOwn(antes, ruta) ? antes[ruta]! : null;
    const d = Object.hasOwn(despues, ruta) ? despues[ruta]! : null;
    if (a === d) continue;
    if ((a?.length ?? 0) > MAX_BYTES_POR_FICHERO || (d?.length ?? 0) > MAX_BYTES_POR_FICHERO) {
      out.push({ ruta, tipo: "grande", nuevo: a === null, borrado: d === null });
    } else {
      out.push({ ruta, tipo: "texto", antes: a, despues: d });
    }
  }
  return out;
}
