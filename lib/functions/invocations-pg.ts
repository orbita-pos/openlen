// lib/functions/invocations-pg.ts — LAS ÚLTIMAS LLAMADAS DE CADA ENTORNO, con sus
// registros ya tapados y su traza traducida (spec local 2026-10-11, Parte 3):
// de aquí leen `use_page`/`view_page` lo que pasó en su visita. Se guardan 7
// días; la poda corre, como mucho, una vez por hora y por proceso.

import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, isNotNull, lt, or } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { FunctionsEnvironment } from "./engines/types";
import type { InvocationRecord } from "./gateway";

const T = schema.functionInvocations;
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
let ultimaPoda = 0;

export async function recordInvocation(r: InvocationRecord): Promise<void> {
  await db.insert(T).values({
    id: randomUUID(),
    projectId: r.projectId,
    environment: r.environment,
    name: r.name,
    status: r.status,
    errorCode: r.errorCode,
    ms: r.ms,
    logs: r.logs.map((l) => ({ level: l.level, msg: l.msg })),
    error: r.error,
    startedAt: r.startedAt,
  });
  if (Date.now() - ultimaPoda > 60 * 60 * 1000) {
    ultimaPoda = Date.now();
    await db.delete(T).where(lt(T.startedAt, new Date(Date.now() - SIETE_DIAS_MS)));
  }
}

export async function recentInvocations(projectId: string, env: FunctionsEnvironment, since: Date, limit = 20): Promise<InvocationRecord[]> {
  const filas = await db
    .select()
    .from(T)
    .where(and(eq(T.projectId, projectId), eq(T.environment, env), gte(T.startedAt, since)))
    .orderBy(desc(T.startedAt))
    .limit(limit);
  return filas.reverse().map(aRegistro);
}

/** Las llamadas que fallaron (5xx o con código de error), de los dos entornos y
 *  de los últimos 7 días, las más nuevas primero: la vista Funciones. */
export async function recentFunctionErrors(projectId: string, limit = 20): Promise<InvocationRecord[]> {
  const filas = await db
    .select()
    .from(T)
    .where(and(eq(T.projectId, projectId), gte(T.startedAt, new Date(Date.now() - SIETE_DIAS_MS)), or(gte(T.status, 500), isNotNull(T.errorCode))))
    .orderBy(desc(T.startedAt))
    .limit(limit);
  return filas.map(aRegistro);
}

function aRegistro(f: typeof T.$inferSelect): InvocationRecord {
  return {
    projectId: f.projectId,
    environment: f.environment,
    name: f.name,
    status: f.status,
    errorCode: f.errorCode,
    ms: f.ms,
    logs: f.logs,
    error: f.error,
    startedAt: f.startedAt,
  };
}
