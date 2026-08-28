import "server-only";

// lib/agent/user-memory.ts — lo que el Agente sabe de la PERSONA, no del
// proyecto.
//
// POR QUÉ EXISTE. `recordar_preferencia` escribía en `projects.userBrief`, que
// es por proyecto. MEDIDO el 2026-08-22: el usuario dice «una cosa importante
// para TODAS mis páginas: nunca escribas Contáctanos», el modelo la guarda y
// confirma en su respuesta «aplica a todas tus páginas de aquí en adelante» —
// sobre una columna que el proyecto siguiente no lee nunca. El Agente ya
// prometía memoria de usuario; sólo no la tenía.
//
// TRES DECISIONES —TEXTO y no filas, ACOTADO, y LLENO NO BORRA— explicadas
// donde ahora viven: `lib/agent/documento-de-memoria.ts`. Se fueron allí el
// 2026-08-27, cuando apareció la segunda memoria —la del NEGOCIO— y copiarlas
// habría dado dos implementaciones de la misma regla. Aquí queda lo que de
// verdad es de este fichero: QUÉ columna, y de quién.

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { anadirLinea, quitarLinea, type DocumentoDeMemoria } from "./documento-de-memoria";

/** Un décimo del brief de proyecto (4000): esto son REGLAS de trato y de
 *  estilo, no contenido. Si no caben, es que se está guardando lo que no se
 *  debe. El documento del NEGOCIO tiene su propio tope, más ancho, porque carga
 *  sustancia — ver `lib/business-profiles/documento.ts`. */
export const AGENT_MEMORY_MAX = 400;

// EL FORMATEADOR (`userMemoryBlock`) NO VIVE AQUÍ, y no es casualidad:
// lib/agent/context.ts declara en su encabezado que se mantiene libre de
// @/lib/db para que su prueba corra sin bindings nativos, y este módulo SÍ
// importa la base. El formateo es puro, así que vive allá; aquí sólo la
// lectura y la escritura.

/** Encabeza el bloque para que el modelo (y el usuario, si algún día lo ve)
 *  sepan de dónde salió cada línea. */
export const MEMORY_MARKER_LINE = "— Lo que sé de ti —";

const DOC: DocumentoDeMemoria = { marcador: MEMORY_MARKER_LINE, max: AGENT_MEMORY_MAX };

export async function getUserMemory(userId: string): Promise<string | null> {
  const rows = await db
    .select({ agentMemory: schema.users.agentMemory })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const v = rows[0]?.agentMemory?.trim();
  return v ? v : null;
}

export type MemoryWrite =
  | { readonly ok: true; readonly yaExistia: boolean }
  | { readonly ok: false; readonly reason: "llena" | "no_guardado" };

/** Añade una preferencia a la memoria de la PERSONA. Idempotente por texto; el
 *  cómo —y el porqué de que el de-duplicado sea tonto a propósito— viven en
 *  `documento-de-memoria.ts`. */
export async function rememberAboutUser(
  userId: string,
  preferencia: string,
): Promise<MemoryWrite> {
  const r = anadirLinea(await getUserMemory(userId), preferencia, DOC);
  if (!r.ok) return { ok: false, reason: "llena" };
  if (r.yaExistia) return { ok: true, yaExistia: true };

  const res = await db
    .update(schema.users)
    .set({ agentMemory: r.texto })
    .where(eq(schema.users.id, userId))
    .returning({ id: schema.users.id });
  return res.length > 0 ? { ok: true, yaExistia: false } : { ok: false, reason: "no_guardado" };
}

/** Quita una preferencia. Existe porque una memoria a la que sólo se puede
 *  AÑADIR es una trampa: el día que guarde algo mal, el usuario se queda con
 *  ello puesto en todas sus páginas para siempre. No hay herramienta del
 *  modelo que llame a esto todavía — el borrado es del dueño. */
export async function forgetAboutUser(userId: string, preferencia: string): Promise<boolean> {
  const r = quitarLinea(await getUserMemory(userId), preferencia, DOC);
  if (!r.quitada) return false;
  const res = await db
    .update(schema.users)
    .set({ agentMemory: r.texto })
    .where(and(eq(schema.users.id, userId)))
    .returning({ id: schema.users.id });
  return res.length > 0;
}
