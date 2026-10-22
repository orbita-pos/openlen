// @vitest-environment node
//
// Realtime from Len's box (lib/agent/sandbox/box-marker.ts), with the REAL library: E2B's proxy adds
// the marker to the box's socket and to its HTTP calls. On production the box listens but never
// writes —a broadcast doesn't reach the visitors, a presence `track` is refused, the HTTP broadcast
// answers 403—; on the draft it does everything, as the canvas does.
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { BOX_MARKER_HEADER } from "@/lib/agent/sandbox/box-marker";

import { hashSecretKey, newJwtSecret, newPublishableKey, newSecretKey } from "../keys";
import { createRealtimeServer, type RealtimeProject } from "./server";

vi.setConfig({ testTimeout: 20_000 });

const CANVAS = "https://lienzo-x.openlen.test";
const keys = { publishableKey: newPublishableKey(), secretKeyHash: hashSecretKey(newSecretKey()), jwtSecret: newJwtSecret() };
const LIVE: RealtimeProject = { ref: "abcdefghijklmnopqrst", environment: "live", ...keys };
const DRAFT: RealtimeProject = { ref: "abcdefghijklmnopqrsd", environment: "draft", ...keys };

let rt: ReturnType<typeof createRealtimeServer>;
let port = 0;
const clientes: SupabaseClient[] = [];

beforeAll(async () => {
  rt = createRealtimeServer({
    // As project-lookup.ts: the canvas's Origin goes to the draft, the rest to production.
    resolveProject: async (_host, origin) => (origin === CANVAS ? DRAFT : LIVE),
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

/** A socket as the box's leaves E2B's proxy: with the marker (and, from the canvas, its Origin). */
function boxTransport(origin?: string) {
  return class extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { [BOX_MARKER_HEADER]: "p.mac" }, ...(origin ? { origin } : {}) });
    }
  };
}

function cliente(o: { box?: boolean; origin?: string } = {}): SupabaseClient {
  const transport = o.box ? boxTransport(o.origin) : o.origin ? boxlessTransport(o.origin) : undefined;
  const c = createClient(`http://127.0.0.1:${port}`, keys.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(transport ? { realtime: { transport: transport as never } } : {}),
  });
  clientes.push(c);
  return c;
}

function boxlessTransport(origin: string) {
  return class extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { origin });
    }
  };
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

function oye(ch: RealtimeChannel, event: string): unknown[] {
  const vistos: unknown[] = [];
  ch.on("broadcast", { event }, (m) => vistos.push(m.payload));
  return vistos;
}

describe("Realtime from Len's box", () => {
  it("on production the box listens: a visitor's broadcast reaches it", async () => {
    const caja = cliente({ box: true }).channel("sala-1");
    const vistos = oye(caja, "hola");
    await unido(caja);
    const visitante = await unido(cliente().channel("sala-1"));
    await visitante.send({ type: "broadcast", event: "hola", payload: { de: "visitante" } });
    await espera(300);
    expect(vistos).toEqual([{ de: "visitante" }]);
  });

  it("🔴 on production the box's broadcast doesn't reach the visitors, and with ack it's an error", async () => {
    const visitante = cliente().channel("sala-2");
    const vistos = oye(visitante, "hola");
    await unido(visitante);
    const caja = await unido(cliente({ box: true }).channel("sala-2", { config: { broadcast: { ack: true } } }));
    expect(await caja.send({ type: "broadcast", event: "hola", payload: { de: "caja" } })).toBe("error");
    const sinAck = await unido(cliente({ box: true }).channel("sala-2"));
    await sinAck.send({ type: "broadcast", event: "hola", payload: { de: "caja" } });
    await espera(300);
    expect(vistos).toEqual([]);
  });

  it("🔴 on production the box's presence `track` is refused and nobody sees it", async () => {
    const visitante = cliente().channel("sala-3");
    const joins: string[] = [];
    visitante.on("presence", { event: "join" }, (p) => joins.push(p.key));
    await unido(visitante);
    const caja = await unido(cliente({ box: true }).channel("sala-3", { config: { presence: { key: "len" } } }));
    expect(await caja.track({ quien: "len" })).toBe("error");
    await espera(300);
    expect(joins).not.toContain("len");
  });

  it("🔴 on production the box's HTTP broadcast answers 403 and delivers nothing", async () => {
    const visitante = cliente().channel("sala-4");
    const vistos = oye(visitante, "hola");
    await unido(visitante);
    const res = await fetch(`http://127.0.0.1:${port}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: keys.publishableKey, "content-type": "application/json", [BOX_MARKER_HEADER]: "p.mac" },
      body: JSON.stringify({ messages: [{ topic: "sala-4", event: "hola", payload: { de: "caja" } }] }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "Len's box only reads production: test writes against the draft (the canvas)." });
    await espera(300);
    expect(vistos).toEqual([]);
  });

  it("on the draft (the canvas's Origin) the box broadcasts and tracks as anyone", async () => {
    const otro = cliente({ origin: CANVAS }).channel("sala-5");
    const vistos = oye(otro, "hola");
    await unido(otro);
    const caja = await unido(cliente({ box: true, origin: CANVAS }).channel("sala-5", { config: { broadcast: { ack: true } } }));
    expect(await caja.send({ type: "broadcast", event: "hola", payload: { de: "caja" } })).toBe("ok");
    expect(await caja.track({ quien: "len" })).toBe("ok");
    await espera(300);
    expect(vistos).toEqual([{ de: "caja" }]);
  });
});
