// @vitest-environment node
//
// El esquema `storage` de Supabase montado en la base de un proyecto (PGlite,
// Postgres 18 de verdad): sus tablas, sus migraciones, y lo que puede y no
// puede hacer el rol de desarrollador del proyecto con él.
import { beforeAll, describe, expect, it } from "vitest";

import { asRole } from "../testing/pglite";
import type { TestProject } from "../testing/project";
import { initStorageSchema } from "./schema";
import { newStorageTestProject } from "./testing";

const DEV = "ol_abcdefghijklmnopqrst";
// Lo que Len escribiría: el patrón de la documentación de Supabase («Storage Access Control»).
const MIGRACION = `
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
create policy "cada uno en su carpeta" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
`;

let t: TestProject;
beforeAll(async () => {
  t = await newStorageTestProject(MIGRACION);
});

describe("el esquema storage de Supabase", () => {
  it("tiene sus tablas con RLS, dueñas de supabase_storage_admin, y las 73 en storage.migrations", async () => {
    const r = await t.pg.query<{ tablename: string; rowsecurity: boolean; tableowner: string }>(
      `select tablename, rowsecurity, tableowner from pg_tables where schemaname = 'storage' and tablename in ('buckets','objects') order by 1`,
    );
    expect(r.rows).toEqual([
      { tablename: "buckets", rowsecurity: true, tableowner: "supabase_storage_admin" },
      { tablename: "objects", rowsecurity: true, tableowner: "supabase_storage_admin" },
    ]);
    const m = await t.pg.query<{ n: number }>(`select count(*)::int as n from storage.migrations`);
    expect(m.rows[0]!.n).toBe(73);
  });

  it("guarda el hash de postgres-migrations: sha1(fileName + sql)", async () => {
    const { createHash } = await import("node:crypto");
    const { STORAGE_MIGRATIONS } = await import("./migrations");
    const first = STORAGE_MIGRATIONS[0]!;
    const r = await t.pg.query<{ id: number; name: string; hash: string }>(`select id, name, hash from storage.migrations where id = 1`);
    expect(r.rows[0]).toEqual({
      id: 1,
      name: "initialmigration",
      hash: createHash("sha1").update(first.fileName + first.sql, "utf8").digest("hex"),
    });
  });

  it("el desarrollador crea políticas en storage.objects (la migración de arriba entró)", async () => {
    const r = await t.pg.query(`select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'`);
    expect(r.rows).toContainEqual({ policyname: "cada uno en su carpeta" });
    const b = await t.pg.query(`select id, public from storage.buckets`);
    expect(b.rows).toEqual([{ id: "avatars", public: true }]);
  });

  // `set role` se comprueba contra el usuario de la SESIÓN, que en PGlite es
  // superusuario: hay que entrar como el desarrollador, que es como entra
  // `supabase db push` en producción (withDeveloper). En PGlite no se vuelve de
  // `session authorization` (ni con `reset` ni con `local`, medido): cada
  // prueba así, en un proyecto propio.
  const comoDesarrollador = async (sql: string): Promise<string | null> => {
    const p = await newStorageTestProject(MIGRACION);
    try {
      await p.pg.exec(`set session authorization ${DEV}; ${sql}`);
      return null;
    } catch (err) {
      return (err as Error).message;
    } finally {
      await p.pg.close();
    }
  };

  it("el desarrollador NO puede hacerse supabase_storage_admin ni crear roles", async () => {
    expect(await comoDesarrollador(`set role supabase_storage_admin`)).toMatch(/permission denied to set role/);
    expect(await comoDesarrollador(`create role intruso`)).toMatch(/permission denied to create role/);
  });

  it("el desarrollador SÍ crea políticas en storage.objects entrando con su rol", async () => {
    expect(await comoDesarrollador(`create policy "leer" on storage.objects for select to anon using (bucket_id = 'avatars')`)).toBeNull();
  });

  it("un delete directo de storage.objects falla como en Supabase", async () => {
    const r = await asRole(t.pg, DEV, null, (q) => q(`delete from storage.objects`));
    expect(r).toMatchObject({
      code: "42501",
      error: "Direct deletion from storage tables is not allowed. Use the Storage API instead.",
    });
  });

  it("anon y authenticated ven las tablas, y RLS les aplica", async () => {
    const r = await asRole(t.pg, "anon", { role: "anon" }, (q) => q(`select count(*)::int as n from storage.objects`));
    expect(r).toEqual([{ n: 0 }]);
    const w = await asRole(t.pg, "anon", { role: "anon" }, (q) =>
      q(`insert into storage.objects (bucket_id, name) values ('avatars', 'x.png')`),
    );
    expect(w).toMatchObject({ code: "42501", error: expect.stringMatching(/row-level security/) });
  });

  it("es idempotente", async () => {
    await initStorageSchema(
      {
        exec: async (s) => {
          await t.pg.exec(s);
        },
        query: async (s, p) => ({ rows: (await t.pg.query(s, p as unknown[] | undefined)).rows as Record<string, unknown>[] }),
      },
      { devRole: DEV },
    );
    const m = await t.pg.query<{ n: number }>(`select count(*)::int as n from storage.migrations`);
    expect(m.rows[0]!.n).toBe(73);
  });
});
