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
// Desde plans/len-md (2026-10-08) es el ~/.len/LEN.md de la persona: un
// fichero que Len y ella editan y se SUSTITUYE entero, como el CLAUDE.md de
// Claude Code. ⚰️ Se fue «sólo se añade» (`rememberAboutUser`,
// `forgetAboutUser` y `documento-de-memoria.ts`, con su marcador «— Lo que sé
// de ti —»): una memoria que sólo crece no se puede corregir, y lo viejo se
// quedaba puesto en todas sus páginas. Aquí queda QUÉ columna, y de quién.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { conPlazo } from "./con-plazo";

/** El tope del ~/.len/LEN.md de la persona (plans/len-md): un tercio del
 *  /LEN.md del proyecto (12 000). Son instrucciones suyas, no contenido; va en
 *  el contexto de cada turno, así que cada carácter se paga siempre. */
export const AGENT_MEMORY_MAX = 4_000;

/** Sustituye ENTERO el ~/.len/LEN.md de la persona (plans/len-md): es un
 *  fichero que Len y la persona editan, ya no una lista que sólo crece.
 *  Vacío = `null`, como lo trata `getUserMemory`. */
export async function setPersonalLenMd(userId: string, text: string | null): Promise<boolean> {
  const res = await db
    .update(schema.users)
    .set({ agentMemory: text?.trim() ? text : null })
    .where(eq(schema.users.id, userId))
    .returning({ id: schema.users.id });
  return res.length > 0;
}

// EL FORMATEADOR (`userMemoryBlock`) NO VIVE AQUÍ, y no es casualidad:
// lib/agent/context.ts declara en su encabezado que se mantiene libre de
// @/lib/db para que su prueba corra sin bindings nativos, y este módulo SÍ
// importa la base. El formateo es puro, así que vive allá; aquí sólo la
// lectura y la escritura.

export async function getUserMemory(userId: string): Promise<string | null> {
  const rows = await db
    .select({ agentMemory: schema.users.agentMemory })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const v = rows[0]?.agentMemory?.trim();
  return v ? v : null;
}

/** Cuánto se espera por la memoria antes de seguir SIN ella.
 *
 *  Generoso para una consulta de una fila por clave primaria, y ridículo al
 *  lado de lo que dura un turno de cualquiera de las tres superficies. */
export const MEMORIA_TIMEOUT_MS = 1_500;

/**
 * La lectura ACOTADA — la que deben usar las rutas.
 *
 * 🔴 UN `catch` cubre el fallo pero NO el cuelgue, y esto va antes del primer
 * byte que el usuario ve. Lo destapó la prueba del techo de turno de
 * `/api/generate`: no mockeaba este módulo, la lectura se fue a la base real y
 * colgó el turno entero. Era un aviso sobre producción, no una molestia de
 * test — una base lenta no puede retrasar la página de nadie por una
 * preferencia que es, como mucho, una mejora.
 *
 * Vive AQUÍ y no en cada ruta a propósito: tres copias de este `race` es la
 * forma exacta en que una capacidad se queda a medias en dos superficies.
 *
 * El `race` en sí se extrajo a `con-plazo.ts` (Task 5 R11) cuando apareció el
 * segundo llamador (`getEsfuerzoGuardado`) — misma razón, un nivel más
 * arriba: dos copias de ESTA función habrían sido la misma trampa otra vez.
 */
export async function getUserMemoryBounded(userId: string): Promise<string | null> {
  return conPlazo(() => getUserMemory(userId), MEMORIA_TIMEOUT_MS, null);
}
