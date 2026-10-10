/**
 * QUIÉN ENTRA A UN PROYECTO, y a qué. El ÚNICO sitio que lo decide.
 *
 * Hasta compartir el proyecto, cada ruta comprobaba «es del dueño»
 * (`projects.userId = yo`) por su cuenta. Eso sigue siendo lo que hacen todas
 * las que no pasan por aquí: POR DEFECTO, SÓLO EL DUEÑO. Una ruta deja entrar
 * a un miembro sólo si llama a `exigirAcceso`, y después trabaja con el id
 * del DUEÑO (`acceso.duenoId`): las funciones de `lib/projects*` siguen
 * filtrando por dueño, y los créditos de Len salen de su saldo.
 *
 * LOS ROLES
 *   · dueno  — todo.
 *   · editor — ver, editar (código, páginas, versiones, Len) y publicar.
 *   · lector — ver.
 *
 * LA AUDITORÍA (2026-10-07). Lo que se abrió, y lo que NO, con su porqué:
 *
 *   ver (lector y editor)
 *     GET /api/projects/[id] (con `rol`), …/ficheros (sin /.openlen/resultados
 *     ni /.openlen/bandeja), …/raw, …/preview, …/pages, …/versions ([vid]/raw),
 *     …/releases, …/assets, …/terminal (su historial), …/env (GET), POST /api/lienzo,
 *     /api/agent/turno/[fila] (reengancharse)
 *   editar (editor)
 *     PATCH /api/projects/[id] (título, brief, logo; NO el estado),
 *     …/ficheros (PUT/POST/PATCH/DELETE) y …/ficheros/versions/[vid]/restore,
 *     …/pages, …/pages/[slug], …/html, …/versions (POST, [vid], [vid]/restore),
 *     …/turnos/[turnId]/deshacer, …/assets (POST), …/ai-edit-image,
 *     …/proxy-image, …/settings, …/env (PUT), …/preview (POST/DELETE), …/terminal (POST,
 *     en SU terminal), …/chat, …/rollback, /api/export/zip,
 *     …/publish (sólo a la dirección que ya tiene: elegir otra es del dueño),
 *     /api/agent (sin encargos, sin los datos de los visitantes, y contra el
 *     tope del proyecto: `lib/projects/miembros.ts`)
 *   SÓLO EL DUEÑO (sin cambios)
 *     borrar o archivar el proyecto, despublicar, su visibilidad en Explorar,
 *     dominios, integraciones, los agentes del chat de visitantes, los miembros
 *     y el tope, los encargos de Len; y lo que lleva DATOS DE TERCEROS
 *     —formularios recibidos (submissions, test-email), resultados (insights,
 *     funnel), el backend de la app (tablas, usuarios, almacenamiento), la
 *     bandeja—: un miembro trabaja en el sitio, no en la gente que lo usa.
 *     Duplicar y remezclar copian el proyecto a la cuenta de quien lo pide;
 *     /api/templates/ai-design (el Chat sin Len, la salida de emergencia):
 *     también sólo el dueño.
 *
 * Un editor puede escribir JavaScript en el sitio, así que puede hacer con lo
 * que el sitio recoja DESDE AHORA lo que el código permita: se invita a
 * editores de confianza. Lo que esto protege es lo ya recogido.
 *
 * Un no-miembro recibe 404 (no se le confirma que el proyecto existe); un
 * lector que intenta editar, 403.
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export type RolEnProyecto = "dueno" | "editor" | "lector";
export type RolDeMiembro = Exclude<RolEnProyecto, "dueno">;
export type Permiso = "ver" | "editar";

export interface AccesoAlProyecto {
  readonly rol: RolEnProyecto;
  /** El dueño: con su id se leen y escriben los datos, y paga Len. */
  readonly duenoId: string;
}

export const ROLES_DE_MIEMBRO: readonly RolDeMiembro[] = ["editor", "lector"];

export function esRolDeMiembro(x: unknown): x is RolDeMiembro {
  return x === "editor" || x === "lector";
}

/** ¿Este rol permite esto? Puro: lo prueba vitest. */
export function puede(rol: RolEnProyecto, permiso: Permiso): boolean {
  if (permiso === "ver") return true;
  return rol === "dueno" || rol === "editor";
}

/** El rol de `userId` en el proyecto, o `null` si no entra (o no existe). */
export async function accesoAlProyecto(projectId: string, userId: string): Promise<AccesoAlProyecto | null> {
  if (!projectId || !userId) return null;
  const filas = await db
    .select({ duenoId: schema.projects.userId, rol: schema.projectMembers.rol })
    .from(schema.projects)
    .leftJoin(
      schema.projectMembers,
      and(eq(schema.projectMembers.projectId, schema.projects.id), eq(schema.projectMembers.userId, userId)),
    )
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const fila = filas[0];
  if (!fila) return null;
  if (fila.duenoId === userId) return { rol: "dueno", duenoId: fila.duenoId };
  if (esRolDeMiembro(fila.rol)) return { rol: fila.rol, duenoId: fila.duenoId };
  return null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Para una ruta: el acceso si puede, o la respuesta que hay que devolver
 * (404 si no entra, 403 si es lector y pide editar).
 *
 *   const a = await exigirAcceso(id, userId, "editar");
 *   if (a instanceof Response) return a;
 *   … con `a.duenoId` …
 */
export async function exigirAcceso(projectId: string, userId: string, permiso: Permiso): Promise<AccesoAlProyecto | Response> {
  const acceso = await accesoAlProyecto(projectId, userId);
  if (!acceso) return json({ error: "not_found" }, 404);
  if (!puede(acceso.rol, permiso)) return json({ error: "solo_lectura", message: "You can view this project but not edit it." }, 403);
  return acceso;
}
