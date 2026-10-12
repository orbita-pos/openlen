// lib/functions/secret-store-pg.ts — LOS SECRETOS EN LA BASE DE LA APP
// (`functionSecrets`): el valor con `encryptToken` (aes-256-gcm, llave derivada
// de NEXTAUTH_SECRET) y su huella. `list` no lee la columna del valor.

import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/integrations/crypto";

import type { SecretStore } from "./secret-store";
import { secretDigest } from "./secrets";

const T = schema.functionSecrets;

export const pgSecretStore: SecretStore = {
  async list(projectId) {
    return db
      .select({ environment: T.environment, name: T.name, digest: T.digest, updatedAt: T.updatedAt, updatedBy: T.updatedBy })
      .from(T)
      .where(eq(T.projectId, projectId))
      .orderBy(asc(T.environment), asc(T.name));
  },
  async values(projectId, env) {
    const filas = await db.select({ name: T.name, v: T.valueEncrypted }).from(T).where(and(eq(T.projectId, projectId), eq(T.environment, env)));
    return Object.fromEntries(filas.map((f) => [f.name, decryptToken(f.v)]));
  },
  async set(projectId, env, entries, by) {
    const ahora = new Date();
    const filas = Object.entries(entries).map(([name, value]) => ({
      projectId,
      environment: env,
      name,
      valueEncrypted: encryptToken(value),
      digest: secretDigest(value),
      updatedAt: ahora,
      updatedBy: by,
    }));
    if (filas.length === 0) return;
    // UNA sentencia: o entran todos, o ninguno.
    await db
      .insert(T)
      .values(filas)
      .onConflictDoUpdate({
        target: [T.projectId, T.environment, T.name],
        set: {
          valueEncrypted: sql`excluded."valueEncrypted"`,
          digest: sql`excluded."digest"`,
          updatedAt: sql`excluded."updatedAt"`,
          updatedBy: sql`excluded."updatedBy"`,
        },
      });
  },
  async unset(projectId, env, names) {
    if (names.length === 0) return [];
    const r = await db
      .delete(T)
      .where(and(eq(T.projectId, projectId), eq(T.environment, env), inArray(T.name, [...names])))
      .returning({ name: T.name });
    return r.map((x) => x.name).sort();
  },
};
