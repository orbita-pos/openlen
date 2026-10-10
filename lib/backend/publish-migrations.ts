// PUBLICAR LAS MIGRACIONES (spec local 2026-10-09, sección 6): lo que se probó
// en el borrador —sus filas de `schema_migrations`, con sus sentencias— y
// producción aún no tiene. Antes de aplicarlo se ENSAYA en producción dentro de
// una transacción que acaba en ROLLBACK, para saber si falla y qué datos reales
// destruiría; se cuentan después, con SELECT normales, sin bloquear nada.

import "server-only";

import { createHash } from "node:crypto";

import type { DestructiveChange } from "./data-changes-types";
import { dbNameOf, type ScopeCreds } from "./environments";
import { withAdmin, withLogin } from "./pg";
import { devRoleOf } from "./provision";
import { migrationLabel, readRecordedMigrations, type RecordedMigration } from "./recorded-migrations";

export type { DestructiveChange } from "./data-changes-types";

export type PendingResult = { readonly ok: true; readonly pending: RecordedMigration[] } | { readonly ok: false; readonly diverged: string[] };

export async function pendingMigrations(draftScope: string, liveScope: string): Promise<PendingResult> {
  const [draft, live] = await Promise.all([readRecordedMigrations(draftScope), readRecordedMigrations(liveScope)]);
  const inDraft = new Set(draft.map((m) => m.version));
  const diverged = live.filter((m) => !inDraft.has(m.version)).map((m) => m.version);
  if (diverged.length > 0) return { ok: false, diverged };
  const inLive = new Set(live.map((m) => m.version));
  return { ok: true, pending: draft.filter((m) => !inLive.has(m.version)) };
}

export function fingerprintOf(pending: readonly RecordedMigration[]): string {
  return createHash("sha256")
    .update(JSON.stringify(pending.map((m) => [m.version, m.statements])))
    .digest("hex");
}

export interface ColumnShape {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly type: string;
}

const SYSTEM_SCHEMAS = [
  "auth",
  "storage",
  "realtime",
  "supabase_migrations",
  "openlen_backups",
  "information_schema",
  "extensions",
  "graphql",
  "graphql_public",
  "net",
  "pgbouncer",
  "vault",
  "cron",
];

const CATALOG_SQL = `
select n.nspname as schema, c.relname as "table", a.attname as "column",
       pg_catalog.format_type(a.atttypid, a.atttypmod) as type
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
   and n.nspname <> all($1::text[]) and n.nspname not like 'pg\\_%'
 order by 1, 2, 3`;

export function diffCatalog(before: readonly ColumnShape[], after: readonly ColumnShape[]) {
  const key = (c: { schema: string; table: string }) => `${c.schema}.${c.table}`;
  const afterTables = new Set(after.map(key));
  const afterCols = new Map(after.map((c) => [`${key(c)}.${c.column}`, c.type]));
  const droppedTables: { schema: string; table: string }[] = [];
  const droppedColumns: { schema: string; table: string; column: string }[] = [];
  const retyped: { schema: string; table: string; column: string; from: string; to: string }[] = [];
  const seen = new Set<string>();
  for (const c of before) {
    if (!afterTables.has(key(c))) {
      if (!seen.has(key(c))) droppedTables.push({ schema: c.schema, table: c.table });
      seen.add(key(c));
      continue;
    }
    const now = afterCols.get(`${key(c)}.${c.column}`);
    if (now === undefined) droppedColumns.push({ schema: c.schema, table: c.table, column: c.column });
    else if (now !== c.type) retyped.push({ schema: c.schema, table: c.table, column: c.column, from: c.type, to: now });
  }
  return { droppedTables, droppedColumns, retyped };
}

const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
const qualified = (schema: string, table: string) => (schema === "public" ? table : `${schema}.${table}`);
const sqlName = (schema: string, table: string) => `${ident(schema)}.${ident(table)}`;
const excerpt = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}...` : s);

type Client = import("pg").Client;

async function countAll(c: Client, tables: readonly { schema: string; table: string }[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const t of tables) {
    const r = await c.query(`select count(*)::bigint as n from ${sqlName(t.schema, t.table)}`);
    out.set(`${t.schema}.${t.table}`, Number(r.rows[0]?.n ?? 0));
  }
  return out;
}

function uniqueTables(cols: readonly ColumnShape[]): { schema: string; table: string }[] {
  const m = new Map<string, { schema: string; table: string }>();
  for (const c of cols) m.set(`${c.schema}.${c.table}`, { schema: c.schema, table: c.table });
  return [...m.values()];
}

export type Rehearsal =
  | { readonly ok: true; readonly destructive: DestructiveChange[]; readonly fingerprint: string }
  | {
      readonly ok: false;
      readonly migration: string;
      readonly statementIndex: number;
      readonly statement: string;
      readonly error: { readonly message: string; readonly code?: string };
    };

type Failure = Extract<Rehearsal, { ok: false }>;

function pgError(e: unknown): { message: string; code?: string } {
  const er = e as { message?: string; code?: string };
  return { message: er.message ?? String(e), ...(er.code ? { code: er.code } : {}) };
}

export async function rehearse(live: ScopeCreds, pending: readonly RecordedMigration[]): Promise<Rehearsal> {
  const deletes: DestructiveChange[] = [];
  let diff: ReturnType<typeof diffCatalog> | null = null;
  const failure = await withLogin(dbNameOf(live.scope), devRoleOf(live.ref), live.password, async (c): Promise<Failure | null> => {
    await c.query("BEGIN");
    try {
      await c.query("set local lock_timeout = '3s'");
      await c.query("set local statement_timeout = '30s'");
      const before = (await c.query(CATALOG_SQL, [SYSTEM_SCHEMAS])).rows as ColumnShape[];
      for (const m of pending) {
        for (let i = 0; i < m.statements.length; i++) {
          const stmt = m.statements[i]!;
          const truncating = /^\s*truncate\b/i.test(stmt);
          const tables = truncating ? uniqueTables((await c.query(CATALOG_SQL, [SYSTEM_SCHEMAS])).rows as ColumnShape[]) : [];
          const counted = truncating ? await countAll(c, tables) : null;
          let res;
          try {
            res = await c.query(stmt);
          } catch (e) {
            return { ok: false, migration: migrationLabel(m), statementIndex: i, statement: stmt, error: pgError(e) };
          }
          if (res.command === "DELETE" && (res.rowCount ?? 0) > 0) {
            deletes.push({ kind: "delete_rows", migration: migrationLabel(m), statement: excerpt(stmt), count: res.rowCount ?? 0 });
          }
          if (counted) {
            const now = await countAll(c, tables);
            let gone = 0;
            for (const [k, n] of counted) gone += Math.max(0, n - (now.get(k) ?? 0));
            if (gone > 0) deletes.push({ kind: "delete_rows", migration: migrationLabel(m), statement: excerpt(stmt), count: gone });
          }
        }
      }
      diff = diffCatalog(before, (await c.query(CATALOG_SQL, [SYSTEM_SCHEMAS])).rows as ColumnShape[]);
      return null;
    } finally {
      await c.query("ROLLBACK").catch(() => {});
    }
  });
  if (failure) return failure;
  const d = diff ?? { droppedTables: [], droppedColumns: [], retyped: [] };
  // Los datos REALES afectados, contados fuera de la transacción: SELECT
  // normales, que no bloquean a la publicada.
  const counted = await withAdmin(dbNameOf(live.scope), async (r) => {
    const out: DestructiveChange[] = [];
    for (const t of d.droppedTables) {
      const n = Number((await r.query(`select count(*)::bigint as n from ${sqlName(t.schema, t.table)}`)).rows[0]?.n ?? 0);
      out.push({ kind: "drop_table", table: qualified(t.schema, t.table), count: n });
    }
    for (const c of d.droppedColumns) {
      const n = Number((await r.query(`select count(${ident(c.column)})::bigint as n from ${sqlName(c.schema, c.table)}`)).rows[0]?.n ?? 0);
      out.push({ kind: "drop_column", table: qualified(c.schema, c.table), column: c.column, count: n });
    }
    for (const c of d.retyped) {
      const n = Number((await r.query(`select count(${ident(c.column)})::bigint as n from ${sqlName(c.schema, c.table)}`)).rows[0]?.n ?? 0);
      out.push({ kind: "alter_type", table: qualified(c.schema, c.table), column: c.column, from: c.from, to: c.to, count: n });
    }
    return out;
  });
  // Lo que no toca ningún dato real no se pregunta.
  const destructive = [...counted, ...deletes].filter((x) => x.count > 0);
  return { ok: true, destructive, fingerprint: fingerprintOf(pending) };
}

export function tablesToBackUp(destructive: readonly DestructiveChange[]): string[] {
  const out: string[] = [];
  for (const d of destructive) if (d.kind !== "delete_rows" && !out.includes(d.table)) out.push(d.table);
  return out;
}

export type ApplyPendingResult = { readonly ok: true } | Failure;

/** Las pendientes, en UNA transacción, con su fila en `schema_migrations`. Si
 *  hay tablas que pierden datos (confirmado por el dueño), antes se copian a
 *  `openlen_backups`: la red que no da la copia nocturna (hasta 24 h). */
export async function applyPending(
  live: ScopeCreds,
  pending: readonly RecordedMigration[],
  o: { backupTables: readonly string[] },
): Promise<ApplyPendingResult> {
  return withLogin(dbNameOf(live.scope), devRoleOf(live.ref), live.password, async (c): Promise<ApplyPendingResult> => {
    let at: { m: RecordedMigration; i: number } | null = null;
    try {
      await c.query("BEGIN");
      await c.query("set local lock_timeout = '3s'");
      await c.query("set local statement_timeout = '30s'");
      if (o.backupTables.length > 0) {
        const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
        await c.query("create schema if not exists openlen_backups");
        for (const t of o.backupTables) {
          const [schema, table] = t.includes(".") ? (t.split(".", 2) as [string, string]) : ["public", t];
          const copy = `${table}_${stamp}`.slice(0, 63);
          await c.query(`create table openlen_backups.${ident(copy)} as table ${sqlName(schema, table)}`);
        }
      }
      for (const m of pending) {
        for (let i = 0; i < m.statements.length; i++) {
          at = { m, i };
          await c.query(m.statements[i]!);
        }
        at = null;
        await c.query(`insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)`, [m.version, m.name, m.statements]);
      }
      await c.query("COMMIT");
      return { ok: true };
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      return {
        ok: false,
        migration: at ? migrationLabel(at.m) : "openlen_backups",
        statementIndex: at?.i ?? 0,
        statement: at ? at.m.statements[at.i]! : "",
        error: pgError(e),
      };
    }
  });
}
