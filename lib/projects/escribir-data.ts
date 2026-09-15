import "server-only";

import { and, eq, type SQL } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";

/**
 * 🔴 I4 · ESCRIBIR `project.data` SIN PISAR A NADIE.
 *
 * EL PROBLEMA, contado con la columna delante. `projects.data` es UN blob JSON y
 * dentro viven cosas de dueños distintos: `html` (la Home), `pages` (las
 * subpáginas), `settings` (formularios, idiomas, módulos), `degradations`. Cada
 * escritor toca UNA de ellas — y las escribe TODAS, porque manda el blob entero:
 *
 *     const row = await select(...)        // lee data
 *     const next = { ...row.data, html }   // cambia una clave
 *     await update(...).set({ data: next })// escribe las demás tal y como
 *                                          // estaban CUANDO LAS LEYÓ
 *
 * Dos escritores a la vez y el segundo devuelve el proyecto al estado que vio:
 * no pierde sólo la página, pierde los ajustes, las subpáginas y los avisos. No
 * hacía falta que los dos tocaran lo mismo. Leer-modificar-escribir sin
 * comprobar es la avería, y no dejaba rastro: nadie falla, nadie avisa, y el
 * trabajo simplemente no está.
 *
 * ⚠️ EL COMENTARIO QUE HABÍA EN `lib/agent/tools.ts` DECÍA QUE «de los doce
 * escritores de `project.data`, el único con concurrencia optimista es el
 * editor». Las dos mitades eran falsas, contadas el 2026-09-14: son TRECE, el
 * del editor (`app/api/projects/[id]/html/route.ts`) es una guarda BLANDA
 * —archiva y sobrescribe igual—, y el único con compare-and-swap de verdad es
 * `app/api/projects/[id]/settings/route.ts`, que además escribe con `jsonb_set`
 * y por eso no puede pisar `html` ni aunque quisiera.
 *
 * LA SOLUCIÓN, que es la suya generalizada: la escritura lleva la versión que
 * leyó. Si la fila se movió entre la lectura y la escritura, NO se escribe: se
 * vuelve a leer y se vuelve a aplicar sobre lo de ahora. `updatedAt` hace de
 * número de versión — lo escribe todo escritor de la tabla, así que sube
 * también cuando cambia algo que no es `data`, y un conflicto de más sólo cuesta
 * una relectura.
 *
 * Es la misma forma que Claude Code aplica a los ficheros
 * (2.1.270, leído): guarda `{content, timestamp}` de lo que leyó y, si el
 * fichero se movió, se niega a escribir. Aquí se puede hacer mejor que negarse
 * —el cambio es un merge sobre datos, no un `old_string` sobre texto— así que se
 * reintenta encima en vez de devolverle el problema a quien llamó.
 */

/** Lo que pasó con UNA escritura. */
export type EscrituraData =
  | { readonly ok: true; readonly updatedAt: Date }
  /** La fila no existe, o no es de este usuario. */
  | { readonly ok: false; readonly motivo: "no_encontrado" }
  /** Alguien escribió entre la lectura y esta escritura. NADA se escribió. */
  | { readonly ok: false; readonly motivo: "conflicto" };

function dueno(projectId: string, userId: string | null | undefined): SQL<unknown> {
  const mio = eq(schema.projects.id, projectId);
  // `userId` ausente ⇒ escritor interno (restaurar una versión, el publicador),
  // que ya comprobó la propiedad antes. No se inventa un filtro que no había:
  // añadirlo aquí convertiría un guardado legítimo en un 404 silencioso.
  return userId == null
    ? (mio as SQL<unknown>)
    : (and(mio, eq(schema.projects.userId, userId)) as SQL<unknown>);
}

/**
 * UN intento: escribe `data` **sólo si** la fila sigue en `baseUpdatedAt`.
 *
 * El compare-and-swap va en el `WHERE`, no en un `if` de JavaScript: entre leer
 * y decidir cabe otra escritura, y entonces la comprobación diría que sí sobre
 * un estado que ya no existe. En el `WHERE` lo decide Postgres, en la misma
 * sentencia que escribe.
 */
export async function escribirDataSiNoSeMovio(params: {
  readonly projectId: string;
  readonly userId?: string | null;
  readonly data: ProjectData;
  /** El `updatedAt` que vio quien leyó. */
  readonly baseUpdatedAt: Date;
  /** `false` deja `updatedAt` como estaba. Existe para UN escritor y merece la
   *  pena: emitir o revocar un enlace de vista previa
   *  (`app/api/projects/[id]/preview/route.ts`) no es una edición de contenido y
   *  no debe reordenar la lista de «editados hace poco». El CAS sigue corriendo
   *  igual — se compara contra la base y se vuelve a escribir el mismo valor. */
  readonly tocarUpdatedAt?: boolean;
}): Promise<EscrituraData> {
  const ahora = params.tocarUpdatedAt === false ? params.baseUpdatedAt : new Date();
  const ganadas = await db
    .update(schema.projects)
    .set({ data: params.data, updatedAt: ahora })
    .where(
      and(
        dueno(params.projectId, params.userId),
        eq(schema.projects.updatedAt, params.baseUpdatedAt),
      ),
    )
    .returning({ id: schema.projects.id });

  if (ganadas.length > 0) return { ok: true, updatedAt: ahora };

  // Perder el CAS y no existir se distinguen con UNA lectura más, y hay que
  // distinguirlos: reintentar un proyecto borrado es un bucle, y devolver
  // «no existe» por un conflicto le miente a quien llamó.
  const fila = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(dueno(params.projectId, params.userId))
    .limit(1);
  return { ok: false, motivo: fila.length > 0 ? "conflicto" : "no_encontrado" };
}

/** Cuántas veces se vuelve a leer y aplicar antes de rendirse.
 *
 *  Tres, y no más: un conflicto es raro (dos escritores del MISMO proyecto en el
 *  mismo instante) y tres vueltas cubren de sobra la ráfaga de un usuario
 *  pulsando dos cosas seguidas. Si hay más, algo está en bucle y reintentar lo
 *  esconde. */
const INTENTOS = 3;

/**
 * Leer → aplicar → escribir con CAS → si alguien se coló, repetir SOBRE LO SUYO.
 *
 * `aplicar` recibe el `data` tal y como está AHORA y devuelve el que debe
 * quedar. Se le puede llamar más de una vez, así que tiene que ser puro: nada
 * de mandar correos ni de contar dentro.
 *
 * La espera entre vueltas lleva jitter, copiado de la ruta de ajustes, que ya
 * tenía el problema: sin él una ráfaga reintenta al unísono y vuelve a chocar.
 */
export async function actualizarData(params: {
  readonly projectId: string;
  readonly userId?: string | null;
  readonly aplicar: (actual: ProjectData) => ProjectData | { readonly error: string };
  /** Ver `escribirDataSiNoSeMovio`. */
  readonly tocarUpdatedAt?: boolean;
}): Promise<
  | { readonly ok: true; readonly data: ProjectData; readonly updatedAt: Date }
  | { readonly ok: false; readonly motivo: "no_encontrado" | "conflicto" }
  | { readonly ok: false; readonly motivo: "rechazado"; readonly error: string }
> {
  for (let intento = 0; intento < INTENTOS; intento++) {
    const filas = await db
      .select({ data: schema.projects.data, updatedAt: schema.projects.updatedAt })
      .from(schema.projects)
      .where(dueno(params.projectId, params.userId))
      .limit(1);
    const fila = filas[0];
    if (!fila) return { ok: false, motivo: "no_encontrado" };

    const siguiente = params.aplicar(fila.data ?? { html: "" });
    if ("error" in siguiente) return { ok: false, motivo: "rechazado", error: siguiente.error };

    const escrito = await escribirDataSiNoSeMovio({
      projectId: params.projectId,
      userId: params.userId,
      data: siguiente as ProjectData,
      baseUpdatedAt: fila.updatedAt,
      ...(params.tocarUpdatedAt !== undefined ? { tocarUpdatedAt: params.tocarUpdatedAt } : {}),
    });
    if (escrito.ok) return { ok: true, data: siguiente as ProjectData, updatedAt: escrito.updatedAt };
    if (escrito.motivo === "no_encontrado") return { ok: false, motivo: "no_encontrado" };
    await new Promise((r) => setTimeout(r, 10 + Math.random() * 40));
  }
  return { ok: false, motivo: "conflicto" };
}
