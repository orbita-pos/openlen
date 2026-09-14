import "server-only";

// lib/ai/escritor-guardado.ts — el escritor que la persona FIJÓ para Crear
// (`users.crearWriter`), no el de este turno.
//
// Gemelo exacto de `lib/agent/esfuerzo-guardado.ts`, y a propósito: es la misma
// forma (una preferencia de la persona, guardada en `users`, que como mucho
// MEJORA el turno) y merece las mismas dos protecciones.
//
// LA VALIDACIÓN VIVE AQUÍ porque ésta es la FRONTERA donde un string sin tipar
// entra desde la base de datos. `writerForTurn` confía en el tipo de su
// parámetro; una fila vieja, tocada a mano, o escrita por una versión anterior
// del vocabulario debe degradar a «no eligió» — nunca llegar al cable con un
// papel que `ESCRITORES_ELEGIBLES` no reconoce.
//
// 🔴 ACOTADA Y BLANDA, por la misma razón que su gemelo: una base lenta no
// puede colgar una generación, y la columna llega en el despliegue (paso 6)
// mientras el código ya la pide. Cualquier tropiezo —lento, roto, o una columna
// todavía sin migrar— degrada a `null`, que es «Automático», que es lo que
// Crear ha hecho siempre. Elegir modelo nunca debe poder tumbar Crear.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { conPlazo } from "@/lib/agent/con-plazo";
import { ESCRITORES_ELEGIBLES, type EscritorFijado } from "./provider-switch";

/** Generoso para una fila por clave primaria, y ridículo al lado de escribir
 *  una página entera. Mismo criterio que `ESFUERZO_GUARDADO_TIMEOUT_MS`. */
export const ESCRITOR_GUARDADO_TIMEOUT_MS = 1_500;

async function leerEscritorGuardado(userId: string): Promise<EscritorFijado> {
  const rows = await db
    .select({ crearWriter: schema.users.crearWriter })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const v = rows[0]?.crearWriter?.trim();
  return ESCRITORES_ELEGIBLES.find((e) => e === v) ?? null;
}

export async function getEscritorGuardado(userId: string): Promise<EscritorFijado> {
  return conPlazo(() => leerEscritorGuardado(userId), ESCRITOR_GUARDADO_TIMEOUT_MS, null);
}
