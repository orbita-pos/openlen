// lib/functions/blocks-pg.ts — ¿TIENE ESTE PROYECTO LAS FUNCIONES APAGADAS?
// (spec local 2026-10-11, Parte 3: «una marca por proyecto apaga las suyas»).
// La marca la pone el operador a mano (infra/FUNCTIONS_RUNBOOK.md).

import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export async function functionsBlocked(projectId: string): Promise<boolean> {
  const [fila] = await db
    .select({ p: schema.functionBlocks.projectId })
    .from(schema.functionBlocks)
    .where(eq(schema.functionBlocks.projectId, projectId))
    .limit(1);
  return Boolean(fila);
}
