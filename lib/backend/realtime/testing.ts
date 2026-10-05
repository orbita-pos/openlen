// Un proyecto de prueba con Realtime: el de storage (lib/backend/storage/
// testing.ts, que ya trae GoTrue) más el esquema `realtime` de Supabase, y la
// migración del desarrollador aplicada con su rol (como `supabase db push`).
// Sólo para pruebas.

import type { SqlRunner } from "../db";
import { asRole } from "../testing/pglite";
import { TEST_REF, type TestProject } from "../testing/project";
import { newStorageTestProject } from "../storage/testing";
import { initRealtimeSchema, REALTIME_CLUSTER_ROLES_SQL } from "./schema";

export async function newRealtimeTestProject(migration: string): Promise<TestProject> {
  const t = await newStorageTestProject("");
  const runner: SqlRunner = {
    exec: async (sql) => {
      await t.pg.exec(sql);
    },
    query: async (sql, params) => ({ rows: (await t.pg.query(sql, params as unknown[] | undefined)).rows as Record<string, unknown>[] }),
  };
  await runner.exec(REALTIME_CLUSTER_ROLES_SQL);
  await runner.exec("begin");
  await initRealtimeSchema(runner, { devRole: `ol_${TEST_REF}` });
  await runner.exec("commit");
  if (migration) {
    const r = await asRole(t.pg, `ol_${TEST_REF}`, null, (q) => q(migration));
    if (r && typeof r === "object" && "error" in r) throw new Error(String(r.error));
  }
  return t;
}
