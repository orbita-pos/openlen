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
import { randBetween, RandExpBackoff } from "./backoff";
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
 *  `replications.ex`, sobre UN `data` de los que ya leyó el WalReader. */
const APPLY_SQL = `SELECT xyz.wal->>'type' as type,
       xyz.wal->>'schema' as schema,
       xyz.wal->>'table' as table,
       COALESCE(xyz.wal->>'columns', '[]') as columns,
       COALESCE(xyz.wal->>'record', '{}') as record,
       COALESCE(xyz.wal->>'old_record', '{}') as old_record,
       xyz.wal->>'commit_timestamp' as commit_timestamp,
       xyz.subscription_ids,
       xyz.errors
  FROM realtime.apply_rls(wal := $1::jsonb, max_record_bytes := $2) xyz(wal, is_rls_enabled, subscription_ids, errors)
 WHERE xyz.subscription_ids[1] IS NOT NULL`;

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
      // 🔴 Una llamada por cambio, cada una como `supabase_realtime_admin`:
      // `apply_rls` lee realtime.subscription en su DECLARE y luego vuelve al
      // usuario de la sesión (`set_config('role', null)`). En Supabase ese
      // usuario es el dueño de la tabla; aquí es `authenticator`, que no la lee,
      // y en una sola consulta el segundo cambio fallaba y se llevaba el
      // sondeo entero (production-roles.pglite.test.ts).
      const rows = await db.transaction(async (q) => {
        const out: Record<string, unknown>[] = [];
        for (const data of datas) {
          await q(asRealtimeAdmin);
          out.push(...(await q(APPLY_SQL, [data, o.maxRecordBytes])).rows);
        }
        return out;
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

/** Su `@max_retries`: los reintentos seguidos antes de rendirse. */
const MAX_RETRIES = 6;

/** Su backoff de reintentos: `Backoff.new(backoff_min: 100, backoff_max:
 *  5_000, backoff_type: :rand_exp)`. */
const RETRY_BACKOFF_MIN_MS = 100;
const RETRY_BACKOFF_MAX_MS = 5_000;

/** El `shutdown` por defecto de un hijo de OTP (5 s): lo que su supervisor
 *  espera a que pare antes de matarlo. Aquí no se puede matar una apertura en
 *  marcha: se deja de esperar y se suelta lo que abra al acabar. */
const SHUTDOWN_MS = 5_000;

export interface PollerEvents {
  /** La fuente abrió y el sondeo empieza (su `prepare_replication` bueno). */
  readonly onRunning?: () => void;
  /** Se rindió tras sus reintentos (su `{:shutdown, :max_retries_reached}`),
   *  con la fuente ya cerrada. */
  readonly onGaveUp?: () => void;
}

/** El sondeo de UN proyecto (su ReplicationPoller): abre la fuente, sondea con
 *  su cadencia y entrega cada fila. Una apertura o una lectura que falla se
 *  reintenta con su backoff (`retry_or_stop`) y, tras sus reintentos, se rinde.
 *  `stop` suelta la fuente (y con ella el slot temporal). */
export class ProjectPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private running = false;
  /** La apertura en marcha, para que `stop` la espere (con tope). */
  private opening: Promise<void> | null = null;
  /** `stop` dejó de esperar la apertura: lo que abra al acabar se suelta. */
  private abandoned = false;
  /** Se pidió abrir desde el último cierre: puede haber algo que soltar. */
  private held = false;
  /** Su `backoff` y su `retry_count`. */
  private readonly backoff = new RandExpBackoff(RETRY_BACKOFF_MIN_MS, RETRY_BACKOFF_MAX_MS);
  private retryCount = 0;

  constructor(
    private readonly source: ChangeSource,
    private readonly onRow: (row: ChangeRow) => void,
    private readonly timing: PollerTiming,
    private readonly onError: (err: unknown) => void,
    private readonly events: PollerEvents = {},
  ) {}

  /** La fuente está abierta y se sondea (ni abriendo, ni reintentando, ni parado). */
  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    // Parado antes de arrancar (esperaba a que el anterior soltara el slot).
    if (this.stopped) return;
    void this.prepare();
  }

  private schedule(ms: number, next: () => Promise<void> = () => this.poll()): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void next(), ms);
    this.timer.unref?.();
  }

  /** Su `prepare_replication`: abre la fuente y, si sale, sondea ya. */
  private async prepare(): Promise<void> {
    this.timer = null;
    if (this.stopped) return;
    this.held = true;
    const opening = this.source.open();
    this.opening = opening.then(
      () => {},
      () => {},
    );
    let failure: { err: unknown } | null = null;
    try {
      await opening;
    } catch (err) {
      failure = { err };
    }
    this.opening = null;
    if (this.stopped) {
      if (this.abandoned) await this.release();
      return;
    }
    if (failure) {
      this.onError(failure.err);
      // Lo que quedara a medias (la conexión sin su slot) se suelta antes de reintentar.
      await this.release();
      return this.retryOrStop();
    }
    this.retryCount = 0;
    this.backoff.reset();
    this.running = true;
    this.events.onRunning?.();
    this.schedule(0);
  }

  /** Su `retry_or_stop`: otra apertura tras su backoff o, con sus
   *  `@max_retries` seguidos ya gastados, se rinde. */
  private retryOrStop(): void {
    if (this.stopped) return;
    if (this.retryCount >= MAX_RETRIES) {
      this.stopped = true;
      this.events.onGaveUp?.();
      return;
    }
    this.retryCount++;
    this.schedule(this.backoff.next(), () => this.prepare());
  }

  private async release(): Promise<void> {
    this.running = false;
    this.held = false;
    try {
      await this.source.close();
    } catch (err) {
      this.onError(err);
    }
  }

  private async poll(): Promise<void> {
    this.timer = null;
    if (this.stopped) return;
    let listed: Listed;
    try {
      listed = await this.source.listChanges({ maxChanges: this.timing.maxChanges, maxRecordBytes: this.timing.maxRecordBytes });
    } catch (err) {
      if (this.stopped) return;
      this.onError(err);
      // Si fue la conexión del slot, el slot temporal se fue con ella: se
      // suelta y, tras su backoff, se abre otra vez (su `retry_or_stop`).
      await this.release();
      return this.retryOrStop();
    }
    if (this.stopped) return;
    // Un sondeo bueno acaba la racha (su `Backoff.reset` y `retry_count: 0`).
    this.retryCount = 0;
    this.backoff.reset();
    if (listed === null) return this.schedule(this.timing.pollIntervalMs * IDLE_MULTIPLIER);
    for (const row of listed.rows) this.onRow(row);
    // Su cadencia: con filas, otra vez ya; con cambios para nadie, el
    // intervalo (+ 50–100 ms); en reposo, ×5.
    if (listed.rows.length > 0) return this.schedule(0);
    if (listed.slotChangesCount > 0) return this.schedule(this.timing.pollIntervalMs + randBetween(50, 100));
    return this.schedule(this.timing.pollIntervalMs * IDLE_MULTIPLIER);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.opening) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const settled = await Promise.race([
        this.opening.then(() => true),
        new Promise<false>((r) => {
          timeout = setTimeout(() => r(false), SHUTDOWN_MS);
          timeout.unref?.();
        }),
      ]);
      clearTimeout(timeout);
      if (!settled) this.abandoned = true;
    }
    if (this.held) await this.release();
  }
}
