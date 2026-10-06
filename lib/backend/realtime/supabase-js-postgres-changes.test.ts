// @vitest-environment node
//
// postgres_changes con la LIBRERÍA REAL (`.on("postgres_changes", …)` de
// @supabase/supabase-js 2.117.2) contra nuestro servidor, con el esquema
// `realtime` de Supabase en PGlite y SU `apply_rls` decidiendo quién ve cada
// cambio. Lo único doble es el slot de wal2json (PGlite no tiene replicación
// lógica): una cola que llena un disparador con el mismo JSON que wal2json v2
// (testing.ts). Todo lo demás —la publicación, las suscripciones, apply_rls,
// el reparto— es el código de producción.
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";

import { signJwt } from "../keys";
import type { TestProject } from "../testing/project";
import type { ChangeSource } from "./poller";
import { createRealtimeServer, type RealtimeProject } from "./server";
import { installWalCapture, newRealtimeTestProject, queueChangeSource } from "./testing";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const MIGRACION = `
create table public.mensajes (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  texto text,
  secreto text
);
alter table public.mensajes enable row level security;
create policy "cada uno lo suyo" on public.mensajes for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.mensajes from authenticated;
grant select (id, user_id, texto) on public.mensajes to authenticated;
alter publication supabase_realtime add table public.mensajes;
create table public.fuera (id bigint primary key, x text);
`;

let t: TestProject;
let rt: ReturnType<typeof createRealtimeServer>;
let port = 0;
const fuentes: { abiertas: number; cerradas: number } = { abiertas: 0, cerradas: 0 };
const clientes: SupabaseClient[] = [];
// La ida y vuelta de un Postgres por red (PGlite contesta en el mismo proceso):
// a 0 salvo en la prueba que la necesita.
let latenciaMs = 0;

beforeAll(async () => {
  t = await newRealtimeTestProject(MIGRACION);
  await installWalCapture(t.pg, ["public.mensajes", "public.fuera"]);
  const project: RealtimeProject = { ref: "abcdefghijklmnopqrst", publishableKey: t.project.publishableKey, secretKeyHash: t.project.secretKeyHash, jwtSecret: t.project.jwtSecret,
    db: { transaction: async (fn) => {
      if (latenciaMs > 0) await espera(latenciaMs);
      return t.project.db.transaction(fn);
    } },
  };
  rt = createRealtimeServer({
    resolveProject: async () => project,
    channelErrorBackoffMs: 0,
    connectErrorBackoffMs: 0,
    pollIntervalMs: 20,
    changeSource: (p): ChangeSource => {
      const s = queueChangeSource(t.pg, p.db!);
      return {
        open: async () => {
          fuentes.abiertas++;
          await s.open();
        },
        listChanges: (o) => s.listChanges(o),
        close: async () => {
          fuentes.cerradas++;
          await s.close();
        },
      };
    },
  });
  await new Promise<void>((r) => rt.server.listen(0, "127.0.0.1", r));
  port = (rt.server.address() as { port: number }).port;
});
afterAll(async () => {
  for (const c of clientes) await c.removeAllChannels();
  await rt.close();
});

async function cliente(sub: string | null): Promise<SupabaseClient> {
  const jwt = sub ? await signJwt(t.project.jwtSecret, { sub, role: "authenticated" }, 3600) : null;
  const c = createClient(`http://127.0.0.1:${port}`, sub ? t.project.publishableKey : t.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(jwt ? { accessToken: async () => jwt } : {}),
  });
  if (jwt) await c.realtime.setAuth();
  clientes.push(c);
  return c;
}

type Cambio = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown>; errors: unknown };

/** Se une y espera el «Subscribed to PostgreSQL» del servidor. */
async function escucha(c: SupabaseClient, nombre: string, filtro: { event: "INSERT" | "UPDATE" | "DELETE" | "*"; filter?: string }): Promise<{ ch: RealtimeChannel; vistos: Cambio[] }> {
  const vistos: Cambio[] = [];
  const ch = c.channel(nombre);
  ch.on("postgres_changes", { event: filtro.event as "INSERT", schema: "public", table: "mensajes", ...(filtro.filter ? { filter: filtro.filter } : {}) }, (p) => vistos.push(p as unknown as Cambio));
  const listo = new Promise<void>((resolve, reject) => {
    ch.on("system", {}, (s: { extension?: string; status?: string; message?: string }) => {
      if (s.extension === "postgres_changes" && s.status === "ok") resolve();
      if (s.extension === "postgres_changes" && s.status === "error") reject(new Error(s.message));
    });
  });
  await new Promise<void>((resolve, reject) =>
    ch.subscribe((status, err) => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(err ?? new Error(status));
    }),
  );
  await listo;
  return { ch, vistos };
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inserta = async (user: string, texto: string) =>
  (await t.pg.query<{ id: number }>(`insert into public.mensajes (user_id, texto, secreto) values ($1, $2, 'shh') returning id`, [user, texto])).rows[0]!.id;

describe("postgres_changes como Supabase Realtime", () => {
  it("🔴 cada uno oye SUS filas (su RLS), sin la columna que no puede leer", async () => {
    const a = await escucha(await cliente(U1), "u1-insert", { event: "INSERT" });
    const b = await escucha(await cliente(U2), "u2-insert", { event: "INSERT" });
    await inserta(U1, "hola de u1");
    await espera(400);
    expect(a.vistos).toHaveLength(1);
    expect(a.vistos[0]).toMatchObject({ eventType: "INSERT", new: { user_id: U1, texto: "hola de u1" }, old: {}, errors: null });
    expect(a.vistos[0]!.new).not.toHaveProperty("secreto");
    expect(b.vistos).toEqual([]);
  });

  it("un UPDATE con filtro sólo de su fila; un DELETE con la clave en `old`", async () => {
    const id = await inserta(U1, "antes");
    const otro = await inserta(U1, "otro");
    const up = await escucha(await cliente(U1), "u1-update", { event: "UPDATE", filter: `id=eq.${id}` });
    const del = await escucha(await cliente(U1), "u1-delete", { event: "DELETE" });
    await t.pg.query(`update public.mensajes set texto = 'después' where id in ($1, $2)`, [id, otro]);
    await t.pg.query(`delete from public.mensajes where id = $1`, [otro]);
    await espera(400);
    expect(up.vistos).toHaveLength(1);
    expect(up.vistos[0]).toMatchObject({ eventType: "UPDATE", new: { id, texto: "después" } });
    // Con RLS, un DELETE sólo enseña la clave (Supabase no puede asegurar más).
    expect(del.vistos).toEqual([expect.objectContaining({ eventType: "DELETE", old: { id: otro } })]);
  });

  it("la clave secreta (service_role) lo ve todo, también lo que RLS esconde y la columna de más", async () => {
    const s = await escucha(await cliente(null), "servicio", { event: "INSERT" });
    await inserta(U2, "de u2");
    await espera(400);
    expect(s.vistos).toEqual([expect.objectContaining({ eventType: "INSERT", new: expect.objectContaining({ user_id: U2, texto: "de u2", secreto: "shh" }) })]);
  });

  it("una tabla que no está en la publicación no se oye", async () => {
    const s = await escucha(await cliente(null), "servicio-2", { event: "*" });
    await t.pg.query(`insert into public.fuera (id, x) values (1, 'no')`);
    await espera(300);
    expect(s.vistos).toEqual([]);
  });

  it("🔴 un token nuevo cambia lo que se oye: la RLS del nuevo dueño", async () => {
    const c = await cliente(U1);
    const r = await escucha(c, "cambio-de-token", { event: "INSERT" });
    await c.realtime.setAuth(await signJwt(t.project.jwtSecret, { sub: U2, role: "authenticated" }, 3600));
    await espera(300);
    await inserta(U1, "ya no es de quien escucha");
    await inserta(U2, "ahora sí");
    await espera(400);
    expect(r.vistos.map((v) => v.new.texto)).toEqual(["ahora sí"]);
  });

  // supabase-js manda su `access_token` justo después del join: puede llegar con
  // el alta de las suscripciones todavía en marcha. Con mensajes crudos y la
  // base lenta, para que pase seguro: join y access_token seguidos, y fuera.
  it("🔴 un token que llega mientras se da de alta no deja suscripciones colgadas", async () => {
    const jwt1 = await signJwt(t.project.jwtSecret, { sub: U1, role: "authenticated" }, 3600);
    const jwt2 = await signJwt(t.project.jwtSecret, { sub: U2, role: "authenticated" }, 3600);
    const cuenta = async () => (await t.pg.query<{ n: number }>(`select count(*)::int as n from realtime.subscription`)).rows[0]!.n;
    const antes = await cuenta();
    latenciaMs = 150;
    onTestFinished(() => {
      latenciaMs = 0;
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/realtime/v1/websocket?apikey=${t.project.publishableKey}&vsn=2.0.0`);
    await new Promise<void>((r) => (ws.onopen = () => r()));
    const vistos: unknown[] = [];
    ws.onmessage = (e) => vistos.push(JSON.parse(String(e.data)));
    const topic = "realtime:carrera";
    const config = { broadcast: { self: false, ack: false }, presence: { key: "", enabled: false }, postgres_changes: [{ event: "INSERT", schema: "public", table: "mensajes" }], private: false };
    ws.send(JSON.stringify(["1", "1", topic, "phx_join", { config, access_token: jwt1 }]));
    ws.send(JSON.stringify(["1", "2", topic, "access_token", { access_token: jwt2 }]));
    await espera(400);
    ws.send(JSON.stringify(["1", "3", topic, "phx_leave", {}]));
    await espera(400);
    ws.close();
    await espera(300);
    expect(vistos).toContainEqual(["1", "1", topic, "phx_reply", expect.objectContaining({ status: "ok" })]);
    expect(await cuenta()).toBe(antes);
  });

  it("🔴 al irse el último, el sondeo suelta la fuente y no quedan suscripciones", async () => {
    for (const c of clientes.splice(0)) await c.removeAllChannels();
    await espera(400);
    expect(fuentes.cerradas).toBe(fuentes.abiertas);
    expect(fuentes.abiertas).toBeGreaterThan(0);
    const n = await t.pg.query<{ n: number }>(`select count(*)::int as n from realtime.subscription`);
    expect(n.rows[0]!.n).toBe(0);
  });
});
