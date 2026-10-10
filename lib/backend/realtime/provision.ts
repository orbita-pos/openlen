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
import { withClusterRolesLock } from "../cluster-roles-lock";
import { initRealtimeSchema, REALTIME_CLUSTER_ROLES_SQL } from "./schema";

/** `withAdmin` de lib/backend/pg.ts (o un doble en las pruebas). */
export type AdminRunner = <T>(dbName: string, fn: (runner: SqlRunner) => Promise<T>) => Promise<T>;

// El scope de un entorno (lib/backend/environments.ts): su base es `ol_<scope>`.
const SCOPE_RE = /^[a-z]{20}(_[dl])?$/;
const REF_RE = /^[a-z]{20}$/;
const done = new Set<string>();

/** Para las pruebas, y para `db reset`: la base se rehace, el esquema también. */
export function forgetRealtimeProvisioned(scope?: string): void {
  if (scope === undefined) done.clear();
  else done.delete(scope);
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

/** El esquema en la base de UN entorno (`ol_<scope>`), con el rol de
 *  desarrollador del proyecto (`ol_<ref>`). */
export async function ensureRealtimeProvisioned(o: { scope: string; ref: string }, admin?: AdminRunner): Promise<void> {
  if (done.has(o.scope)) return;
  if (!SCOPE_RE.test(o.scope)) throw new Error(`scope no válido: ${o.scope}`);
  if (!REF_RE.test(o.ref)) throw new Error(`ref no válido: ${o.ref}`);
  const run: AdminRunner = admin ?? (await import("../pg")).withAdmin;
  const dbName = `ol_${o.scope}`;
  const dev = `ol_${o.ref}`;
  // Roles del clúster: en fila con cualquier otra alta (cluster-roles-lock.ts).
  await run("postgres", (r) => withClusterRolesLock(r, () => r.exec(REALTIME_CLUSTER_ROLES_SQL)));
  await run(dbName, async (r) => {
    await r.exec("BEGIN");
    try {
      await r.query(`select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext($1))`, [`pages-realtime:${o.scope}`]);
      await initRealtimeSchema(r, { devRole: dev });
      await r.exec(CONNECT_REPLICATION_ROLE);
      await r.exec("COMMIT");
    } catch (err) {
      await r.exec("ROLLBACK").catch(() => {});
      throw err;
    }
  });
  done.add(o.scope);
}
