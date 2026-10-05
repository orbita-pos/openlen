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

const REF_RE = /^[a-z]{20}$/;
const done = new Set<string>();

/** Para las pruebas. */
export function forgetStorageProvisioned(): void {
  done.clear();
}

export async function ensureStorageProvisioned(ref: string, admin?: AdminRunner): Promise<void> {
  if (done.has(ref)) return;
  if (!REF_RE.test(ref)) throw new Error(`ref no válido: ${ref}`);
  const run: AdminRunner = admin ?? (await import("../pg")).withAdmin;
  const dev = `ol_${ref}`;
  await run("postgres", (r) => r.exec(STORAGE_CLUSTER_ROLES_SQL));
  await run(dev, async (r) => {
    await r.exec("BEGIN");
    try {
      await r.query(`select pg_advisory_xact_lock(hashtext($1))`, [`pages-storage:${ref}`]);
      await initStorageSchema(r, { devRole: dev });
      await r.exec("COMMIT");
    } catch (err) {
      await r.exec("ROLLBACK").catch(() => {});
      throw err;
    }
  });
  done.add(ref);
}
