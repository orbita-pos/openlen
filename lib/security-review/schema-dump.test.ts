// @vitest-environment node
//
// The draft database's schema as the review reads it, against a real Postgres
// (PGlite) with the same roles and grants as a project's.
import { beforeEach, describe, expect, it } from "vitest";

import { newTestProject, type TestProject } from "@/lib/backend/testing/project";

import { dumpSchema } from "./schema-dump";

const MIGRATION = `
create table public.notas (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  texto text not null
);
alter table public.notas enable row level security;
create policy "mis notas" on public.notas for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.productos (sku text primary key, nombre text not null);

create table public.pedidos (id bigint generated always as identity primary key, texto text);
alter table public.pedidos enable row level security;
create policy "cualquiera edita" on public.pedidos for update to anon using (true);
create policy "nadie borra" on public.pedidos as restrictive for delete to public using (false);
`;

let t: TestProject;

beforeEach(async () => {
  t = await newTestProject(MIGRATION);
});

describe("dumpSchema", () => {
  it("lists every table of public with its RLS switch", async () => {
    const d = await dumpSchema(t.project);
    expect(d.tables).toEqual([
      { name: "notas", rls: true },
      { name: "pedidos", rls: true },
      { name: "productos", rls: false },
    ]);
  });

  it("writes each policy out: command, roles, permissive and its expressions", async () => {
    const d = await dumpSchema(t.project);
    const byName = Object.fromEntries(d.policies.filter((p) => p.schema === "public").map((p) => [p.name, p]));
    expect(byName["cualquiera edita"]).toEqual({
      schema: "public",
      table: "pedidos",
      name: "cualquiera edita",
      command: "UPDATE",
      permissive: true,
      roles: ["anon"],
      using: "true",
      withCheck: null,
    });
    expect(byName["nadie borra"]).toMatchObject({ command: "DELETE", permissive: false, roles: ["public"], using: "false" });
    expect(byName["mis notas"]).toMatchObject({ command: "ALL", permissive: true, roles: ["authenticated"] });
    expect(byName["mis notas"]!.using).toContain("auth.uid()");
  });

  it("answers the buckets as a list even when Storage was never set up", async () => {
    const d = await dumpSchema(t.project);
    expect(Array.isArray(d.buckets)).toBe(true);
  });
});
