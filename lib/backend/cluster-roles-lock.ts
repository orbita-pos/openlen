// Los roles del clúster de las páginas (`authenticator`, `anon`,
// `authenticated`, los `supabase_*_admin` y el de desarrollador de cada
// proyecto) son de TODO el clúster, no de una base. Dos altas a la vez que los
// tocan chocan en la misma fila del catálogo («tuple concurrently updated», o
// una clave duplicada en `pg_db_role_setting` al crear o ajustar el mismo rol)
// y una de las dos se cae: medido con seis altas a la vez contra un Postgres de
// verdad (scopes.e2e.test.ts). Este candado las pone en fila.
//
// Va en la base `postgres` (un candado consultivo es de UNA base: tomado en la
// del proyecto no protegería nada) y dentro de una transacción, así que se
// suelta solo al terminar o al fallar; el DDL de roles es transaccional.
// `CREATE DATABASE` no cabe en una transacción: queda fuera, bajo el candado
// de su entorno.

import type { SqlRunner } from "./db";

const CLUSTER_ROLES_LOCK = "pages-backend:cluster-roles";

export async function withClusterRolesLock(r: SqlRunner, fn: () => Promise<void>): Promise<void> {
  await r.exec("BEGIN");
  try {
    await r.query(`select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext($1))`, [CLUSTER_ROLES_LOCK]);
    await fn();
    await r.exec("COMMIT");
  } catch (err) {
    await r.exec("ROLLBACK").catch(() => {});
    throw err;
  }
}
