// El slot de wal2json de un proyecto, en producción: la mitad CON REPLICATION
// de `realtime.list_changes` partida (poller.ts). Una conexión propia (el slot
// es TEMPORAL: vive mientras ella viva) del rol `openlen_realtime` (LOGIN
// REPLICATION y nada más; lo crea root en infra/db/setup-pages-cluster.sh) a la
// base del proyecto, con `search_path = pg_catalog`, que SÓLO llama a funciones
// de `pg_catalog`: ningún código del proyecto corre en ella.
//
// Las consultas son las de Supabase Realtime (supabase/realtime @ f86df8c3,
// Apache-2.0): su `Replications.prepare_replication` y el
// `pg_logical_slot_get_changes` de su `list_changes`, con sus opciones.

import type { WalReader } from "./poller";

/** Las opciones fijas de wal2json en su `list_changes` (más `actions` y
 *  `add-tables`, que calcula la publicación). wal-reader.test.ts las compara
 *  con las del volcado vendido. */
export const WAL2JSON_OPTIONS: readonly (readonly [string, string])[] = [
  ["include-pk", "true"],
  ["include-transaction", "false"],
  ["include-timestamp", "true"],
  ["include-type-oids", "true"],
  ["format-version", "2"],
];

/** Su `prepare_replication`, calificado. */
const PREPARE_SQL = `select
  case when not exists (
    select 1
    from pg_catalog.pg_replication_slots
    where slot_name = $1
  )
  then (
    select 1 from pg_catalog.pg_create_logical_replication_slot(slot_name => $1, plugin => 'wal2json', temporary => true)
  )
  else 1
  end`;

const READ_SQL = `select data from pg_catalog.pg_logical_slot_get_changes(
  $1, null, $2,
  ${WAL2JSON_OPTIONS.map(([k, v]) => `'${k}', '${v}'`).join(",\n  ")},
  'actions', $3,
  'add-tables', $4
)`;

/** Lo que usamos de un `pg.Client`. */
export interface ReplicationClient {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

export function pgWalReader(o: { readonly connect: () => ReplicationClient; readonly slotName: string }): WalReader {
  let client: ReplicationClient | null = null;
  return {
    async open() {
      const c = o.connect();
      await c.connect();
      client = c;
      await c.query(PREPARE_SQL, [o.slotName]);
    },
    async read(r) {
      if (!client) throw new Error("el slot no está abierto");
      const res = await client.query(READ_SQL, [o.slotName, r.maxChanges, r.actions, r.addTables]);
      return res.rows.map((x) => String(x.data));
    },
    async close() {
      const c = client;
      client = null;
      await c?.end().catch(() => {});
    },
  };
}
