// Un proyecto de prueba con Storage: el de lib/backend/testing/project.ts más
// el esquema `storage` de Supabase, y la migración del desarrollador aplicada
// con su rol (como `supabase db push`). Sólo para pruebas.

import type { SqlRunner } from "../db";
import { asRole } from "../testing/pglite";
import { newTestProject, TEST_REF, type TestProject } from "../testing/project";
import { initStorageSchema, STORAGE_CLUSTER_ROLES_SQL } from "./schema";

export async function newStorageTestProject(migration: string): Promise<TestProject> {
  const t = await newTestProject("");
  const runner: SqlRunner = {
    exec: async (sql) => {
      await t.pg.exec(sql);
    },
    query: async (sql, params) => ({ rows: (await t.pg.query(sql, params as unknown[] | undefined)).rows as Record<string, unknown>[] }),
  };
  await runner.exec(STORAGE_CLUSTER_ROLES_SQL);
  await initStorageSchema(runner, { devRole: `ol_${TEST_REF}` });
  if (migration) {
    const r = await asRole(t.pg, `ol_${TEST_REF}`, null, (q) => q(migration));
    if (r && typeof r === "object" && "error" in r) throw new Error(String(r.error));
  }
  return t;
}
