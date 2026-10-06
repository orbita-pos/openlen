// La lectura del slot de wal2json en producción (wal-reader.ts), con un
// cliente doble que apunta lo que se le pide: SÓLO funciones de `pg_catalog`
// (es la sesión con REPLICATION: ahí no puede correr nada del proyecto) y las
// MISMAS opciones de wal2json que el `list_changes` del volcado de Supabase.
import { describe, expect, it } from "vitest";

import { REALTIME_DUMP_SQL } from "./schema-dump";
import { pgWalReader, WAL2JSON_OPTIONS } from "./wal-reader";

function cliente() {
  const consultas: { sql: string; params: unknown[] }[] = [];
  let conectado = false;
  let cerrado = false;
  const c = {
    async connect() {
      conectado = true;
    },
    async query(sql: string, params: unknown[] = []) {
      consultas.push({ sql, params });
      return { rows: sql.includes("pg_logical_slot_get_changes") ? [{ data: '{"action":"I"}' }, { data: '{"action":"D"}' }] : [] };
    },
    async end() {
      cerrado = true;
    },
  };
  return { c, consultas, estado: () => ({ conectado, cerrado }) };
}

describe("pgWalReader", () => {
  it("las opciones de wal2json son las de su list_changes", () => {
    const inicio = REALTIME_DUMP_SQL.indexOf("CREATE FUNCTION realtime.list_changes(");
    const cuerpo = REALTIME_DUMP_SQL.slice(inicio, REALTIME_DUMP_SQL.indexOf("$$;", inicio));
    const llamada = cuerpo.slice(cuerpo.indexOf("pg_logical_slot_get_changes("), cuerpo.indexOf(") x", cuerpo.indexOf("pg_logical_slot_get_changes(")));
    const fijas = [...llamada.matchAll(/'([a-z-]+)', '([a-z0-9]+)'/g)].map((m) => [m[1], m[2]]);
    expect(fijas).toEqual(WAL2JSON_OPTIONS.map(([k, v]) => [k, v]));
    expect(llamada).toContain("'actions', pub.w2j_actions");
    expect(llamada).toContain("'add-tables', pub.w2j_add_tables");
  });

  it("abre el slot temporal, lee con sus opciones y sólo llama a pg_catalog", async () => {
    const { c, consultas, estado } = cliente();
    const r = pgWalReader({ connect: () => c, slotName: "realtime_abcdefghijklmnopqrst" });
    await r.open();
    expect(estado().conectado).toBe(true);
    const datos = await r.read({ maxChanges: 100, actions: "insert,update,delete", addTables: "public.mensajes" });
    expect(datos).toEqual(['{"action":"I"}', '{"action":"D"}']);
    await r.close();
    expect(estado().cerrado).toBe(true);

    expect(consultas[0]!.sql).toContain("pg_catalog.pg_create_logical_replication_slot(slot_name => $1, plugin => 'wal2json', temporary => true)");
    expect(consultas[0]!.params).toEqual(["realtime_abcdefghijklmnopqrst"]);
    expect(consultas[1]!.params).toEqual(["realtime_abcdefghijklmnopqrst", 100, "insert,update,delete", "public.mensajes"]);
    for (const q of consultas) {
      const funciones = [...q.sql.matchAll(/([a-z_.]+)\s*\(/gi)].map((m) => m[1]!.toLowerCase());
      for (const f of funciones) expect(f.startsWith("pg_catalog.") || ["select", "case", "exists", "when", "then"].includes(f), f).toBe(true);
    }
  });
});
