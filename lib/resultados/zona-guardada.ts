import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { zonaValida } from "./zona";

/** La zona del navegador, guardada donde ya la leen los avisos. Las rutinas
 *  (pieza 2) corren sin navegador y la leerán de aquí. */
export async function guardarZona(userId: string, zona: string): Promise<void> {
  await db
    .insert(schema.notificationPreferences)
    .values({ userId, timezone: zona })
    .onConflictDoUpdate({
      target: schema.notificationPreferences.userId,
      set: { timezone: zona, updatedAt: new Date() },
    });
}

/** Sin fila, `null`. Con fila, la zona si es válida (el valor por defecto de la
 *  columna es `America/Lima`, que es válido: se devuelve tal cual). */
export async function leerZona(userId: string): Promise<string | null> {
  const r = await db
    .select({ timezone: schema.notificationPreferences.timezone })
    .from(schema.notificationPreferences)
    .where(eq(schema.notificationPreferences.userId, userId))
    .limit(1);
  return r[0] ? zonaValida(r[0].timezone) : null;
}
