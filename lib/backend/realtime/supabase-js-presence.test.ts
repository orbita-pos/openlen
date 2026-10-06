// @vitest-environment node
//
// Presence con la LIBRERÍA REAL (`channel.track()`, `presenceState()` y los
// eventos `sync`/`join`/`leave` de @supabase/supabase-js 2.117.2) contra
// nuestro servidor de Realtime.
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
  rt = createRealtimeServer({ resolveProject: async () => P, channelErrorBackoffMs: 0, connectErrorBackoffMs: 0, limits: { clientPresenceMaxCalls: 3 } });
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

type Ev = { event: string; key?: string; newPresences?: unknown[]; leftPresences?: unknown[] };
function eventos(ch: RealtimeChannel): Ev[] {
  const vistos: Ev[] = [];
  ch.on("presence", { event: "sync" }, () => vistos.push({ event: "sync" }));
  ch.on("presence", { event: "join" }, (p) => vistos.push({ event: "join", key: p.key, newPresences: p.newPresences }));
  ch.on("presence", { event: "leave" }, (p) => vistos.push({ event: "leave", key: p.key, leftPresences: p.leftPresences }));
  return vistos;
}

describe("presence como Supabase Realtime", () => {
  it("A hace track: B lo ve en su estado y como `join`; A hace untrack: B ve el `leave`", async () => {
    const a = cliente().channel("sala-1", { config: { presence: { key: "ana" } } });
    const b = cliente().channel("sala-1", { config: { presence: { key: "beto" } } });
    const deB = eventos(b);
    await unido(b);
    await unido(a);
    expect(await a.track({ usuario: "ana", en: "portada" })).toBe("ok");
    await espera(300);
    expect(b.presenceState()).toEqual({ ana: [expect.objectContaining({ usuario: "ana", en: "portada", presence_ref: expect.any(String) })] });
    expect(deB).toContainEqual({ event: "join", key: "ana", newPresences: [expect.objectContaining({ usuario: "ana" })] });

    expect(await a.untrack()).toBe("ok");
    await espera(300);
    expect(b.presenceState()).toEqual({});
    expect(deB).toContainEqual({ event: "leave", key: "ana", leftPresences: [expect.objectContaining({ usuario: "ana" })] });
  });

  it("quien llega después recibe el estado entero (presence_state) al unirse", async () => {
    const a = cliente().channel("sala-2", { config: { presence: { key: "ana" } } });
    await unido(a);
    await a.track({ usuario: "ana" });
    await espera(200);
    const c = cliente().channel("sala-2", { config: { presence: { key: "carla" } } });
    eventos(c); // con algo escuchando presence, el cliente lo activa al unirse
    await unido(c);
    await espera(300);
    expect(c.presenceState()).toEqual({ ana: [expect.objectContaining({ usuario: "ana" })] });
  });

  it("track otra vez con otra carga: cambia, sin dejar la vieja", async () => {
    const a = cliente().channel("sala-3", { config: { presence: { key: "ana" } } });
    const b = cliente().channel("sala-3");
    eventos(b);
    await Promise.all([unido(a), unido(b)]);
    await a.track({ estado: "escribiendo" });
    await espera(200);
    await a.track({ estado: "leyendo" });
    await espera(300);
    expect(b.presenceState()).toEqual({ ana: [expect.objectContaining({ estado: "leyendo" })] });
  });

  it("🔴 si A cierra el socket, B lo ve salir", async () => {
    const ca = cliente();
    const a = ca.channel("sala-4", { config: { presence: { key: "ana" } } });
    const b = cliente().channel("sala-4");
    const deB = eventos(b);
    await Promise.all([unido(a), unido(b)]);
    await a.track({ usuario: "ana" });
    await espera(200);
    ca.realtime.disconnect();
    await espera(400);
    expect(b.presenceState()).toEqual({});
    expect(deB).toContainEqual(expect.objectContaining({ event: "leave", key: "ana" }));
  });

  it("una carga que no es un objeto: «Presence track payload must be a map»", async () => {
    const a = cliente().channel("sala-5");
    await unido(a);
    expect(await a.track("hola" as unknown as Record<string, unknown>)).toBe("error");
  });

  it("más de los track permitidos en su ventana: el canal se cierra con su mensaje", async () => {
    const a = cliente().channel("sala-6");
    const sistema: Record<string, unknown>[] = [];
    a.on("system", {}, (p) => sistema.push(p as Record<string, unknown>));
    await unido(a);
    for (let i = 0; i < 4; i++) await a.track({ i });
    await espera(300);
    expect(sistema).toContainEqual(expect.objectContaining({ status: "error", message: "Client presence rate limit exceeded" }));
  });
});
