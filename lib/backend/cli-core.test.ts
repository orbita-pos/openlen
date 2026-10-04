// @vitest-environment node
//
// `supabase migration new` → escribir la migración → `supabase db push`, y la
// tabla que crea se usa desde la página con supabase-js. El ciclo entero de un
// proyecto con Supabase, sobre PGlite.
import type { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { runCli, type CliBackend } from "./cli-core";
import { handleBackendRequest } from "./router";
import { newTestProject, TEST_REF, TEST_URL, type TestProject } from "./testing/project";

function pgArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

/** El backend de la CLI sobre PGlite: las migraciones, con el rol de desarrollador. */
function pgliteCli(pg: PGlite, publishableKey: string): CliBackend {
  const dev = `ol_${TEST_REF}`;
  return {
    status: async () => ({ apiUrl: TEST_URL, publishableKey }),
    remoteMigrations: async () =>
      (await pg.query<{ version: string; name: string | null }>(`select version, name from supabase_migrations.schema_migrations order by version`)).rows,
    applyMigration: async (m) => {
      let failedAt = -1;
      try {
        await pg.transaction(async (tx) => {
          await tx.query(`select set_config('role', $1, true)`, [dev]);
          for (let i = 0; i < m.statements.length; i++) {
            failedAt = i;
            await tx.exec(m.statements[i]!);
          }
          failedAt = -1;
          await tx.query(`insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)`, [
            m.version,
            m.name,
            pgArray(m.statements),
          ]);
        });
        return { ok: true };
      } catch (e) {
        const er = e as { message?: string; code?: string };
        return { ok: false, failedAt: Math.max(0, failedAt), error: { message: er.message ?? String(e), ...(er.code ? { code: er.code } : {}) } };
      }
    },
  };
}

let t: TestProject;
let cli: CliBackend;
const ficheros: Record<string, string> = {};

beforeAll(async () => {
  t = await newTestProject("");
  cli = pgliteCli(t.pg, t.project.publishableKey);
});

describe("supabase en la terminal de Len", () => {
  it("status: la URL del proyecto y su clave publicable", async () => {
    const r = await runCli(["status"], ficheros, cli);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`API URL: ${TEST_URL}`);
    expect(r.stdout).toContain(`Publishable key: ${t.project.publishableKey}`);
  });

  it("migration new: el fichero con su marca de tiempo", async () => {
    const r = await runCli(["migration", "new", "create_notes"], ficheros, cli, new Date(Date.UTC(2026, 9, 4, 12, 0, 0)));
    expect(r.stdout).toBe("Created new migration at supabase/migrations/20261004120000_create_notes.sql\n");
    expect(r.escribir).toEqual({ "/supabase/migrations/20261004120000_create_notes.sql": "" });
  });

  it("🔴 db push aplica lo nuevo, y la página lo usa con supabase-js (RLS incluida)", async () => {
    ficheros["/supabase/migrations/20261004120000_create_notes.sql"] = `
create table public.notes (id bigint generated always as identity primary key, body text not null);
alter table public.notes enable row level security;
create policy "anyone reads" on public.notes for select using (true);
create policy "anyone writes" on public.notes for insert with check (true);
`;
    const r = await runCli(["db", "push"], ficheros, cli);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toBe("Connecting to remote database...\nApplying migration 20261004120000_create_notes.sql...\nFinished supabase db push.\n");

    const supa = createClient(TEST_URL, t.project.publishableKey, {
      global: { fetch: (input, init) => handleBackendRequest(new Request(input, init), t.project) },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await supa.from("notes").insert({ body: "hola" })).error).toBeNull();
    expect((await supa.from("notes").select("body")).data).toEqual([{ body: "hola" }]);
  });

  it("otra vez: «Remote database is up to date.»", async () => {
    const r = await runCli(["db", "push"], ficheros, cli);
    expect(r.stdout).toContain("Remote database is up to date.");
  });

  it("🔴 una migración que falla: el error de Postgres con su sentencia, y no queda nada a medias", async () => {
    ficheros["/supabase/migrations/20261004130000_bad.sql"] = `create table public.tags (id int primary key);\ncreate table public.notes (id int);\n`;
    const r = await runCli(["db", "push"], ficheros, cli);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('ERROR: relation "notes" already exists (SQLSTATE 42P07)');
    expect(r.stderr).toContain("At statement 1:\ncreate table public.notes (id int)");
    const tags = await t.pg.query(`select to_regclass('public.tags') as t`);
    expect(tags.rows[0]).toEqual({ t: null });
    delete ficheros["/supabase/migrations/20261004130000_bad.sql"];
  });

  it("migration list: local frente a remoto", async () => {
    const r = await runCli(["migration", "list"], ficheros, cli);
    expect(r.stdout).toContain("   20261004120000 | 20261004120000 | 2026-10-04 12:00:00 ");
  });

  it("una migración más vieja que la última aplicada pide --include-all", async () => {
    ficheros["/supabase/migrations/20261001000000_old.sql"] = "create table public.old (id int);";
    const r = await runCli(["db", "push"], ficheros, cli);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--include-all");
    const r2 = await runCli(["db", "push", "--include-all"], ficheros, cli);
    expect(r2.exitCode, r2.stderr).toBe(0);
  });

  it("db reset no: es la base en vivo", async () => {
    const r = await runCli(["db", "reset"], ficheros, cli);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("live database");
  });

  // Como en Supabase, el desarrollador LEE auth.users (la migración de GoTrue
  // se lo concede a `postgres`), pero el esquema es de GoTrue: no lo cambia.
  it("BRAZO DE CONTROL: el rol de desarrollador no puede cambiar el esquema auth", async () => {
    ficheros["/supabase/migrations/20261005000000_hack.sql"] = "alter table auth.users add column hack text;";
    const r = await runCli(["db", "push"], ficheros, cli);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("must be owner of table users");
    delete ficheros["/supabase/migrations/20261005000000_hack.sql"];
  });
});
