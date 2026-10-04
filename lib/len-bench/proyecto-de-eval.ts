/**
 * LA CUENTA Y LOS PROYECTOS DE USAR Y TIRAR de Len-Bench.
 *
 * Vivían en `lib/agent/evals/harness.ts`, el corredor de la batería de Len 1.x,
 * que se retiró con Len 2.0 (2026-09-24): medía el vocabulario por `data-op-id`
 * y Len-Bench la sustituye como vara. Esto es lo único que Len-Bench usaba de
 * él, mudado sin cambios.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { dropPageDatabase, pageDatabaseRef } from "@/lib/backend/teardown";
import type { ProjectData } from "@/lib/projects/types";
import { identidadDeEval } from "./eval-identity";

/** La cuenta de eval, estrictamente de EVAL_USER_EMAIL — sin valor por
 *  defecto, para que un valor que falte o no exista falle en voz alta en vez
 *  de tocar los datos de otra cuenta. */
export async function resolveEvalUser(): Promise<{ id: string; email: string }> {
  // La cuenta tiene que ser una IDENTIDAD DE EVALUACIÓN, no una cualquiera. Un
  // turno del Agente puede llamar a `recordar_preferencia`, y eso escribe en
  // `users.agentMemory` — la memoria que cruza todos los proyectos de esa
  // persona— mientras la limpieza sólo borra el proyecto. Ver ./eval-identity.ts
  // para por qué la puerta es una etiqueta en el correo.
  const identidad = identidadDeEval(process.env.EVAL_USER_EMAIL);
  if (!identidad.ok) throw new Error(identidad.motivo);
  const email = identidad.email;
  const rows = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (!rows[0]) {
    throw new Error(`EVAL_USER_EMAIL="${email}" matches no users row — create the account or fix the env var.`);
  }
  return rows[0];
}

/** Inserta un proyecto de usar y tirar y devuelve su id. */
export async function createThrowawayProject(
  userId: string,
  caseId: string,
  data: ProjectData,
  // Len-Bench pasa la fila que tendría el proyecto de un dueño real: el agente
  // lee título y brief, y el de por defecto nombra el caso que se califica.
  fila?: { title: string; brief: string },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.projects).values({
    id,
    userId,
    title: fila?.title ?? `Agent Eval ${caseId}`,
    brief: fila?.brief ?? "Agent eval throwaway fixture — safe to delete.",
    data,
  });
  return id;
}

/** La memoria de usuario ANTES del caso, para poder devolverla: una identidad
 *  dedicada tampoco debe ARRASTRAR lo que dijo el caso anterior. */
export async function snapshotAgentMemory(userId: string): Promise<string | null> {
  const rows = await db
    .select({ m: schema.users.agentMemory })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0]?.m ?? null;
}

export async function restoreAgentMemory(userId: string, previo: string | null): Promise<void> {
  await db.update(schema.users).set({ agentMemory: previo }).where(eq(schema.users.id, userId));
}

export async function deleteThrowawayProject(projectId: string): Promise<void> {
  // ON DELETE CASCADE en cada FK de projects borra lo que cuelga (versiones,
  // chatUsers…), el mismo borrado de una fila que usa `deleteProject`. La base
  // de la página, si Len le creó una, vive en otro clúster y no cuelga de
  // ninguna FK: se lee su `ref` antes y se borra después, como allí.
  const ref = await pageDatabaseRef(projectId);
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  if (ref) await dropPageDatabase(ref);
}
