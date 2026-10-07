// lib/projects/nacer-como-app.ts — UN PROYECTO EN BLANCO NACE COMO APP (H10 de
// la spec local docs/superpowers/specs/2026-10-07-apps-design.md).
//
// Crear es el primer mensaje a Len en un proyecto en blanco (plans/crear-es-len).
// Para una app, ese mismo mensaje lleva `naceComo: "app"`, y antes de que Len
// lea nada el proyecto recibe el esqueleto (`lib/apps/esqueleto.ts`): el
// cascarón en `data.html`, `data.app` y los ficheros de /src. Así el primer
// turno ya es un turno de app —su prompt, su manual, sus herramientas— y su
// deshacer vuelve al esqueleto, que arranca.
//
// 🔴 SÓLO UN PROYECTO EN BLANCO, y en UNA sentencia: las mismas tres
// condiciones que `findOrCreateBlankProject` (sin portada, sin páginas, sin
// conversación) más que no sea ya una app, comprobadas en el mismo UPDATE que
// escribe. Un proyecto con algo dentro no se toca nunca, ni en una carrera con
// otra pestaña; y el proyecto y sus ficheros entran juntos o no entra nada.

import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { esqueletoDeApp } from "@/lib/apps/esqueleto";
import { folderFingerprint } from "@/lib/projects/files-hash";

/**
 * Convierte el proyecto en blanco en una app recién nacida. `true` si lo hizo;
 * `false` si el proyecto no es del usuario, no está en blanco o ya es una app.
 */
export async function nacerComoApp(p: {
  readonly projectId: string;
  readonly userId: string;
  readonly titulo: string;
  readonly idioma?: string;
}): Promise<boolean> {
  const e = esqueletoDeApp({ titulo: p.titulo, ...(p.idioma ? { idioma: p.idioma } : {}) });
  const ficheros = Object.entries(e.ficheros).map(([path, content]) => ({ path, content }));
  const res = await db.execute(sql`
    WITH actualizado AS (
      UPDATE "projects"
      SET "data" = coalesce("data", '{}'::jsonb) || ${JSON.stringify({ html: e.html, app: e.app })}::jsonb,
          "filesHash" = ${folderFingerprint(e.ficheros)},
          "updatedAt" = now()
      WHERE "id" = ${p.projectId} AND "userId" = ${p.userId}
        AND coalesce(btrim("data"->>'html'), '') = ''
        AND coalesce("data"->'pages', '{}'::jsonb) = '{}'::jsonb
        AND "data"->'app' IS NULL
        AND NOT EXISTS (SELECT 1 FROM "projectChatMessages" m WHERE m."projectId" = ${p.projectId})
      RETURNING "id"
    ),
    escritos AS (
      INSERT INTO "projectFiles" ("projectId", "path", "content", "updatedAt")
      SELECT ${p.projectId}, x.path, x.content, now()
      FROM jsonb_to_recordset(${JSON.stringify(ficheros)}::jsonb) AS x(path text, content text)
      WHERE EXISTS (SELECT 1 FROM actualizado)
      ON CONFLICT ("projectId", "path") DO UPDATE SET "content" = EXCLUDED."content", "updatedAt" = now()
      RETURNING "path"
    )
    SELECT (SELECT count(*) FROM actualizado)::int AS "actualizado", (SELECT count(*) FROM escritos)::int AS "escritos"
  `);
  const fila = (res.rows as Array<{ actualizado: number }>)[0];
  return Number(fila?.actualizado ?? 0) === 1;
}
