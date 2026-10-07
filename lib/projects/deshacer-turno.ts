// lib/projects/deshacer-turno.ts — DESHACER UN TURNO DE LEN ENTERO, todo o nada
// (F2 de las apps web, spec local docs/superpowers/specs/2026-10-07-apps-design.md,
// H7). El plan —qué vuelve y si se puede— es puro y vive en
// `deshacer-turno-plan.ts`; aquí está la base.
//
// UNA SOLA SENTENCIA, y es a propósito. Este repo no hace `db.transaction()`
// para que los dos conductores (Neon y pg) sigan siendo intercambiables
// (lib/db/index.ts). Pero Postgres ejecuta cada sentencia de forma atómica,
// también con varias CTE que escriben: el proyecto, los ficheros de la carpeta,
// la marca de «deshecho» y el registro del propio deshacer entran o no entran
// JUNTOS. Dentro de la misma sentencia se vuelven a comprobar las dos cosas que
// pueden haber cambiado desde que se leyó:
//   · el proyecto, por compare-and-swap sobre `updatedAt` (como `actualizarData`);
//   · cada fichero de la carpeta, contra lo que dejó el turno (`esperados`).
// Si una de las dos falla, la sentencia no escribe nada.
//
// Las VERSIONES (el panel de Versiones, el «antes» de cada fichero) se archivan
// DESPUÉS, con sus helpers de siempre, como hace `persistPage`: son historia,
// no estado, y un fallo ahí no puede dejar el proyecto a medias.

import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { folderFingerprint } from "@/lib/projects/files-hash";
import type { ProjectData } from "@/lib/projects/types";
import { planearDeshacer, type CambioDelTurno } from "./deshacer-turno-plan";

/** Los turnos que se pueden deshacer, por proyecto: los últimos 30… */
export const TURNOS_GUARDADOS = 30;
/** …y sin pasar de 50 MB de contenido entre todos (el más reciente se guarda
 *  siempre). Una página pesa decenas de KB; una app entera, unos cientos. */
export const BYTES_GUARDADOS = 50 * 1024 * 1024;
/** Reintentos si otro guardado se cuela entre leer y escribir. */
const INTENTOS = 3;

/**
 * Guarda lo que cambió un turno. Devuelve `true` si hay algo que deshacer.
 * Reemplaza lo que hubiera ya de ese turno (un cierre repetido no duplica) y
 * poda los turnos viejos. Lanza si la base falla: el llamador decide (el turno
 * de Len lo trata como fail-soft).
 */
export async function guardarCambiosDelTurno(projectId: string, turnId: string, cambios: readonly CambioDelTurno[]): Promise<boolean> {
  if (cambios.length === 0) return false;
  const filas = cambios.map((c) => ({ id: randomUUID(), ruta: c.ruta, antes: c.antes, despues: c.despues, deshacible: c.deshacible }));
  await db.execute(sql`
    WITH previos AS (
      DELETE FROM "projectTurnChanges" WHERE "projectId" = ${projectId} AND "turnId" = ${turnId}
    )
    INSERT INTO "projectTurnChanges" ("id", "projectId", "turnId", "path", "contentBefore", "contentAfter", "undoable", "createdAt")
    SELECT x.id, ${projectId}, ${turnId}, x.ruta, x.antes, x.despues, x.deshacible, now()
    FROM jsonb_to_recordset(${JSON.stringify(filas)}::jsonb) AS x(id text, ruta text, antes text, despues text, deshacible boolean)
  `);
  await podarTurnos(projectId);
  return cambios.some((c) => c.deshacible);
}

/** Deja los últimos `TURNOS_GUARDADOS` turnos sin pasar de `BYTES_GUARDADOS`. */
export async function podarTurnos(projectId: string): Promise<void> {
  await db.execute(sql`
    WITH turnos AS (
      SELECT "turnId", max("createdAt") AS t,
        sum(coalesce(octet_length("contentBefore"), 0) + coalesce(octet_length("contentAfter"), 0)) AS bytes
      FROM "projectTurnChanges" WHERE "projectId" = ${projectId} GROUP BY "turnId"
    ),
    ordenados AS (
      SELECT "turnId", row_number() OVER (ORDER BY t DESC) AS n, sum(bytes) OVER (ORDER BY t DESC) AS acumulado FROM turnos
    )
    DELETE FROM "projectTurnChanges"
    WHERE "projectId" = ${projectId}
      AND "turnId" IN (SELECT "turnId" FROM ordenados WHERE n > ${TURNOS_GUARDADOS} OR (n > 1 AND acumulado > ${BYTES_GUARDADOS}))
  `);
}

export type ResultadoDeDeshacer =
  | {
      readonly ok: true;
      /** Las páginas como quedaron (`null` = la home), para el lienzo. */
      readonly paginas: ReadonlyArray<{ readonly page: string | null; readonly html: string }>;
      readonly ficheros: readonly string[];
      /** Lo que cambió en el turno y no vuelve (la base de /supabase…). */
      readonly noSeDeshacen: readonly string[];
      /** El turno del propio deshacer: deshacerlo lo devuelve todo. */
      readonly deshacerId: string;
    }
  /** No hay registro de ese turno (anterior a esto, o ya podado). */
  | { readonly ok: false; readonly motivo: "sin_registro" }
  | { readonly ok: false; readonly motivo: "ya_deshecho" }
  | { readonly ok: false; readonly motivo: "sin_cambios"; readonly noSeDeshacen: readonly string[] }
  /** Alguien cambió después algo que el turno tocó: no se deshace nada. */
  | { readonly ok: false; readonly motivo: "se_solapan"; readonly rutas: readonly string[] }
  /** El proyecto no es de ese usuario, o no existe. */
  | { readonly ok: false; readonly motivo: "no_encontrado" }
  /** Otro guardado se coló las `INTENTOS` veces. */
  | { readonly ok: false; readonly motivo: "conflicto" };

async function cambiosDe(projectId: string, turnId: string): Promise<{ cambios: CambioDelTurno[]; deshecho: boolean } | null> {
  const t = schema.projectTurnChanges;
  const filas = await db
    .select({ ruta: t.path, antes: t.contentBefore, despues: t.contentAfter, deshacible: t.undoable, undoneAt: t.undoneAt })
    .from(t)
    .where(and(eq(t.projectId, projectId), eq(t.turnId, turnId)))
    .orderBy(asc(t.path));
  if (filas.length === 0) return null;
  return {
    cambios: filas.map((f) => ({ ruta: f.ruta, antes: f.antes, despues: f.despues, deshacible: f.deshacible })),
    deshecho: filas.some((f) => f.undoneAt !== null),
  };
}

export async function deshacerTurno(p: { projectId: string; userId: string; turnId: string }): Promise<ResultadoDeDeshacer> {
  for (let intento = 0; intento < INTENTOS; intento++) {
    const [proyecto] = await db
      .select({
        data: schema.projects.data,
        // En TEXTO, con sus microsegundos: leerlo como `Date` los pierde y el
        // compare-and-swap no casaría nunca (escribir-data.pg.test.ts).
        updatedAt: sql<string>`${schema.projects.updatedAt}::text`,
      })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, p.projectId), eq(schema.projects.userId, p.userId)))
      .limit(1);
    if (!proyecto) return { ok: false, motivo: "no_encontrado" };

    const registro = await cambiosDe(p.projectId, p.turnId);
    if (!registro) return { ok: false, motivo: "sin_registro" };
    if (registro.deshecho) return { ok: false, motivo: "ya_deshecho" };

    const filasDeFicheros = await db
      .select({ path: schema.projectFiles.path, content: schema.projectFiles.content })
      .from(schema.projectFiles)
      .where(eq(schema.projectFiles.projectId, p.projectId));
    const ficheros = Object.fromEntries(filasDeFicheros.map((f) => [f.path, f.content]));

    const plan = planearDeshacer(registro.cambios, { data: (proyecto.data ?? { html: "" }) as ProjectData, ficheros });
    if (!plan.ok) return plan;

    const deshacerId = randomUUID();
    const fila = await escribirDeshacer({ ...p, plan, base: proyecto.updatedAt, ficheros, deshacerId });
    if (fila.actualizado === 1) {
      await archivarHistoria(p.projectId, plan, registro.cambios);
      await podarTurnos(p.projectId).catch(() => undefined);
      return { ok: true, paginas: plan.paginas, ficheros: plan.ficheros, noSeDeshacen: plan.noSeDeshacen, deshacerId };
    }
    // No escribió. ¿Por qué? Lo que dijo la propia sentencia, que es lo único
    // que vio el estado en el que iba a escribir.
    if (fila.pendiente === 0) return { ok: false, motivo: "ya_deshecho" };
    if (fila.choques.length > 0) return { ok: false, motivo: "se_solapan", rutas: fila.choques };
    // Si no, el proyecto se movió entre leerlo y escribirlo: otra vuelta.
  }
  return { ok: false, motivo: "conflicto" };
}

/**
 * EL TURNO QUE «DESHAZ ESO» DESHACE (F3, en una app): el último registrado que
 * sigue sin deshacer y cambió algo que vuelve. Puede ser el registro de un
 * deshacer anterior: «deshaz eso» dos veces vuelve a ponerlo, como un Ctrl+Z
 * que se deshace a sí mismo. `null` si no hay ninguno.
 */
export async function ultimoTurnoDeshacible(projectId: string): Promise<string | null> {
  const t = schema.projectTurnChanges;
  const [fila] = await db
    .select({ turnId: t.turnId })
    .from(t)
    .where(and(eq(t.projectId, projectId), isNull(t.undoneAt), eq(t.undoable, true)))
    .orderBy(desc(t.createdAt))
    .limit(1);
  return fila?.turnId ?? null;
}

/** Lo que dijo la sentencia del deshacer. */
export interface FilaDelDeshacer {
  readonly actualizado: number;
  readonly pendiente: number;
  readonly choques: readonly string[];
}

/**
 * LA SENTENCIA: escribe el plan si, y sólo si, el proyecto no se movió desde
 * `base` y cada fichero de la carpeta sigue como lo dejó el turno. Exportada
 * para que las pruebas puedan mover algo ENTRE el plan y la escritura.
 */
export async function escribirDeshacer(p: {
  projectId: string;
  userId: string;
  turnId: string;
  plan: Extract<ReturnType<typeof planearDeshacer>, { ok: true }>;
  /** `projects.updatedAt` en texto, tal y como se leyó para hacer el plan. */
  base: string;
  /** La carpeta con la que se hizo el plan: de ahí sale la huella nueva. */
  ficheros: Readonly<Record<string, string>>;
  deshacerId: string;
}): Promise<FilaDelDeshacer> {
  const { plan } = p;
  const despues: Record<string, string> = { ...p.ficheros };
  for (const ruta of plan.borrar) delete despues[ruta];
  for (const e of plan.escribir) despues[e.path] = e.content;
  const inverso = plan.inverso.map((c) => ({ id: randomUUID(), ruta: c.ruta, antes: c.antes, despues: c.despues }));
    const res = await db.execute(sql`
      WITH esperados AS (
        SELECT e.path, e.content FROM jsonb_to_recordset(${JSON.stringify(plan.esperados)}::jsonb) AS e(path text, content text)
      ),
      choques AS (
        SELECT e.path FROM esperados e
        LEFT JOIN "projectFiles" f ON f."projectId" = ${p.projectId} AND f."path" = e.path
        WHERE f."content" IS DISTINCT FROM e.content
      ),
      pendiente AS (
        SELECT 1 FROM "projectTurnChanges"
        WHERE "projectId" = ${p.projectId} AND "turnId" = ${p.turnId} AND "undoneAt" IS NULL
        LIMIT 1
      ),
      actualizado AS (
        UPDATE "projects"
        SET "data" = ${JSON.stringify(plan.data)}::jsonb, "filesHash" = ${folderFingerprint(despues)}, "updatedAt" = now()
        WHERE "id" = ${p.projectId} AND "userId" = ${p.userId} AND "updatedAt"::text = ${p.base}
          AND NOT EXISTS (SELECT 1 FROM choques) AND EXISTS (SELECT 1 FROM pendiente)
        RETURNING "id"
      ),
      borrados AS (
        DELETE FROM "projectFiles"
        WHERE "projectId" = ${p.projectId}
          AND "path" IN (SELECT jsonb_array_elements_text(${JSON.stringify(plan.borrar)}::jsonb))
          AND EXISTS (SELECT 1 FROM actualizado)
        RETURNING "path"
      ),
      escritos AS (
        INSERT INTO "projectFiles" ("projectId", "path", "content", "updatedAt")
        SELECT ${p.projectId}, x.path, x.content, now()
        FROM jsonb_to_recordset(${JSON.stringify(plan.escribir)}::jsonb) AS x(path text, content text)
        WHERE EXISTS (SELECT 1 FROM actualizado)
        ON CONFLICT ("projectId", "path") DO UPDATE SET "content" = EXCLUDED."content", "updatedAt" = now()
        RETURNING "path"
      ),
      deshecho AS (
        UPDATE "projectTurnChanges" SET "undoneAt" = now()
        WHERE "projectId" = ${p.projectId} AND "turnId" = ${p.turnId} AND EXISTS (SELECT 1 FROM actualizado)
        RETURNING "id"
      ),
      registrado AS (
        INSERT INTO "projectTurnChanges" ("id", "projectId", "turnId", "path", "contentBefore", "contentAfter", "undoable", "createdAt")
        SELECT x.id, ${p.projectId}, ${p.deshacerId}, x.ruta, x.antes, x.despues, true, now()
        FROM jsonb_to_recordset(${JSON.stringify(inverso)}::jsonb) AS x(id text, ruta text, antes text, despues text)
        WHERE EXISTS (SELECT 1 FROM actualizado)
        RETURNING "id"
      )
      SELECT
        (SELECT count(*) FROM actualizado)::int AS "actualizado",
        (SELECT count(*) FROM pendiente)::int AS "pendiente",
        (SELECT coalesce(json_agg(path ORDER BY path), '[]'::json) FROM choques) AS "choques",
        (SELECT count(*) FROM borrados)::int AS "borrados",
        (SELECT count(*) FROM escritos)::int AS "escritos"
    `);
  const fila = (res.rows as Array<{ actualizado: number; pendiente: number; choques: string[] | null }>)[0];
  return {
    actualizado: Number(fila?.actualizado ?? 0),
    pendiente: Number(fila?.pendiente ?? 0),
    choques: Array.isArray(fila?.choques) ? fila.choques : [],
  };
}

/**
 * LA HISTORIA, después de escribir: el «antes» de cada fichero (para el
 * deshacer de un fichero suelto) y la página restaurada en el panel de
 * Versiones. Con los helpers de siempre, que ya podan. Fail-soft: el proyecto
 * ya está bien; lo que se pierde aquí es sólo una entrada del historial.
 */
async function archivarHistoria(
  projectId: string,
  plan: Extract<ReturnType<typeof planearDeshacer>, { ok: true }>,
  cambios: readonly CambioDelTurno[],
): Promise<void> {
  try {
    const { archiveFileVersion } = await import("@/lib/projects/file-versions");
    for (const ruta of plan.ficheros) {
      const c = cambios.find((x) => x.ruta === ruta);
      await archiveFileVersion({ projectId, path: ruta, content: c?.despues ?? null, label: "Before undoing a turn", source: "restore" });
    }
    const { createVersion } = await import("@/lib/projects/versions");
    for (const pg of plan.paginas) {
      await createVersion({ projectId, html: pg.html, label: "Undo turn", source: "restore", page: pg.page });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[deshacer-turno] el proyecto volvió, pero no se pudo archivar su historia", err);
  }
}
