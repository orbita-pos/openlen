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
// Modelado a propósito sobre `getUserMemory` en `user-memory.ts`: misma forma,
// mismo `import "server-only"`, mismo select proyectado a una sola columna.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ESFUERZOS, type EsfuerzoAgente } from "./esfuerzo";

export async function getEsfuerzoGuardado(userId: string): Promise<EsfuerzoAgente | null> {
  const rows = await db
    .select({ agentEffort: schema.users.agentEffort })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const v = rows[0]?.agentEffort?.trim().toLowerCase();
  return ESFUERZOS.find((e) => e === v) ?? null;
}
