// @vitest-environment node
//
// El esquema `realtime` de Supabase montado en la base de un proyecto (PGlite):
// sus tablas y funciones, la publicación `supabase_realtime` del desarrollador
// y lo que el desarrollador puede y no puede hacer con ellas.
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { TestProject } from "../testing/project";
import { initRealtimeSchema } from "./schema";
import { newRealtimeTestProject } from "./testing";

// Montar GoTrue + storage + realtime en PGlite tarda.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const DEV = "ol_abcdefghijklmnopqrst";
// Lo que Len escribiría: el patrón de la documentación de Supabase («Postgres Changes»).
const MIGRACION = `
create table public.mensajes (id bigint generated always as identity primary key, texto text not null);
alter publication supabase_realtime add table public.mensajes;
`;

let t: TestProject;
beforeAll(async () => {
  t = await newRealtimeTestProject(MIGRACION);
});

describe("el esquema realtime de Supabase", () => {
  it("tiene sus tablas, sus funciones y sus 88 migraciones apuntadas", async () => {
    const tablas = await t.pg.query<{ t: string }>(`select string_agg(tablename, ',' order by tablename) as t from pg_tables where schemaname = 'realtime'`);
    expect(tablas.rows[0]!.t).toBe("messages,schema_migrations,subscription");
    const f = await t.pg.query<{ n: number }>(
      `select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'realtime'`,
    );
    expect(f.rows[0]!.n).toBeGreaterThanOrEqual(17);
    const m = await t.pg.query<{ n: number }>(`select count(*)::int as n from realtime.schema_migrations`);
    expect(m.rows[0]!.n).toBe(88);
  });

  it("la publicación supabase_realtime es del desarrollador, y su migración le añadió su tabla", async () => {
    const p = await t.pg.query<{ owner: string }>(`select pg_get_userbyid(pubowner) as owner from pg_publication where pubname = 'supabase_realtime'`);
    expect(p.rows).toEqual([{ owner: DEV }]);
    const tablas = await t.pg.query(`select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime'`);
    expect(tablas.rows).toEqual([{ schemaname: "public", tablename: "mensajes" }]);
  });

  it("la búsqueda del volcado no se queda puesta en la sesión que lo aplicó", async () => {
    const r = await t.pg.query<{ search_path: string }>(`show search_path`);
    expect(r.rows[0]!.search_path).not.toBe("");
  });

  // `set role` se comprueba contra el usuario de la SESIÓN, superusuario en
  // PGlite: hay que entrar como el desarrollador (como en storage).
  const comoDesarrollador = async (sql: string): Promise<string | null> => {
    const p = await newRealtimeTestProject("");
    try {
      await p.pg.exec(`set session authorization ${DEV}; ${sql}`);
      return null;
    } catch (err) {
      return (err as Error).message;
    } finally {
      await p.pg.close();
    }
  };

  it("el desarrollador no puede hacerse supabase_realtime_admin", async () => {
    expect(await comoDesarrollador(`set role supabase_realtime_admin`)).toMatch(/permission denied to set role/);
  });

  it("el desarrollador SÍ pone políticas en realtime.messages (los canales privados de su documentación)", async () => {
    expect(
      await comoDesarrollador(`create policy "leer su sala" on realtime.messages for select to authenticated using (realtime.topic() = 'sala')`),
    ).toBeNull();
  });

  it("es idempotente", async () => {
    await initRealtimeSchema(
      {
        exec: async (s) => {
          await t.pg.exec(s);
        },
        query: async (s, p) => ({ rows: (await t.pg.query(s, p as unknown[] | undefined)).rows as Record<string, unknown>[] }),
      },
      { devRole: DEV },
    );
    const m = await t.pg.query<{ n: number }>(`select count(*)::int as n from realtime.schema_migrations`);
    expect(m.rows[0]!.n).toBe(88);
  });
});
