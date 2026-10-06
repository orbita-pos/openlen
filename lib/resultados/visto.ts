/**
 * «VISTO» DE UN FORMULARIO — la regla, en un solo sitio
 * (plans/len-resultados/diseno.md §6).
 *
 * Un formulario está visto si tiene `seenAt` (Len lo abrió entero) o si llegó
 * antes de `users.lastSeenLeadsAt` (el usuario abrió la pestaña Formularios).
 * El globito de la bandeja y `list_form_submissions` cuentan con ESTA condición: si
 * cada uno tuviera la suya, Len y el globito dirían números distintos.
 */
import { and, eq, gt, isNull, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export function condicionSinVer(lastSeenLeadsAt: Date | null): SQL {
  const sinMarca = isNull(schema.formSubmissions.seenAt);
  return (lastSeenLeadsAt ? and(sinMarca, gt(schema.formSubmissions.createdAt, lastSeenLeadsAt)) : sinMarca) as SQL;
}

export async function ultimaVistaDeFormularios(userId: string): Promise<Date | null> {
  const r = await db
    .select({ lastSeenLeadsAt: schema.users.lastSeenLeadsAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return r[0]?.lastSeenLeadsAt ?? null;
}

/** Marca UNO como visto. `false` si no es de este proyecto: el id viene del
 *  modelo y no se le cree. */
export async function marcarFormularioVisto(projectId: string, id: string): Promise<boolean> {
  const r = await db
    .update(schema.formSubmissions)
    .set({ seenAt: new Date() })
    .where(and(eq(schema.formSubmissions.id, id), eq(schema.formSubmissions.projectId, projectId)))
    .returning({ id: schema.formSubmissions.id });
  return r.length > 0;
}
