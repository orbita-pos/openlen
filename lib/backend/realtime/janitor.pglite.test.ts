// @vitest-environment node
//
// El Janitor de Supabase Realtime (su `MaintenanceTask`: `delete_old_messages`
// y `create_messages_partitions`) contra el esquema `realtime` real en PGlite:
// las particiones diarias de `realtime.messages` de hace más de 72 horas se
// borran, las de los próximos días se crean, y nada más se toca.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { TestProject } from "../testing/project";
import { TEST_REF } from "../testing/project";
import { ensureMessagePartitions, forgetMessagePartitions } from "./authorization";
import { deleteOldMessages, MessagesJanitor } from "./janitor";
import { newRealtimeTestProject } from "./testing";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

let t: TestProject;

beforeAll(async () => {
  t = await newRealtimeTestProject("");
});
afterEach(async () => {
  forgetMessagePartitions();
  const r = await t.pg.query<{ relname: string }>(
    `select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'realtime.messages'::regclass`,
  );
  for (const { relname } of r.rows) await t.pg.exec(`drop table realtime."${relname}"`);
});

async function particiones(): Promise<string[]> {
  const r = await t.pg.query<{ relname: string }>(
    `select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'realtime.messages'::regclass order by 1`,
  );
  return r.rows.map((x) => x.relname);
}

const HOY = new Date("2026-10-05T12:00:00Z");
const HACE_UNA_SEMANA = new Date("2026-09-28T12:00:00Z");

describe("el Janitor de realtime.messages", () => {
  it("🔴 borra las particiones de hace más de 72 horas y deja las demás", async () => {
    await ensureMessagePartitions(t.project.db, TEST_REF, HACE_UNA_SEMANA);
    forgetMessagePartitions();
    await ensureMessagePartitions(t.project.db, TEST_REF, HOY);
    expect(await particiones()).toEqual([
      "messages_2026_09_27",
      "messages_2026_09_28",
      "messages_2026_09_29",
      "messages_2026_09_30",
      "messages_2026_10_01",
      "messages_2026_10_04",
      "messages_2026_10_05",
      "messages_2026_10_06",
      "messages_2026_10_07",
      "messages_2026_10_08",
    ]);
    await deleteOldMessages(t.project.db, HOY);
    // El límite es el día de hace 72 horas (02/10): lo anterior, fuera.
    expect(await particiones()).toEqual(["messages_2026_10_04", "messages_2026_10_05", "messages_2026_10_06", "messages_2026_10_07", "messages_2026_10_08"]);
  });

  it("una partición que no se llama como un día, o una tabla que no es partición, se queda", async () => {
    await t.pg.exec(`create table realtime.messages_a_mano partition of realtime.messages for values from ('2020-01-01') to ('2020-01-02')`);
    await t.pg.exec(`create table public.messages_2020_01_02 (id int)`);
    await deleteOldMessages(t.project.db, HOY);
    expect(await particiones()).toEqual(["messages_a_mano"]);
    const r = await t.pg.query(`select 1 from pg_class where relname = 'messages_2020_01_02'`);
    expect(r.rows).toHaveLength(1);
    await t.pg.exec(`drop table public.messages_2020_01_02`);
  });

  it("🔴 una pasada recorre los proyectos con particiones: borra lo viejo y crea los días que vienen", async () => {
    await ensureMessagePartitions(t.project.db, TEST_REF, HACE_UNA_SEMANA);
    const janitor = new MessagesJanitor({ startAfterMs: 0, scheduleMs: 0 });
    await janitor.runOnce(HOY);
    expect(await particiones()).toEqual(["messages_2026_10_04", "messages_2026_10_05", "messages_2026_10_06", "messages_2026_10_07", "messages_2026_10_08"]);
  });

  it("un proyecto cuya base falla sale de la lista y no tumba la pasada", async () => {
    const rota = { transaction: async () => Promise.reject(new Error("la base ya no está")) };
    await ensureMessagePartitions(t.project.db, TEST_REF, HACE_UNA_SEMANA);
    // Usó canales privados aunque su base fallara: queda en la lista.
    await expect(ensureMessagePartitions(rota, "rotarotarotarotarota", HACE_UNA_SEMANA)).rejects.toThrow("la base ya no está");
    const errores: unknown[] = [];
    const janitor = new MessagesJanitor({ startAfterMs: 0, scheduleMs: 0, onError: (e) => errores.push(e) });
    await janitor.runOnce(HOY);
    expect(errores).toHaveLength(1);
    expect(await particiones()).toContain("messages_2026_10_08");
    expect(await particiones()).not.toContain("messages_2026_09_27");
    // La siguiente pasada ya no la intenta.
    await janitor.runOnce(HOY);
    expect(errores).toHaveLength(1);
  });

  it("arranca tras su espera, vuelve cada `scheduleMs` y para con stop", async () => {
    const janitor = new MessagesJanitor({ startAfterMs: 20, scheduleMs: 30 });
    const pasadas: number[] = [];
    janitor.runOnce = async () => {
      pasadas.push(Date.now());
    };
    janitor.start();
    await new Promise((r) => setTimeout(r, 10));
    expect(pasadas).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 110));
    await janitor.stop();
    const n = pasadas.length;
    expect(n).toBeGreaterThanOrEqual(2);
    await new Promise((r) => setTimeout(r, 80));
    expect(pasadas).toHaveLength(n);
  });
});
