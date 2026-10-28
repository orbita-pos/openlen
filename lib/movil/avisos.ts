import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { huella } from "./secreto";

const t = schema.movilAvisos;
/** Una suscripción por sesión. Reemplazar el token es atómico (rotación).
 * Token único global: una sesión no puede apropiarse del de otra. */
export async function guardarAvisos(userId: string, llave: string, token: string): Promise<void> {
  await db.insert(t).values({ llaveHuella: huella(llave), userId, token }).onConflictDoUpdate({
    target: t.llaveHuella,
    set: { token, actualizadoEn: new Date() },
    setWhere: eq(t.userId, userId),
  });
}
export async function borrarAvisos(userId: string, llave: string): Promise<void> {
  await db.delete(t).where(and(eq(t.llaveHuella, huella(llave)), eq(t.userId, userId)));
}
export async function avisosActivos(userId: string, llave: string): Promise<boolean> {
  const filas = await db.select({ token: t.token }).from(t).where(and(eq(t.llaveHuella, huella(llave)), eq(t.userId, userId))).limit(1);
  return filas.length > 0;
}
