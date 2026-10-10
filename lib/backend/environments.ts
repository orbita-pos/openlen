// Los dos entornos del backend de un proyecto (spec local
// 2026-10-09-borrador-y-produccion-de-datos): `draft` —lo que usan el lienzo,
// los ojos y la terminal de Len— y `live` —lo que usa la publicada—.
//
// De su `scope` sale todo lo que es de UN entorno:
//   la base                       ol_<scope>
//   el rol de sólo lectura (live) ol_<scope>_ro
//   el prefijo de Storage (R2)    <scope>/
//   el slot de Realtime           realtime_<scope>
// El rol de DESARROLLADOR es uno por proyecto (`ol_<ref>`, con su contraseña en
// `projectBackends`): así copiar el borrador con TEMPLATE conserva dueños y
// permisos.
//
// El `scope` se GUARDA: el entorno que ya existía antes de esto conserva el
// suyo (= ref, su base `ol_<ref>` de siempre) y el nuevo toma `<ref>_d` o
// `<ref>_l`. Sin `server-only`: lo importa también el servicio de Realtime
// (scripts/realtime-server.ts), que esbuild empaqueta aparte.

import { and, eq, isNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/integrations/crypto";
import { newJwtSecret } from "./keys";

export type Environment = "draft" | "live";

export const SCOPE_RE = /^[a-z]{20}(_[dl])?$/;
const REF_RE = /^[a-z]{20}$/;

export interface EnvironmentRecord {
  readonly projectId: string;
  readonly environment: Environment;
  readonly scope: string;
  readonly jwtSecretEncrypted: string;
  readonly readOnlyPasswordEncrypted: string | null;
  readonly provisionedAt: Date | null;
}

/** Lo que hace falta para trabajar en la base de UN entorno, ya descifrado. */
export interface ScopeCreds {
  readonly scope: string;
  readonly ref: string;
  /** La del rol de desarrollador del proyecto (`ol_<ref>`). */
  readonly password: string;
}

export function newScope(ref: string, env: Environment): string {
  if (!REF_RE.test(ref)) throw new Error(`ref no válido: ${ref}`);
  return `${ref}_${env === "draft" ? "d" : "l"}`;
}

export function dbNameOf(scope: string): string {
  if (!SCOPE_RE.test(scope)) throw new Error(`scope no válido: ${scope}`);
  return `ol_${scope}`;
}

export function readOnlyRoleOf(scope: string): string {
  return `${dbNameOf(scope)}_ro`;
}

/** La base de un proyecto de ANTES de los dos entornos: producción si está
 *  publicado. Uno despublicado no se distingue de uno que nunca se publicó
 *  (`unpublishProject` borra `publishedAt`): pasa a borrador con lo que tenga. */
export function classifyExistingBackend(p: { status: string | null }): Environment {
  return p.status === "published" ? "live" : "draft";
}

export function credsOf(ref: string, dbPasswordEncrypted: string, e: EnvironmentRecord): ScopeCreds {
  return { scope: e.scope, ref, password: decryptToken(dbPasswordEncrypted) };
}

type Row = typeof schema.projectBackendEnvironments.$inferSelect;

function toRecord(row: Row): EnvironmentRecord {
  return {
    projectId: row.projectId,
    environment: row.environment,
    scope: row.scope,
    jwtSecretEncrypted: row.jwtSecretEncrypted,
    readOnlyPasswordEncrypted: row.readOnlyPasswordEncrypted ?? null,
    provisionedAt: row.provisionedAt ?? null,
  };
}

const T = schema.projectBackendEnvironments;

export async function getEnvironment(projectId: string, env: Environment): Promise<EnvironmentRecord | null> {
  const [row] = await db.select().from(T).where(and(eq(T.projectId, projectId), eq(T.environment, env))).limit(1);
  return row ? toRecord(row) : null;
}

export async function listEnvironments(projectId: string): Promise<EnvironmentRecord[]> {
  return (await db.select().from(T).where(eq(T.projectId, projectId))).map(toRecord);
}

/** El registro del entorno (sin su base: ésa la crea quien lo necesita). Si ya
 *  existe, el que hay. */
export async function createEnvironment(projectId: string, ref: string, env: Environment): Promise<EnvironmentRecord> {
  const rows = await db
    .insert(T)
    .values({ projectId, environment: env, scope: newScope(ref, env), jwtSecretEncrypted: encryptToken(newJwtSecret()) })
    .onConflictDoNothing()
    .returning();
  if (rows[0]) return toRecord(rows[0]);
  const existing = await getEnvironment(projectId, env);
  if (!existing) throw new Error(`no se pudo crear el entorno ${env} de ${projectId}`);
  return existing;
}

export async function markEnvironmentProvisioned(projectId: string, env: Environment): Promise<void> {
  await db.update(T).set({ provisionedAt: new Date() }).where(and(eq(T.projectId, projectId), eq(T.environment, env)));
}

export async function deleteEnvironment(projectId: string, env: Environment): Promise<void> {
  await db.delete(T).where(and(eq(T.projectId, projectId), eq(T.environment, env)));
}

/** Guarda la contraseña del rol de lectura SÓLO si aún no hay una, y devuelve
 *  la que quedó: dos lecturas a la vez acaban usando la misma. */
export async function claimReadOnlyPassword(projectId: string, encrypted: string): Promise<string> {
  await db
    .update(T)
    .set({ readOnlyPasswordEncrypted: encrypted })
    .where(and(eq(T.projectId, projectId), eq(T.environment, "live"), isNull(T.readOnlyPasswordEncrypted)));
  const e = await getEnvironment(projectId, "live");
  if (!e?.readOnlyPasswordEncrypted) throw new Error("producción sin contraseña de lectura");
  return e.readOnlyPasswordEncrypted;
}
