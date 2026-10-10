// Las conexiones al clúster de Postgres de las páginas (plans/pages-backend/design.md).
//
//   PAGES_DATABASE_URL            el ADMINISTRADOR del clúster (crea bases y
//                                 roles). Su base no importa: se cambia por la
//                                 del proyecto.
//   PAGES_AUTHENTICATOR_PASSWORD  la contraseña de `authenticator`, el rol con
//                                 el que se atienden las peticiones (y hace
//                                 SET LOCAL ROLE anon/authenticated/…), como
//                                 PostgREST.
//
// Un pool por base, pequeño y que suelta sus conexiones pronto: hay una base
// por proyecto y no pueden quedarse todas abiertas.

import "server-only";
import { Pool, type PoolClient } from "pg";

import type { ProjectDatabase, SqlRunner, TxQuery } from "./db";

export function backendConfigured(): boolean {
  return Boolean(process.env.PAGES_DATABASE_URL && process.env.PAGES_AUTHENTICATOR_PASSWORD);
}

function urlFor(database: string, credentials?: { user: string; password: string }): string {
  const base = process.env.PAGES_DATABASE_URL;
  if (!base) throw new Error("PAGES_DATABASE_URL no está puesta");
  const u = new URL(base);
  u.pathname = `/${database}`;
  if (credentials) {
    u.username = encodeURIComponent(credentials.user);
    u.password = encodeURIComponent(credentials.password);
  }
  return u.toString();
}

const pools = new Map<string, Pool>();
/** Más allá de esto se cierra el pool menos usado: el clúster tiene un tope
 *  de conexiones y cada base abierta gasta las suyas. */
const MAX_POOLS = 40;

function pool(key: string, url: string, max: number): Pool {
  let p = pools.get(key);
  if (p) {
    pools.delete(key);
    pools.set(key, p); // al final: el más reciente
    return p;
  }
  p = new Pool({ connectionString: url, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
  p.on("error", (err) => console.error("[backend/pg] conexión rota", key, err.message));
  pools.set(key, p);
  while (pools.size > MAX_POOLS) {
    const [oldKey, old] = pools.entries().next().value as [string, Pool];
    pools.delete(oldKey);
    void old.end();
  }
  return p;
}

/** Cierra los pools de ESTE proceso hacia una base. Antes de borrarla: el
 *  `with (force)` del borrado les mataría las conexiones ociosas y cada una
 *  saldría como «conexión rota» en el registro. */
export async function closePools(dbName: string): Promise<void> {
  for (const key of [`admin:${dbName}`, `auth:${dbName}`]) {
    const p = pools.get(key);
    if (!p) continue;
    pools.delete(key);
    await p.end();
  }
}

function txQuery(client: PoolClient): TxQuery {
  return async (sql, params) => {
    const r = await client.query(sql, params as unknown[] | undefined);
    return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount ?? r.rows.length };
  };
}

/** La base de un proyecto, vista con `authenticator` (las peticiones). */
export function projectDatabase(dbName: string): ProjectDatabase {
  const p = pool(`auth:${dbName}`, urlFor(dbName, { user: "authenticator", password: process.env.PAGES_AUTHENTICATOR_PASSWORD ?? "" }), 4);
  return {
    async transaction(fn) {
      const client = await p.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(txQuery(client));
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/** Como administrador, en una base (la del proyecto o `postgres`). */
export async function withAdmin<T>(dbName: string, fn: (runner: SqlRunner, client: PoolClient) => Promise<T>): Promise<T> {
  const p = pool(`admin:${dbName}`, urlFor(dbName), 2);
  const client = await p.connect();
  try {
    return await fn(
      {
        exec: async (sql) => {
          await client.query(sql);
        },
        query: async (sql, params) => ({ rows: (await client.query(sql, params as unknown[] | undefined)).rows }),
      },
      client,
    );
  } finally {
    client.release();
  }
}

/** Una conexión PROPIA (no del pool) como `user`: su `session_user` ES ese rol,
 *  así que un `RESET ROLE` en lo que corra no sube a nada. Para las migraciones
 *  de Len, el ensayo de publicar y las lecturas de `db query`. */
export async function withLogin<T>(
  dbName: string,
  user: string,
  password: string,
  fn: (client: import("pg").Client) => Promise<T>,
): Promise<T> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: urlFor(dbName, { user, password }), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Como administrador, con una conexión PROPIA: para lo que retiene la
 *  conexión un buen rato (el cerrojo de una publicación) sin quitarle sitio
 *  al pool de dos. */
export async function withDedicatedAdmin<T>(dbName: string, fn: (client: import("pg").Client) => Promise<T>): Promise<T> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: urlFor(dbName), connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Como el rol de desarrollador del proyecto. */
export function withDeveloper<T>(dbName: string, role: string, password: string, fn: (runner: SqlRunner) => Promise<T>): Promise<T> {
  return withLogin(dbName, role, password, (client) =>
    fn({
      exec: async (sql) => {
        await client.query(sql);
      },
      query: async (sql, params) => ({ rows: (await client.query(sql, params as unknown[] | undefined)).rows }),
    }),
  );
}
