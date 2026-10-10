// El servicio de Realtime (`/realtime/v1`), el de Supabase Realtime portado a
// Node (supabase/realtime @ f86df8c3, Apache-2.0). Un proceso aparte: los
// manejadores de ruta de Next no sostienen WebSockets. Caddy le pasa
// `/realtime/v1/*` (infra/caddy/Caddyfile, bloque «carril D»).
//
//   · `/realtime/v1/websocket?apikey=…&vsn=2.0.0` — el socket de Phoenix de
//     `realtime-js` (channel.ts). El proyecto sale del Host, como en su
//     `UserSocket.connect` (`get_external_id(host)`).
//   · Lo demás: el 404 de su router.

import http from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketServer } from "ws";

import { authorizeSocket } from "./auth";
import { handleBroadcastApi, isBroadcastApi } from "./broadcast-api";
import { PostgresChangesHub, type ChangeSourceFactory } from "./changes";
import { DEFAULT_POLLER_TIMING } from "./poller";
import { Session, type Channel, type Hub, type RealtimeProject } from "./channel";
import { MessagesJanitor, type JanitorOptions } from "./janitor";
import { realtimeLimits, type RealtimeLimits } from "./limits";
import { PresenceRegistry } from "./presence";

export type { RealtimeProject } from "./channel";

export interface RealtimeServerOptions {
  /** El proyecto del Host de la petición, en el entorno que dice su Origin
   *  (spec local 2026-10-09), o null. */
  resolveProject(host: string, origin: string | null): Promise<RealtimeProject | null>;
  readonly limits?: Partial<RealtimeLimits>;
  /** Su CHANNEL_ERROR_BACKOFF_MS (5 s). */
  readonly channelErrorBackoffMs?: number;
  /** Su CONNECT_ERROR_BACKOFF_MS (2 s): lo que espera un apretón que no entra. */
  readonly connectErrorBackoffMs?: number;
  /** El slot de cada proyecto para postgres_changes (sin esto, su error). */
  readonly changeSource?: ChangeSourceFactory;
  /** Su `poll_interval_ms` (100). */
  readonly pollIntervalMs?: number;
  /** Su Janitor (las particiones viejas de `realtime.messages`); `false`, sin él. */
  readonly janitor?: JanitorOptions | false;
}

const WEBSOCKET_PATH = "/realtime/v1/websocket";
/** Lo que aceptamos en un mensaje del socket (el límite de carga es 3.000 KB). */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
/** Cada cuánto se comprueba que el otro lado sigue (un `ping` de WebSocket). */
const PING_EVERY_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Gate = { ok: true; project: RealtimeProject; token: string } | { ok: false; status: number; error: string };

function writeHttpError(socket: Duplex, status: number, error: string): void {
  const body = JSON.stringify({ error });
  socket.end(
    `HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? "Error"}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}

export function createRealtimeServer(o: RealtimeServerOptions): { server: http.Server; close(): Promise<void> } {
  const limits: RealtimeLimits = { ...realtimeLimits(), ...o.limits };
  const channelErrorBackoffMs = o.channelErrorBackoffMs ?? 5000;
  const connectErrorBackoffMs = o.connectErrorBackoffMs ?? 2000;
  const janitor = o.janitor === false ? null : new MessagesJanitor(o.janitor);
  janitor?.start();

  const topics = new Map<string, Set<Channel>>();
  const windows = new Map<string, { second: number; count: number }>();
  const sessionsByProject = new Map<string, Set<Session>>();
  const hub: Hub = {
    hit(ref, kind, n = 1) {
      const key = `${ref}:${kind}`;
      const second = Math.floor(Date.now() / 1000);
      const w = windows.get(key);
      if (!w || w.second !== second) {
        windows.set(key, { second, count: n });
        return n;
      }
      w.count += n;
      return w.count;
    },
    add(ch) {
      let set = topics.get(ch.key);
      if (!set) topics.set(ch.key, (set = new Set()));
      set.add(ch);
    },
    remove(ch) {
      const set = topics.get(ch.key);
      if (!set) return;
      set.delete(ch);
      if (set.size === 0) topics.delete(ch.key);
    },
    members(key) {
      return [...(topics.get(key) ?? [])];
    },
    presence: new PresenceRegistry<Channel>(),
    changes: new PostgresChangesHub({
      changeSource: o.changeSource,
      timing: { ...DEFAULT_POLLER_TIMING, ...(o.pollIntervalMs ? { pollIntervalMs: o.pollIntervalMs } : {}) },
    }),
  };
  const sessions = new Set<Session>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });

  /** Su `connect`: el proyecto por el Host, y el `apikey` (o `x-api-key`). */
  async function gate(req: http.IncomingMessage, url: URL): Promise<Gate> {
    const fail = async (status: number, error: string): Promise<Gate> => {
      await sleep(connectErrorBackoffMs);
      return { ok: false, status, error };
    };
    const project = await o.resolveProject(req.headers.host ?? "", typeof req.headers.origin === "string" ? req.headers.origin : null);
    if (!project) return fail(404, "Tenant not found");
    const header = req.headers["x-api-key"];
    const token = (typeof header === "string" ? header : null) ?? url.searchParams.get("apikey");
    const auth = await authorizeSocket(token, project);
    if (!auth.ok) return fail(auth.status, auth.error);
    // Su `TenantRateLimiters.check_tenant`: sockets a la vez por proyecto.
    if ((sessionsByProject.get(project.ref)?.size ?? 0) >= limits.maxConcurrentUsers) return fail(429, "Too many connected users");
    return { ok: true, project, token: token! };
  }

  /** Su `:open_cors`: la página llama desde otro origen. */
  function cors(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");
    res.setHeader("vary", "Origin");
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://realtime");
      if (isBroadcastApi(url.pathname)) {
        cors(req, res);
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "authorization, apikey, content-type, x-client-info",
            "access-control-max-age": "86400",
          });
          res.end();
          return;
        }
        const project = await o.resolveProject(req.headers.host ?? "", typeof req.headers.origin === "string" ? req.headers.origin : null);
        if (!project) {
          res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ message: "Tenant not found" }));
          return;
        }
        return handleBroadcastApi(req, res, url, project, hub, limits);
      }
      if (url.pathname === WEBSOCKET_PATH) {
        // La misma puerta que el apretón, contestada como HTTP.
        const g = await gate(req, url);
        const [status, body] = g.ok ? [400, { error: "Upgrade required" }] : [g.status, { error: g.error }];
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "Not Found" }));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "Error connecting to Realtime" }));
    });
  });

  server.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://realtime");
      if (url.pathname !== WEBSOCKET_PATH) return writeHttpError(socket, 404, "Not Found");
      const vsn = url.searchParams.get("vsn");
      if (vsn !== null && vsn !== "2.0.0") return writeHttpError(socket, 400, `Unsupported serializer version: ${vsn}`);
      const g = await gate(req, url);
      if (!g.ok) return writeHttpError(socket, g.status, g.error);
      wss.handleUpgrade(req, socket, head, (ws) => {
        const session = new Session(ws, g.project, g.token, hub, { channelErrorBackoffMs, limits });
        sessions.add(session);
        let mine = sessionsByProject.get(g.project.ref);
        if (!mine) sessionsByProject.set(g.project.ref, (mine = new Set()));
        mine.add(session);
        let alive = true;
        const ping = setInterval(() => {
          if (!alive) return ws.terminate();
          alive = false;
          ws.ping();
        }, PING_EVERY_MS);
        ping.unref?.();
        ws.on("pong", () => {
          alive = true;
        });
        ws.on("message", (data, isBinary) => {
          alive = true;
          session.onMessage(data, isBinary).catch((err: unknown) => {
            console.error("[realtime] mensaje", g.project.ref, err);
          });
        });
        ws.on("close", () => {
          clearInterval(ping);
          sessions.delete(session);
          mine.delete(session);
          if (mine.size === 0 && sessionsByProject.get(g.project.ref) === mine) sessionsByProject.delete(g.project.ref);
          session.closedByPeer();
        });
        ws.on("error", () => {});
      });
    })().catch(() => writeHttpError(socket, 500, "Error connecting to Realtime"));
  });

  return {
    server,
    async close() {
      for (const s of sessions) s.close(1001, "Server requested disconnect");
      await janitor?.stop();
      await hub.changes.closeAll();
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
