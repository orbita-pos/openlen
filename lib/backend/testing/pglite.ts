// Postgres de verdad para las pruebas, sin tocar ninguna base: PGlite es
// Postgres 18 compilado a WASM, con roles, RLS y `set_config` como el de
// producción (comprobado el 04/10, plans/pages-backend/design.md).
//
// Sólo para pruebas. En producción la base de cada proyecto es un Postgres
// normal y se habla con `pg` (lib/backend/db.ts).

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

import type { ProjectDatabase, SqlRunner } from "../db";

/** La base de un proyecto en PGlite, con la interfaz de producción. */
export function pgliteProjectDatabase(pg: PGlite): ProjectDatabase {
  return {
    transaction: (fn) =>
      pg.transaction(async (tx) =>
        fn(async (sql, params) => {
          const r = await tx.query(sql, params as unknown[] | undefined);
          return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length };
        }),
      ),
  };
}

export function newTestDatabase(): { pg: PGlite; runner: SqlRunner } {
  const pg = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  const runner: SqlRunner = {
    exec: async (sql) => {
      await pg.exec(sql);
    },
    query: async (sql, params) => {
      const r = await pg.query(sql, params as unknown[] | undefined);
      return { rows: r.rows as Record<string, unknown>[] };
    },
  };
  return { pg, runner };
}

/** Corre `fn` dentro de una transacción con ese rol y esos claims, como lo hace
 *  una petición (`SET LOCAL ROLE` + `request.jwt.claims`). Devuelve lo que
 *  devuelva `fn`, o el mensaje de error de Postgres como `{ error }`. */
export async function asRole<T>(
  pg: PGlite,
  role: string,
  claims: Record<string, unknown> | null,
  fn: (q: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>,
): Promise<T | { error: string; code: string | undefined }> {
  try {
    return await pg.transaction(async (tx) => {
      await tx.query(`select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)`, [
        role,
        JSON.stringify(claims ?? { role }),
      ]);
      // Sin parámetros puede ser una migración entera (varias sentencias):
      // `exec`, y se devuelven las filas de la última.
      return fn(async (sql, params) =>
        params
          ? ((await tx.query(sql, params)).rows as Record<string, unknown>[])
          : (((await tx.exec(sql)).at(-1)?.rows ?? []) as Record<string, unknown>[]),
      );
    });
  } catch (err) {
    const e = err as { message?: string; code?: string };
    return { error: e.message ?? String(err), code: e.code };
  }
}
