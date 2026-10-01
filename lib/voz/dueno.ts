import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** ¿Es de este usuario? Un proyecto ajeno y uno que no existe dan lo mismo. */
export async function esDuenoDelProyecto(projectId: string, userId: string): Promise<boolean> {
  const r = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  return r.length > 0;
}
