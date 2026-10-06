// @vitest-environment node
//
// Broadcast con la LIBRERÍA REAL (`supabase.channel(…)` de @supabase/supabase-js
// 2.117.2, por WebSocket de verdad) contra nuestro servidor de Realtime en un
// puerto efímero. Dos proyectos: uno se llama por 127.0.0.1 y otro por
// localhost (el servidor resuelve el proyecto por el Host, como en producción).
import http from "node:http";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { hashSecretKey, newJwtSecret, newPublishableKey, newSecretKey, signJwt } from "../keys";
import { createRealtimeServer, type RealtimeProject } from "./server";

vi.setConfig({ testTimeout: 20_000 });

function proyecto(ref: string): RealtimeProject & { secretKey: string } {
  const secretKey = newSecretKey();
  return { ref, publishableKey: newPublishableKey(), secretKeyHash: hashSecretKey(secretKey), jwtSecret: newJwtSecret(), secretKey };
}
const P1 = proyecto("abcdefghijklmnopqrst");
const P2 = proyecto("bcdefghijklmnopqrstu");

let rt: ReturnType<typeof createRealtimeServer>;
let port = 0;
const clientes: SupabaseClient[] = [];

beforeAll(async () => {
  rt = createRealtimeServer({
    resolveProject: async (host) => (host.startsWith("127.0.0.1") ? P1 : host.startsWith("localhost") ? P2 : null),
    channelErrorBackoffMs: 0,
    connectErrorBackoffMs: 0,
  });
  await new Promise<void>((r) => rt.server.listen(0, "127.0.0.1", r));
  port = (rt.server.address() as { port: number }).port;
});
afterAll(async () => {
  for (const c of clientes) await c.removeAllChannels();
  await rt.close();
});

function cliente(host: "127.0.0.1" | "localhost", key: string, accessToken?: string): SupabaseClient {
  const c = createClient(`http://${host}:${port}`, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(accessToken ? { accessToken: async () => accessToken } : {}),
  });
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

function oye(ch: RealtimeChannel, event: string): unknown[] {
  const vistos: unknown[] = [];
  ch.on("broadcast", { event }, (m) => vistos.push(m.payload));
  return vistos;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("broadcast como Supabase Realtime", () => {
  it("A manda en «sala»: lo oye B, no A (self: false), y nadie de otra sala", async () => {
    const a = cliente("127.0.0.1", P1.publishableKey).channel("sala");
    const b = cliente("127.0.0.1", P1.publishableKey).channel("sala");
    const c = cliente("127.0.0.1", P1.publishableKey).channel("otra-sala");
    const deA = oye(a, "hola");
    const deB = oye(b, "hola");
    const deC = oye(c, "hola");
    await Promise.all([unido(a), unido(b), unido(c)]);
    expect(await a.send({ type: "broadcast", event: "hola", payload: { x: 1, texto: "ñandú 🎉" } })).toBe("ok");
    await espera(300);
    expect(deB).toEqual([{ x: 1, texto: "ñandú 🎉" }]);
    expect(deA).toEqual([]);
    expect(deC).toEqual([]);
  });

  it("con self: true lo oye también quien lo manda; con ack: true, send espera su «ok»", async () => {
    const a = cliente("127.0.0.1", P1.publishableKey).channel("eco", { config: { broadcast: { self: true, ack: true } } });
    const deA = oye(a, "e");
    await unido(a);
    expect(await a.send({ type: "broadcast", event: "e", payload: { n: 2 } })).toBe("ok");
    await espera(200);
    expect(deA).toEqual([{ n: 2 }]);
  });

  it("🔴 el mismo canal en DOS proyectos no se cruza", async () => {
    const a = cliente("127.0.0.1", P1.publishableKey).channel("comun");
    const b = cliente("localhost", P2.publishableKey).channel("comun");
    const deB = oye(b, "x");
    await Promise.all([unido(a), unido(b)]);
    await a.send({ type: "broadcast", event: "x", payload: { de: "p1" } });
    await espera(300);
    expect(deB).toEqual([]);
  });

  it("una carga binaria llega con los mismos bytes", async () => {
    const a = cliente("127.0.0.1", P1.publishableKey).channel("bytes");
    const b = cliente("127.0.0.1", P1.publishableKey).channel("bytes");
    const deB = oye(b, "bin");
    await Promise.all([unido(a), unido(b)]);
    await a.send({ type: "broadcast", event: "bin", payload: new Uint8Array([1, 2, 250]).buffer });
    await espera(300);
    expect(deB).toHaveLength(1);
    expect([...new Uint8Array(deB[0] as ArrayBuffer)]).toEqual([1, 2, 250]);
  });

  it("🔴 una carga de más de 3.000 KB con ack: error, y el servidor sigue atendiendo", async () => {
    const a = cliente("127.0.0.1", P1.publishableKey).channel("grande", { config: { broadcast: { ack: true } } });
    await unido(a);
    expect(await a.send({ type: "broadcast", event: "g", payload: { s: "x".repeat(3_000_600) } })).toBe("error");
    expect(await a.send({ type: "broadcast", event: "g", payload: { s: "pequeña" } })).toBe("ok");
  });

  // supabase-js pone el token con `setAuth` sin esperar: aquí se espera, para
  // que el join lo lleve (como cuando la sesión ya estaba antes de suscribirse).
  it("un JWT de usuario manda en el canal; caducado, el canal no entra", async () => {
    const vivo = await signJwt(P1.jwtSecret, { sub: "u1", role: "authenticated" }, 3600);
    const c1 = cliente("127.0.0.1", P1.publishableKey, vivo);
    await c1.realtime.setAuth();
    await unido(c1.channel("con-usuario"));
    const muerto = await signJwt(P1.jwtSecret, { sub: "u1", role: "authenticated" }, -60);
    const c2 = cliente("127.0.0.1", P1.publishableKey, muerto);
    await c2.realtime.setAuth();
    await expect(unido(c2.channel("con-usuario-caducado"))).rejects.toThrow(/InvalidJWTToken: Token has expired \d+ seconds ago/);
  });

  it("🔴 un token nuevo que ya no vale cierra el canal con su `system` (no sigue escuchando)", async () => {
    const c = cliente("127.0.0.1", P1.publishableKey);
    const ch = c.channel("refresco");
    const sistema: Record<string, unknown>[] = [];
    ch.on("system", {}, (p) => sistema.push(p as Record<string, unknown>));
    await unido(ch);
    const muerto = await signJwt(P1.jwtSecret, { sub: "u1", role: "authenticated" }, -60);
    await c.realtime.setAuth(muerto);
    await espera(300);
    expect(sistema).toContainEqual(expect.objectContaining({ extension: "system", status: "error", message: expect.stringMatching(/^Token has expired \d+ seconds ago$/) }));
    expect(ch.state).toBe("closed");
  });

  it("sin «realtime:<algo>» no hay canal: «You must provide a topic name»", async () => {
    const ch = cliente("127.0.0.1", P1.publishableKey).channel("");
    await expect(unido(ch)).rejects.toThrow(/TopicNameRequired: You must provide a topic name/);
  });
});

describe("el apretón", () => {
  it("un host que no es de ningún proyecto: 404 «Tenant not found»", async () => {
    // Sin cabeceras de upgrade el servidor contesta como HTTP: la misma puerta.
    const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/realtime/v1/websocket?apikey=x&vsn=2.0.0", headers: { host: "nadie.openlen.app" } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(404);
    expect(JSON.parse(body)).toEqual({ error: "Tenant not found" });
  });

  it("sin clave: 401 «API key is missing»", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/realtime/v1/websocket?vsn=2.0.0`);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "API key is missing" });
  });
});
