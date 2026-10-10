// `supabase db query` (spec local 2026-10-09, sección 8): `--local` en la base
// de pruebas como el rol de desarrollador, `--linked` en producción con el rol
// de sólo lectura. UNA sentencia por llamada (protocolo extendido): un
// `commit; …` no puede escaparse de la transacción.

import "server-only";

import type { QueryOutcome } from "./cli-core";
import { dbNameOf, readOnlyRoleOf, type ScopeCreds } from "./environments";
import { withLogin } from "./pg";
import { devRoleOf } from "./provision";

const MAX_ROWS = 500;
/** Lo que cambia tablas, políticas o funciones: en el borrador va en una
 *  migración, o no llegaría a producción al publicar. */
const SCHEMA_COMMANDS = new Set(["CREATE", "ALTER", "DROP", "GRANT", "REVOKE", "COMMENT", "DO", "SECURITY", "REINDEX", "CLUSTER"]);

/** La huella de las tablas, vistas y secuencias del usuario con sus columnas.
 *  Si cambia, la consulta cambió el esquema aunque su etiqueta no lo diga: un
 *  `SELECT … INTO tabla` sale como «SELECT», y una función puede crear tablas. */
const SCHEMA_FINGERPRINT_SQL = `
select coalesce(md5(string_agg(x, ',' order by x)), '') as h from (
  select n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' ||
         coalesce(a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod), '') as x
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
     and n.nspname not in ('information_schema', 'auth', 'storage', 'realtime', 'supabase_migrations', 'openlen_backups')
     and n.nspname not like 'pg\\_%'
) s`;

type PgResult = { command: string; rowCount: number | null; fields: { name: string }[]; rows: unknown[][] };

function outcome(res: PgResult): QueryOutcome {
  if (res.fields.length === 0) return { kind: "command", tag: res.command };
  return {
    kind: "rows",
    columns: res.fields.map((f) => f.name),
    rows: res.rows.slice(0, MAX_ROWS),
    truncated: res.rows.length > MAX_ROWS,
  };
}

function failure(e: unknown): QueryOutcome {
  const er = e as { message?: string; code?: string };
  return { kind: "error", message: er.message ?? String(e), ...(er.code ? { code: er.code } : {}) };
}

const single = (sql: string) => ({ text: sql, rowMode: "array" as const, queryMode: "extended" as const });

export async function runDraftQuery(creds: ScopeCreds, sql: string): Promise<QueryOutcome> {
  return withLogin(dbNameOf(creds.scope), devRoleOf(creds.ref), creds.password, async (c) => {
    try {
      await c.query("BEGIN");
      await c.query("set local statement_timeout = '10s'");
      const before = String((await c.query(SCHEMA_FINGERPRINT_SQL)).rows[0]?.h ?? "");
      const res = (await c.query(single(sql))) as unknown as PgResult;
      const after = String((await c.query(SCHEMA_FINGERPRINT_SQL)).rows[0]?.h ?? "");
      if (SCHEMA_COMMANDS.has(res.command) || before !== after) {
        await c.query("ROLLBACK");
        return {
          kind: "error",
          message:
            "schema changes go in a migration, so they reach production when the project is published: supabase migration new <name>, write the SQL there, then supabase db push. Nothing was changed.",
        };
      }
      await c.query("COMMIT");
      return outcome(res);
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      return failure(e);
    }
  });
}

export async function runLiveQuery(o: { scope: string; roPassword: string }, sql: string): Promise<QueryOutcome> {
  return withLogin(dbNameOf(o.scope), readOnlyRoleOf(o.scope), o.roPassword, async (c) => {
    try {
      await c.query("BEGIN READ ONLY");
      await c.query("set local statement_timeout = '10s'");
      // Una consulta antes que la de Len: a partir de ahí Postgres ya no deja
      // pasar la transacción a lectura-escritura («must be set before any
      // query»). Es la segunda capa; la primera es que el rol sólo puede SELECT.
      await c.query("select 1");
      return outcome((await c.query(single(sql))) as unknown as PgResult);
    } catch (e) {
      return failure(e);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
  });
}
