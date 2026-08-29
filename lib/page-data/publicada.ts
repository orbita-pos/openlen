// La declaración que rige AHORA MISMO para un proyecto.
//
// La fuente de verdad es el HTML publicado —no una tabla de configuración—,
// pero parsear el documento en cada escritura sería absurdo. Se extrae al
// publicar (ver lib/publish/filesystem.ts) y se guarda en `projects.data`.
//
// Eso NO la convierte en configuración: no hay forma de editarla salvo
// republicando la página. Si el modelo borra el bloque, la siguiente
// publicación deja el almacén sin permisos, y entonces sus documentos se
// CONSERVAN y dejan de aceptar escrituras — el dueño puede exportarlos, pero
// nadie escribe en algo que la página ya no declara.

import "server-only";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { Declaracion } from "./declaracion";

export async function declaracionPublicada(projectId: string): Promise<Declaracion> {
  const [fila] = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);

  // `almacenes` es parte de ProjectData, así que esto va tipado y no casteado.
  // El `?? {}` cubre el caso normal: toda página anterior al 2026-08-29 —y toda
  // la que no declare nada— no tiene el campo.
  return fila?.data?.almacenes ?? {};
}
