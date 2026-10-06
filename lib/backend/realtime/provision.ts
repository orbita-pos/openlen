// El esquema `realtime` en la base de un proyecto, la primera vez que hace
// falta. Como lib/backend/storage/provision.ts: lo llama `ensureProvisioned`
// (lib/backend/registry.ts, bloque «carril D»), por donde pasan las peticiones
// del backend y `supabase db push`; así existe antes de la primera migración de
// Len que haga `alter publication supabase_realtime add table …`, también en las
// bases creadas antes de que hubiera Realtime.
//
// Una vez por proceso (un `Set`); el cerrojo de aviso, DENTRO de la base del
// proyecto; todo en una transacción (los `SET LOCAL` del volcado la piden, y si
// algo falla no queda un esquema a medias).

import type { SqlRunner } from "../db";
import { initRealtimeSchema, REALTIME_CLUSTER_ROLES_SQL } from "./schema";

/** `withAdmin` de lib/backend/pg.ts (o un doble en las pruebas). */
export type AdminRunner = <T>(dbName: string, fn: (runner: SqlRunner) => Promise<T>) => Promise<T>;

const REF_RE = /^[a-z]{20}$/;
const done = new Set<string>();

/** Para las pruebas. */
export function forgetRealtimeProvisioned(): void {
  done.clear();
}

// El rol con el que el sondeo lee el slot (lo crea root; ver la decisión de
// `list_changes` partida en plans/len-agente-2026/plan-2-5/d-tiempo-real.md):
// provisionDatabase le quita CONNECT a PUBLIC en cada base.
const CONNECT_REPLICATION_ROLE = `
do $$ begin
  if exists (select from pg_catalog.pg_roles where rolname = 'openlen_realtime') then
    execute format('grant connect on database %I to openlen_realtime', pg_catalog.current_database());
  end if;
end $$;
`;

export async function ensureRealtimeProvisioned(ref: string, admin?: AdminRunner): Promise<void> {
  if (done.has(ref)) return;
  if (!REF_RE.test(ref)) throw new Error(`ref no válido: ${ref}`);
  const run: AdminRunner = admin ?? (await import("../pg")).withAdmin;
  const dev = `ol_${ref}`;
  await run("postgres", (r) => r.exec(REALTIME_CLUSTER_ROLES_SQL));
  await run(dev, async (r) => {
    await r.exec("BEGIN");
    try {
      await r.query(`select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext($1))`, [`pages-realtime:${ref}`]);
      await initRealtimeSchema(r, { devRole: dev });
      await r.exec(CONNECT_REPLICATION_ROLE);
      await r.exec("COMMIT");
    } catch (err) {
      await r.exec("ROLLBACK").catch(() => {});
      throw err;
    }
  });
  done.add(ref);
}
