// @vitest-environment node
//
// Alta y baja de suscripciones de `postgres_changes` en `realtime.subscription`
// con SU consulta (subscriptions.ex), contra el esquema real en PGlite.
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { TestProject } from "../testing/project";
import { createSubscriptions, deleteSubscriptions, parseSubscriptionParams } from "./subscriptions";
import { newRealtimeTestProject } from "./testing";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const MIGRACION = `
create table public.mensajes (id bigint generated always as identity primary key, sala int not null, texto text);
alter table public.mensajes enable row level security;
alter publication supabase_realtime add table public.mensajes;
create table public.privada (id bigint primary key);
`;

let t: TestProject;
beforeAll(async () => {
  t = await newRealtimeTestProject(MIGRACION);
});

const params = (p: Record<string, unknown>) => {
  const r = parseSubscriptionParams(p);
  if (!r.ok) throw new Error(r.error);
  return r.params;
};
const U1 = "11111111-1111-4111-8111-111111111111";
const filas = async () =>
  (await t.pg.query<{ entity: string; action_filter: string; filters: string; claims_role: string }>(
    `select entity::text, action_filter, filters::text, claims_role::text from realtime.subscription order by id`,
  )).rows;

describe("las suscripciones de postgres_changes", () => {
  it("alta con filtro: una fila con su tabla, su evento, su filtro y su rol", async () => {
    const id = "aaaaaaaa-0000-4000-8000-000000000001";
    await createSubscriptions(t.project.db, [{ id, claims: { role: "authenticated", sub: U1 }, params: params({ event: "INSERT", schema: "public", table: "mensajes", filter: "sala=eq.1" }) }]);
    expect(await filas()).toEqual([{ entity: "mensajes", action_filter: "INSERT", filters: '{"(sala,eq,1,f)"}', claims_role: "authenticated" }]);
    await deleteSubscriptions(t.project.db, [id]);
    expect(await filas()).toEqual([]);
  });

  it("una tabla que no está en la publicación: su error, y no queda nada", async () => {
    await expect(
      createSubscriptions(t.project.db, [{ id: "aaaaaaaa-0000-4000-8000-000000000002", claims: { role: "anon" }, params: params({ schema: "public", table: "privada" }) }]),
    ).rejects.toThrow(
      "Unable to subscribe to changes with given parameters. Please check Realtime is enabled for the given connect parameters: [event: *, schema: public, table: privada, filters: [], select: nil]",
    );
    expect(await filas()).toEqual([]);
  });

  it("una columna que no existe: el error de su disparador, y no queda nada", async () => {
    await expect(
      createSubscriptions(t.project.db, [{ id: "aaaaaaaa-0000-4000-8000-000000000003", claims: { role: "anon" }, params: params({ schema: "public", table: "mensajes", filter: "nada=eq.1" }) }]),
    ).rejects.toThrow(/Unable to subscribe to changes with given parameters\. An exception happened so please check your connect parameters: .*Exception: .*nada/);
    expect(await filas()).toEqual([]);
  });
});
