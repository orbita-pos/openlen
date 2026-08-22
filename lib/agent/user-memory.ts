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
// TRES DECISIONES, y sus porqués:
//
//   · TEXTO, no filas. Esto se lee ENTERO en cada turno de cada proyecto. Una
//     tabla permitiría consultar, pero no hay a quién consultarle: el modelo
//     necesita las diez líneas delante, no un buscador.
//   · ACOTADO y pequeño. Al ir en todos los prompts, cada carácter se paga
//     siempre. `AGENT_MEMORY_MAX` es un décimo del brief del proyecto a
//     propósito: si no cabe, es que se está guardando lo que no se debe.
//   · LLENO NO BORRA. Al llegar al tope se rechaza la escritura nueva y se le
//     dice al modelo que avise; jamás se tira una línea vieja para hacer sitio.
//     Olvidar en silencio algo que el usuario pidió recordar es peor que no
//     recordar lo nuevo.

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Un décimo del brief de proyecto (4000). Ver la nota de arriba. */
export const AGENT_MEMORY_MAX = 400;

// EL FORMATEADOR (`userMemoryBlock`) NO VIVE AQUÍ, y no es casualidad:
// lib/agent/context.ts declara en su encabezado que se mantiene libre de
// @/lib/db para que su prueba corra sin bindings nativos, y este módulo SÍ
// importa la base. El formateo es puro, así que vive allá; aquí sólo la
// lectura y la escritura.

/** Encabeza el bloque para que el modelo (y el usuario, si algún día lo ve)
 *  sepan de dónde salió cada línea. */
export const MEMORY_MARKER_LINE = "— Lo que sé de ti —";

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

/**
 * Añade una preferencia a la memoria de la persona. Idempotente por texto.
 *
 * El de-duplicado es por línea EXACTA, igual que el del brief: es tonto a
 * propósito. Detectar que «nunca uses amarillo» y «el amarillo no me gusta»
 * son la misma cosa exige un juicio, y un juicio equivocado aquí o pierde una
 * preferencia o llena la memoria de repeticiones.
 */
export async function rememberAboutUser(
  userId: string,
  preferencia: string,
): Promise<MemoryWrite> {
  const linea = `• ${preferencia}`;
  const actual = (await getUserMemory(userId)) ?? "";
  if (actual.split("\n").some((l) => l.trim() === linea)) {
    return { ok: true, yaExistia: true };
  }

  const base = actual.replace(/\s+$/, "");
  const siguiente = base.includes(MEMORY_MARKER_LINE)
    ? `${base}\n${linea}`
    : base.length > 0
      ? `${base}\n\n${MEMORY_MARKER_LINE}\n${linea}`
      : `${MEMORY_MARKER_LINE}\n${linea}`;

  if (siguiente.length > AGENT_MEMORY_MAX) return { ok: false, reason: "llena" };

  const res = await db
    .update(schema.users)
    .set({ agentMemory: siguiente })
    .where(eq(schema.users.id, userId))
    .returning({ id: schema.users.id });
  return res.length > 0 ? { ok: true, yaExistia: false } : { ok: false, reason: "no_guardado" };
}

/** Quita una preferencia. Existe porque una memoria a la que sólo se puede
 *  AÑADIR es una trampa: el día que guarde algo mal, el usuario se queda con
 *  ello puesto en todas sus páginas para siempre. No hay herramienta del
 *  modelo que llame a esto todavía — el borrado es del dueño. */
export async function forgetAboutUser(userId: string, preferencia: string): Promise<boolean> {
  const actual = await getUserMemory(userId);
  if (!actual) return false;
  const linea = `• ${preferencia}`;
  const quedan = actual.split("\n").filter((l) => l.trim() !== linea);
  if (quedan.length === actual.split("\n").length) return false;
  // Sólo el marcador ⇒ vaciar del todo, no dejar un encabezado huérfano.
  const limpio = quedan.filter((l) => l.trim() !== "" && l.trim() !== MEMORY_MARKER_LINE).length
    ? quedan.join("\n").trim()
    : "";
  const res = await db
    .update(schema.users)
    .set({ agentMemory: limpio === "" ? null : limpio })
    .where(and(eq(schema.users.id, userId)))
    .returning({ id: schema.users.id });
  return res.length > 0;
}
