import "server-only";

// lib/agent/esfuerzo-guardado.ts — la preferencia de ESFUERZO que la persona
// guardó (`users.agentEffort`), no la de este turno ni la del operador.
//
// LA VALIDACIÓN VIVE AQUÍ, y no en `esfuerzoEfectivo`: ésta es la FRONTERA
// donde un string sin tipar entra al sistema desde la base de datos, mientras
// que `esfuerzoEfectivo` confía en el tipo de su parámetro (`EsfuerzoAgente`).
// Una fila vieja o tocada a mano debe degradar a "sin preferencia" — nunca
// llegar al cable con un valor que `ESFUERZOS` no reconoce.
//
// 🔴 ACOTADA Y BLANDA — Task 5, fix round 1 (R11). La primera versión leía
// directo, sin plazo ni `catch`: una base lenta colgaba el turno, y una
// columna que aún no existe (la migración corre en el deploy, no aquí)
// reventaba `POST /api/agent` entero — el mismo fallo que documenta la
// cabecera de `scripts/build-migrations.mjs` para `publishedHomeHash`. La
// postura es, como mucho, una mejora — igual que la memoria de usuario (ver
// el docstring de `getUserMemoryBounded` en `user-memory.ts`) — así que
// cualquier tropiezo (lento, roto, o una columna todavía sin desplegar)
// degrada a `null`, que `esfuerzoEfectivo` ya sabe leer como "auto". Nunca
// debe retrasar ni tumbar la página de nadie.
//
// El `race` es el mismo que usa `getUserMemoryBounded`, extraído a
// `con-plazo.ts` para no copiarlo una segunda vez. El plazo es SU PROPIA
// constante — no `MEMORIA_TIMEOUT_MS`, que es de la lectura de memoria; una
// constante con dos significados es su propia deriva.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ESFUERZOS, type EsfuerzoAgente } from "./esfuerzo";
import { conPlazo } from "./con-plazo";

/** Generoso para una fila por clave primaria, y ridículo al lado de un turno
 *  del Agente — igual de criterio que `MEMORIA_TIMEOUT_MS` en `user-memory.ts`. */
export const ESFUERZO_GUARDADO_TIMEOUT_MS = 1_500;

async function leerEsfuerzoGuardado(userId: string): Promise<EsfuerzoAgente | null> {
  const rows = await db
    .select({ agentEffort: schema.users.agentEffort })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const v = rows[0]?.agentEffort?.trim().toLowerCase();
  return ESFUERZOS.find((e) => e === v) ?? null;
}

export async function getEsfuerzoGuardado(userId: string): Promise<EsfuerzoAgente | null> {
  return conPlazo(() => leerEsfuerzoGuardado(userId), ESFUERZO_GUARDADO_TIMEOUT_MS, null);
}
