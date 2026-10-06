// postgres_changes: el sondeo del slot de un proyecto, como el de Supabase
// Realtime (supabase/realtime @ f86df8c3, Apache-2.0:
// lib/extensions/postgres_cdc_rls/{replication_poller,replications}.ex y la
// función `realtime.list_changes` de su esquema).
//
// 🔴 `list_changes` PARTIDA EN DOS (lo único que se aparta de su SQL, decidido
// en plans/len-agente-2026/plan-2-5/d-tiempo-real.md): en Supabase cada
// proyecto es su propio Postgres; aquí comparten clúster. Leer el slot pide
// REPLICATION, y `list_changes` corre en la MISMA consulta `quote_wal2json`,
// `apply_rls` y las políticas RLS, que el desarrollador puede escribir o
// redefinir. Así que:
//
//   · WalReader (el slot): una sesión de `openlen_realtime` que sólo llama a
//     `pg_catalog.pg_logical_slot_get_changes` con las mismas opciones de
//     wal2json que `list_changes`. Ningún código del proyecto corre ahí.
//   · Lo demás, por el pool de `authenticator` como `supabase_realtime_admin`:
//     el CTE `pub` de `list_changes` (qué acciones y qué tablas) y cada cambio
//     por SU `realtime.apply_rls`, con la proyección de su `replications.ex`.

import type { ProjectDatabase } from "../db";
import { PUBLICATION } from "./subscriptions";

/** Una fila como las de su `Replications.list_changes`. */
export interface ChangeRow {
  readonly type: string | null;
  readonly schema: string | null;
  readonly table: string | null;
  /** JSON. */
  readonly columns: string;
  /** JSON. */
  readonly record: string;
  /** JSON. */
  readonly old_record: string;
  readonly commit_timestamp: string | null;
  readonly subscription_ids: readonly string[];
  readonly errors: readonly string[] | null;
}

export interface ListOptions {
  readonly maxChanges: number;
  readonly maxRecordBytes: number;
}

/** Lo que sale de un sondeo: null si la publicación no tiene tablas (su `:poll`
 *  con `oids` vacío: no se toca el slot). */
export type Listed = { readonly rows: readonly ChangeRow[]; readonly slotChangesCount: number } | null;

export interface ChangeSource {
  open(): Promise<void>;
  listChanges(o: ListOptions): Promise<Listed>;
  close(): Promise<void>;
}

/** El slot de un proyecto (producción: realtime/wal-reader.ts). */
export interface WalReader {
  /** Su `prepare_replication`: el slot TEMPORAL de wal2json. */
  open(): Promise<void>;
  /** `pg_logical_slot_get_changes` con las opciones de `list_changes`: los
   *  `data` de wal2json (texto JSON), ya consumidos del slot. */
  read(o: { readonly maxChanges: number; readonly actions: string; readonly addTables: string }): Promise<string[]>;
  close(): Promise<void>;
}

/** El CTE `pub` de su `list_changes`, tal cual. */
const PUB_SQL = `SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = $1
    GROUP BY pp.pubname
    LIMIT 1`;

/** El `rls_filtered` de su `list_changes` con la proyección de su
 *  `replications.ex`, sobre los `data` que ya leyó el WalReader. */
const APPLY_SQL = `SELECT xyz.wal->>'type' as type,
       xyz.wal->>'schema' as schema,
       xyz.wal->>'table' as table,
       COALESCE(xyz.wal->>'columns', '[]') as columns,
       COALESCE(xyz.wal->>'record', '{}') as record,
       COALESCE(xyz.wal->>'old_record', '{}') as old_record,
       xyz.wal->>'commit_timestamp' as commit_timestamp,
       xyz.subscription_ids,
       xyz.errors
  FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY d(data, n),
       realtime.apply_rls(wal := d.data, max_record_bytes := $2) xyz(wal, is_rls_enabled, subscription_ids, errors)
 WHERE xyz.subscription_ids[1] IS NOT NULL
 ORDER BY d.n`;

const asRealtimeAdmin = `select set_config('role', 'supabase_realtime_admin', true)`;

/** Un array de Postgres que el driver devuelve como texto (`{a,b}`) o como array. */
function pgList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== "string" || v === "{}" || v === "") return [];
  return v
    .slice(1, -1)
    .split(",")
    .map((s) => s.replace(/^"(.*)"$/, "$1"));
}

export function changeSource(db: ProjectDatabase, reader: WalReader): ChangeSource {
  return {
    open: () => reader.open(),
    close: () => reader.close(),
    async listChanges(o) {
      const pub = await db.transaction(async (q) => {
        await q(asRealtimeAdmin);
        return (await q(PUB_SQL, [PUBLICATION])).rows[0] as { w2j_actions: string; w2j_add_tables: string } | undefined;
      });
      if (!pub || pub.w2j_add_tables === "") return null;
      const datas = await reader.read({ maxChanges: o.maxChanges, actions: pub.w2j_actions, addTables: pub.w2j_add_tables });
      if (datas.length === 0) return { rows: [], slotChangesCount: 0 };
      const rows = await db.transaction(async (q) => {
        await q(asRealtimeAdmin);
        return (await q(APPLY_SQL, [`[${datas.join(",")}]`, o.maxRecordBytes])).rows;
      });
      return {
        slotChangesCount: datas.length,
        rows: rows.map((r) => ({
          type: (r.type as string | null) ?? null,
          schema: (r.schema as string | null) ?? null,
          table: (r.table as string | null) ?? null,
          columns: String(r.columns),
          record: String(r.record),
          old_record: String(r.old_record),
          commit_timestamp: (r.commit_timestamp as string | null) ?? null,
          subscription_ids: pgList(r.subscription_ids),
          errors: r.errors === null || r.errors === undefined ? null : pgList(r.errors),
        })),
      };
    },
  };
}

/** Su `generate_record` + el `data` que reparte su MessageDispatcher (sin
 *  `subscription_ids`: su `@derive except`). */
export function changeData(row: ChangeRow): Record<string, unknown> | null {
  const errors = row.errors && row.errors.length > 0 ? row.errors : null;
  const base = {
    columns: JSON.parse(row.columns) as unknown,
    commit_timestamp: row.commit_timestamp,
    errors,
    schema: row.schema,
    table: row.table,
    type: row.type,
  };
  switch (row.type) {
    case "INSERT":
      return { ...base, record: JSON.parse(row.record) as unknown };
    case "UPDATE":
      return { ...base, old_record: JSON.parse(row.old_record) as unknown, record: JSON.parse(row.record) as unknown };
    case "DELETE":
      return { ...base, old_record: JSON.parse(row.old_record) as unknown };
    default:
      return null;
  }
}

export interface PollerTiming {
  /** Su `poll_interval_ms` (100). */
  readonly pollIntervalMs: number;
  /** Su `poll_max_changes` (100). */
  readonly maxChanges: number;
  /** Su `poll_max_record_bytes` (1 MB). */
  readonly maxRecordBytes: number;
}

export const DEFAULT_POLLER_TIMING: PollerTiming = { pollIntervalMs: 100, maxChanges: 100, maxRecordBytes: 1_048_576 };

/** Su `@idle_multiplier`. */
const IDLE_MULTIPLIER = 5;

/** El sondeo de UN proyecto (su ReplicationPoller): abre la fuente, sondea con
 *  su cadencia y entrega cada fila. `stop` suelta la fuente (y con ella el slot
 *  temporal). */
export class ProjectPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private opened: Promise<void> | null = null;

  constructor(
    private readonly source: ChangeSource,
    private readonly onRow: (row: ChangeRow) => void,
    private readonly timing: PollerTiming,
    private readonly onError: (err: unknown) => void,
  ) {}

  start(): void {
    this.opened = this.source.open().then(
      () => this.schedule(0),
      (err: unknown) => this.onError(err),
    );
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.poll(), ms);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    let listed: Listed;
    try {
      listed = await this.source.listChanges({ maxChanges: this.timing.maxChanges, maxRecordBytes: this.timing.maxRecordBytes });
    } catch (err) {
      this.onError(err);
      return this.schedule(this.timing.pollIntervalMs * IDLE_MULTIPLIER);
    }
    if (this.stopped) return;
    if (listed === null) return this.schedule(this.timing.pollIntervalMs * IDLE_MULTIPLIER);
    for (const row of listed.rows) this.onRow(row);
    // Su cadencia: con filas, otra vez ya; con cambios para nadie, el
    // intervalo (+ 50–100 ms); en reposo, ×5.
    if (listed.rows.length > 0) return this.schedule(0);
    if (listed.slotChangesCount > 0) return this.schedule(this.timing.pollIntervalMs + 50 + Math.floor(Math.random() * 51));
    return this.schedule(this.timing.pollIntervalMs * IDLE_MULTIPLIER);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.opened?.catch(() => {});
    await this.source.close();
  }
}
