// @vitest-environment node
//
// Canales privados (Realtime Authorization) con la LIBRERÍA REAL: `private:
// true` y las políticas de RLS en `realtime.messages` con `realtime.topic()`,
// el patrón de su documentación, contra el esquema real en PGlite.
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { signJwt } from "../keys";
import type { TestProject } from "../testing/project";
import { createRealtimeServer, type RealtimeProject } from "./server";
import { newRealtimeTestProject } from "./testing";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

// «sala:<uid>»: leer y escribir el suyo; «lectura:<uid>»: sólo leer. Sólo
// broadcast (`extension`), como en su documentación: presence no tiene política.
const MIGRACION = `
create policy "leer lo suyo" on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and realtime.topic() in ('sala:' || (select auth.uid())::text, 'lectura:' || (select auth.uid())::text));
create policy "escribir en su sala" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and realtime.topic() = 'sala:' || (select auth.uid())::text);
`;

let t: TestProject;
let rt: ReturnType<typeof createRealtimeServer>;
let port = 0;
const clientes: SupabaseClient[] = [];

beforeAll(async () => {
  t = await newRealtimeTestProject(MIGRACION);
  const project: RealtimeProject = { ref: "abcdefghijklmnopqrst", publishableKey: t.project.publishableKey, secretKeyHash: t.project.secretKeyHash, jwtSecret: t.project.jwtSecret, db: t.project.db };
  rt = createRealtimeServer({ resolveProject: async () => project, channelErrorBackoffMs: 0, connectErrorBackoffMs: 0 });
  await new Promise<void>((r) => rt.server.listen(0, "127.0.0.1", r));
  port = (rt.server.address() as { port: number }).port;
});
afterAll(async () => {
  for (const c of clientes) await c.removeAllChannels();
  await rt.close();
});

async function cliente(sub: string): Promise<SupabaseClient> {
  const jwt = await signJwt(t.project.jwtSecret, { sub, role: "authenticated" }, 3600);
  const c = createClient(`http://127.0.0.1:${port}`, t.project.publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, accessToken: async () => jwt });
  await c.realtime.setAuth();
  clientes.push(c);
  return c;
}

async function unido(ch: RealtimeChannel): Promise<RealtimeChannel> {
  await new Promise<void>((resolve, reject) =>
    ch.subscribe((status, err) => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(err ?? new Error(status));
    }),
  );
  return ch;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const privado = { config: { private: true } } as const;

describe("canales privados como Supabase Realtime Authorization", () => {
  it("🔴 u1 entra en su sala; u2 no: «You do not have permissions to read from this Channel topic»", async () => {
    await unido((await cliente(U1)).channel(`sala:${U1}`, privado));
    await expect(unido((await cliente(U2)).channel(`sala:${U1}`, privado))).rejects.toThrow(
      `Unauthorized: You do not have permissions to read from this Channel topic: sala:${U1}`,
    );
  });

  it("con la política de escribir, el broadcast llega; con sólo la de leer, no", async () => {
    const a = (await cliente(U1)).channel(`sala:${U1}`, privado);
    const b = (await cliente(U1)).channel(`sala:${U1}`, privado);
    const deB: unknown[] = [];
    b.on("broadcast", { event: "x" }, (m) => deB.push(m.payload));
    await Promise.all([unido(a), unido(b)]);
    await a.send({ type: "broadcast", event: "x", payload: { n: 1 } });

    const c = (await cliente(U1)).channel(`lectura:${U1}`, privado);
    const d = (await cliente(U1)).channel(`lectura:${U1}`, privado);
    const deD: unknown[] = [];
    d.on("broadcast", { event: "x" }, (m) => deD.push(m.payload));
    await Promise.all([unido(c), unido(d)]);
    await c.send({ type: "broadcast", event: "x", payload: { n: 2 } });
    await espera(400);
    expect(deB).toEqual([{ n: 1 }]);
    expect(deD).toEqual([]);
  });

  it("presence sin política de presence: el track no entra", async () => {
    const a = await unido((await cliente(U1)).channel(`sala:${U1}`, privado));
    expect(await a.track({ yo: "u1" })).toBe("error");
  });

  // Su `apply_access_token`: si el token nuevo no lee nada, el error de
  // `maybe_assign_policies` (su «You no longer have permission…» es para
  // cuando se pierde una de las dos lecturas y la otra sigue).
  it("🔴 si el token nuevo ya no puede leer, el canal se cierra con su mensaje", async () => {
    const c = await cliente(U1);
    const ch = c.channel(`sala:${U1}`, privado);
    const sistema: Record<string, unknown>[] = [];
    ch.on("system", {}, (p) => sistema.push(p as Record<string, unknown>));
    await unido(ch);
    await c.realtime.setAuth(await signJwt(t.project.jwtSecret, { sub: U2, role: "authenticated" }, 3600));
    await espera(400);
    expect(sistema).toContainEqual(expect.objectContaining({ status: "error", message: `You do not have permissions to read from this Channel topic: sala:${U1}` }));
    expect(ch.state).toBe("closed");
  });

  it("un canal público con el mismo nombre no oye al privado", async () => {
    const priv = (await cliente(U1)).channel(`sala:${U1}`, privado);
    const pub = (await cliente(U1)).channel(`sala:${U1}`);
    const dePub: unknown[] = [];
    pub.on("broadcast", { event: "y" }, (m) => dePub.push(m.payload));
    await Promise.all([unido(priv), unido(pub)]);
    await priv.send({ type: "broadcast", event: "y", payload: {} });
    await espera(300);
    expect(dePub).toEqual([]);
  });
});
