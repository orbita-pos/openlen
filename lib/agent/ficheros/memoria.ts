/**
 * LA MEMORIA, COMO FICHEROS — el `CLAUDE.md` de Claude Code (H3 de Len 2.x;
 * desde plans/len-md, 2026-10-08, con sus nombres: `len-md.ts`).
 *
 * ⚰️ Hasta el 2026-10-08 eran `/memoria/dueno.md` y `/memoria/proyecto.md` y
 * SÓLO SE AÑADÍA: una edición que quitaba o cambiaba una línea se rechazaba,
 * porque borrar era del dueño. Se retiró a petición de Jesús («así sería más
 * como Claude Code en su binario»): Claude Code edita y borra su memoria y se
 * apoya en que el usuario VE cada cambio. Aquí se ve en la tarjeta del chat y
 * se corrige en la lente Código. Se quedan el chequeo de credenciales
 * (`lib/agent/memory/secrets.ts`) y la regla de inyección del prompt.
 *
 * Puro: sin base ni red.
 */

import { normalizarFinales, type Leidos } from "./read";
import { MEMORY_INDEX, PERSONAL_LEN_MD, PROJECT_LEN_MD } from "./len-md";

/**
 * LA MEMORIA QUE YA VA EN EL CONTEXTO CUENTA COMO LEÍDA. Claude Code siembra
 * así el `CLAUDE.md` que carga al empezar (`seedMemoryFile`,
 * `seededFromContext`): se puede editar sin un Read antes. Con el mismo texto
 * que servirá el fichero, así que si alguien lo cambia a mitad de turno el
 * Edit lo nota como con cualquier otro fichero. El índice sólo si existe.
 */
export function memoriaSembrada(m: { personal: string | null; project: string | null; index: string | null }): Leidos {
  const lectura = (t: string | null) => ({ instantanea: normalizarFinales(t ?? ""), offset: undefined, limit: undefined });
  return new Map([
    [PERSONAL_LEN_MD, lectura(m.personal)],
    [PROJECT_LEN_MD, lectura(m.project)],
    ...(m.index ? [[MEMORY_INDEX, lectura(m.index)] as const] : []),
  ]);
}
