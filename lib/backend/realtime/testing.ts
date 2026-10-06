// Un proyecto de prueba con Realtime: el de storage (lib/backend/storage/
// testing.ts, que ya trae GoTrue) más el esquema `realtime` de Supabase, y la
// migración del desarrollador aplicada con su rol (como `supabase db push`).
// Sólo para pruebas.

import type { PGlite } from "@electric-sql/pglite";

import type { ProjectDatabase, SqlRunner } from "../db";
import { asRole } from "../testing/pglite";
import { TEST_REF, type TestProject } from "../testing/project";
import { newStorageTestProject } from "../storage/testing";
import { changeSource, type ChangeSource, type WalReader } from "./poller";
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

// ── El slot de wal2json, doblado ────────────────────────────────────────────
//
// PGlite no tiene replicación lógica. Un disparador en cada tabla escribe en
// una cola el mismo JSON que wal2json con las opciones de `list_changes`
// (`format-version` 2, `include-pk`, `include-timestamp`, `include-type-oids`):
//   {action: I|U|D, timestamp, schema, table, columns: [{name, type, typeoid,
//    value}], identity: [...], pk: [{name, type, typeoid}]}
// `identity` es la fila VIEJA como la registra Postgres: con REPLICA IDENTITY
// FULL, entera; por defecto, la clave en un DELETE y en un UPDATE sólo si la
// clave cambió. Lo que lee la cola pasa por el MISMO código que en producción
// (poller.ts `changeSource`: la publicación y `apply_rls`).

const CAPTURE_SQL = `
create schema if not exists realtime_test;
create table if not exists realtime_test.wal (seq bigint generated always as identity primary key, data jsonb not null);
create or replace function realtime_test.capture() returns trigger language plpgsql as $f$
declare
  ident "char" := (select relreplident from pg_class where oid = tg_relid);
  pk jsonb;
  cols jsonb;
  ident_cols jsonb;
  newr jsonb;
  oldr jsonb;
  key_changed bool := false;
  doc jsonb;
begin
  pk := coalesce((
    select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'typeoid', a.atttypid) order by a.attnum)
      from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = tg_relid and i.indisprimary), '[]'::jsonb);
  if tg_op <> 'DELETE' then
    newr := to_jsonb(new);
    cols := (
      select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'typeoid', a.atttypid, 'value', newr -> a.attname) order by a.attnum)
        from pg_attribute a where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped);
  end if;
  if tg_op <> 'INSERT' then
    oldr := to_jsonb(old);
    if tg_op = 'UPDATE' then
      key_changed := exists (select 1 from jsonb_array_elements(pk) k where (newr -> (k ->> 'name')) is distinct from (oldr -> (k ->> 'name')));
    end if;
    if ident = 'f' or (ident = 'd' and (tg_op = 'DELETE' or key_changed)) then
      ident_cols := (
        select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'typeoid', a.atttypid, 'value', oldr -> a.attname) order by a.attnum)
          from pg_attribute a
         where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped
           and (ident = 'f' or a.attname in (select k ->> 'name' from jsonb_array_elements(pk) k)));
    end if;
  end if;
  doc := jsonb_build_object(
    'action', case tg_op when 'INSERT' then 'I' when 'UPDATE' then 'U' else 'D' end,
    'timestamp', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS.US') || '+00',
    'schema', tg_table_schema,
    'table', tg_table_name);
  if cols is not null then doc := doc || jsonb_build_object('columns', cols); end if;
  if ident_cols is not null then doc := doc || jsonb_build_object('identity', ident_cols); end if;
  doc := doc || jsonb_build_object('pk', pk);
  insert into realtime_test.wal (data) values (doc);
  return null;
end $f$;
`;

/** Pone la captura en esas tablas (`schema.tabla`), como superusuario. */
export async function installWalCapture(pg: PGlite, tables: readonly string[]): Promise<void> {
  await pg.exec(CAPTURE_SQL);
  for (const t of tables) {
    await pg.exec(`create trigger realtime_test_capture after insert or update or delete on ${t} for each row execute function realtime_test.capture();`);
  }
}

/** El WalReader de la cola: lo que haría `pg_logical_slot_get_changes` con
 *  `actions` y `add-tables` (las mismas que calcula `list_changes`). */
export function queueWalReader(pg: PGlite): WalReader {
  const ACTION: Record<string, string> = { I: "insert", U: "update", D: "delete" };
  return {
    open: async () => {},
    close: async () => {},
    async read(o) {
      const r = await pg.query<{ data: string }>(
        `delete from realtime_test.wal where seq in (select seq from realtime_test.wal order by seq limit $1) returning seq, data::text as data`,
        [o.maxChanges],
      );
      const tables = new Set(o.addTables.split(","));
      const actions = new Set(o.actions.split(","));
      return [...r.rows]
        .sort((a, b) => Number((a as unknown as { seq: number }).seq) - Number((b as unknown as { seq: number }).seq))
        .map((x) => x.data)
        .filter((d) => {
          const w = JSON.parse(d) as { action: string; schema: string; table: string };
          return tables.has(`${w.schema}.${w.table}`) && actions.has(ACTION[w.action] ?? "");
        });
    },
  };
}

/** La fuente de producción (poller.ts) sobre la cola. */
export function queueChangeSource(pg: PGlite, db: ProjectDatabase): ChangeSource {
  return changeSource(db, queueWalReader(pg));
}
