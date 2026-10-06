// @vitest-environment node
//
// El broadcast por HTTP de Supabase Realtime con la LIBRERÍA REAL: `send()` de
// un canal sin unirse (va a `POST /realtime/v1/api/broadcast`) y `httpSend()`
// (`POST /realtime/v1/api/broadcast/:topic/events/:event`), y los límites
// por proyecto con sus mensajes.
import http from "node:http";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { hashSecretKey, newJwtSecret, newPublishableKey, newSecretKey } from "../keys";
import { createRealtimeServer, type RealtimeProject } from "./server";

vi.setConfig({ testTimeout: 20_000 });

const secretKey = newSecretKey();
const P: RealtimeProject = { ref: "abcdefghijklmnopqrst", publishableKey: newPublishableKey(), secretKeyHash: hashSecretKey(secretKey), jwtSecret: newJwtSecret() };

let rt: ReturnType<typeof createRealtimeServer>;
let port = 0;
const clientes: SupabaseClient[] = [];

beforeAll(async () => {
  rt = createRealtimeServer({
    resolveProject: async () => P,
    channelErrorBackoffMs: 0,
    connectErrorBackoffMs: 0,
    limits: { maxConcurrentUsers: 6, maxChannelsPerClient: 2, maxEventsPerSecond: 5 },
  });
  await new Promise<void>((r) => rt.server.listen(0, "127.0.0.1", r));
  port = (rt.server.address() as { port: number }).port;
});
afterAll(async () => {
  for (const c of clientes) await c.removeAllChannels();
  await rt.close();
});

function cliente(): SupabaseClient {
  const c = createClient(`http://127.0.0.1:${port}`, P.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
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

describe("broadcast por HTTP", () => {
  it("send() sin unirse va por HTTP y llega a quien escucha", async () => {
    const oyente = cliente().channel("http-1");
    const vistos: unknown[] = [];
    oyente.on("broadcast", { event: "hola" }, (m) => vistos.push(m.payload));
    await unido(oyente);
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await cliente().channel("http-1").send({ type: "broadcast", event: "hola", payload: { x: 1 } })).toBe("ok");
    avisos.mockRestore();
    await espera(300);
    expect(vistos).toEqual([{ x: 1 }]);
    await clientes.at(-2)!.removeAllChannels();
  });

  it("httpSend() con JSON: 202 y llega", async () => {
    const oyente = cliente().channel("http-2");
    const vistos: unknown[] = [];
    oyente.on("broadcast", { event: "e" }, (m) => vistos.push(m.payload));
    await unido(oyente);
    expect(await cliente().channel("http-2").httpSend("e", { y: 2 })).toEqual({ success: true });
    await espera(300);
    expect(vistos).toEqual([{ y: 2 }]);
    await clientes.at(-2)!.removeAllChannels();
  });

  it("sin clave: 401 {message: Unauthorized}", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/realtime/v1/api/broadcast`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [] }) });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ message: "Unauthorized" });
  });

  it("un mensaje sin `event`: 422 con su error de changeset", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: P.publishableKey },
      body: JSON.stringify({ messages: [{ topic: "t", payload: {} }] }),
    });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ errors: { messages: [{ event: ["can't be blank"] }] } });
  });
});

describe("los límites de Supabase por proyecto", () => {
  it("más canales de los permitidos en un socket: «ChannelRateLimitReached: Too many channels»", async () => {
    const c = cliente();
    await unido(c.channel("lim-1"));
    await unido(c.channel("lim-2"));
    await expect(unido(c.channel("lim-3"))).rejects.toThrow("ChannelRateLimitReached: Too many channels");
    await c.removeAllChannels();
  });

  it("más mensajes por segundo de los permitidos: el canal se cierra con «Too many messages per second»", async () => {
    const ch = cliente().channel("rafaga");
    const sistema: Record<string, unknown>[] = [];
    ch.on("system", {}, (p) => sistema.push(p as Record<string, unknown>));
    await unido(ch);
    for (let i = 0; i < 8; i++) await ch.send({ type: "broadcast", event: "r", payload: { i } });
    await espera(300);
    expect(sistema).toContainEqual(expect.objectContaining({ status: "error", message: "Too many messages per second" }));
  });

  it("más sockets a la vez de los permitidos: 429 «Too many connected users»", async () => {
    const abiertos: WebSocket[] = [];
    for (let i = 0; i < 6; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/realtime/v1/websocket?apikey=${P.publishableKey}&vsn=2.0.0`);
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
        ws.onerror = () => resolve();
      });
      abiertos.push(ws);
    }
    // Un apretón más, a mano, para leer el estado y el cuerpo.
    const r = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port,
        path: `/realtime/v1/websocket?apikey=${P.publishableKey}&vsn=2.0.0`,
        headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" },
      });
      req.on("response", (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      });
      req.on("upgrade", (res, socket) => {
        socket.destroy();
        resolve({ status: res.statusCode ?? 0, body: "" });
      });
      req.on("error", reject);
      req.end();
    });
    for (const ws of abiertos) ws.close();
    expect(r.status).toBe(429);
    expect(JSON.parse(r.body)).toEqual({ error: "Too many connected users" });
  });
});
