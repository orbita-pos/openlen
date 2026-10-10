// El esquema `storage` en la base de un proyecto, la primera vez que hace
// falta. Lo llama `ensureProvisioned` (lib/backend/registry.ts, bloque
// «carril D»), por donde pasan las peticiones del backend (serve.ts) y
// `supabase db push` (cli.ts): así existe antes de la primera migración de Len
// que haga `insert into storage.buckets`, también en las bases creadas antes
// de que hubiera Storage (ésas ya no vuelven a provisionDatabase).
//
// Una vez por proceso (un `Set`); el cerrojo de aviso, DENTRO de la base del
// proyecto (son por base: el de `postgres` no serializa nada aquí), y
// `initStorageSchema` vuelve a mirar si ya está antes de montarlo. Todo en una
// transacción: si algo falla, no queda un esquema a medias.

import type { SqlRunner } from "../db";
import { initStorageSchema, STORAGE_CLUSTER_ROLES_SQL } from "./schema";

/** `withAdmin` de lib/backend/pg.ts (o un doble en las pruebas). */
export type AdminRunner = <T>(dbName: string, fn: (runner: SqlRunner) => Promise<T>) => Promise<T>;

// El scope de un entorno (lib/backend/environments.ts): su base es `ol_<scope>`.
const SCOPE_RE = /^[a-z]{20}(_[dl])?$/;
const REF_RE = /^[a-z]{20}$/;
const done = new Set<string>();

/** Para las pruebas, y para `db reset`: la base se rehace, el esquema también. */
export function forgetStorageProvisioned(scope?: string): void {
  if (scope === undefined) done.clear();
  else done.delete(scope);
}

/** El esquema en la base de UN entorno (`ol_<scope>`), con el rol de
 *  desarrollador del proyecto (`ol_<ref>`). */
export async function ensureStorageProvisioned(o: { scope: string; ref: string }, admin?: AdminRunner): Promise<void> {
  if (done.has(o.scope)) return;
  if (!SCOPE_RE.test(o.scope)) throw new Error(`scope no válido: ${o.scope}`);
  if (!REF_RE.test(o.ref)) throw new Error(`ref no válido: ${o.ref}`);
  const run: AdminRunner = admin ?? (await import("../pg")).withAdmin;
  const dbName = `ol_${o.scope}`;
  const dev = `ol_${o.ref}`;
  await run("postgres", (r) => r.exec(STORAGE_CLUSTER_ROLES_SQL));
  await run(dbName, async (r) => {
    await r.exec("BEGIN");
    try {
      await r.query(`select pg_advisory_xact_lock(hashtext($1))`, [`pages-storage:${o.scope}`]);
      await initStorageSchema(r, { devRole: dev });
      await r.exec("COMMIT");
    } catch (err) {
      await r.exec("ROLLBACK").catch(() => {});
      throw err;
    }
  });
  done.add(o.scope);
}
