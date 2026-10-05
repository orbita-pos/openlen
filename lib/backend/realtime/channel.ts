// Un socket de Realtime y sus canales, como `RealtimeWeb.RealtimeChannel` de
// Supabase Realtime (supabase/realtime @ f86df8c3, Apache-2.0:
// lib/realtime_web/channels/realtime_channel.ex, realtime_channel/
// broadcast_handler.ex, logging.ex) sobre el protocolo de canales de Phoenix.
// Sus textos y sus cierres, copiados.
//
// Un proceso, un nodo: lo que en Supabase reparte Phoenix.PubSub entre nodos,
// aquí es un mapa de temas en memoria (server.ts). El tema interno lleva el
// `ref` del proyecto y si es privado (su `tenant_topic`): dos proyectos con el
// mismo nombre de canal no se oyen.

import type { WebSocket } from "ws";

import type { ProjectDatabase } from "../db";
import { confirmToken, type Confirmed, type RealtimeKeys } from "./auth";
import { payloadTooLarge, type RealtimeLimits } from "./limits";
import { decodeFrame, encodeText, encodeUserBroadcast, InvalidMessageError, type PhxMessage, type UserBroadcastPush } from "./serializer";

/** Un proyecto, tal como lo ve el servidor de Realtime. */
export interface RealtimeProject extends RealtimeKeys {
  readonly ref: string;
  /** La base del proyecto por el pool de `authenticator` (postgres_changes y
   *  canales privados). */
  readonly db?: ProjectDatabase;
}

/** Los temas de todos los sockets (server.ts). */
export interface Hub {
  add(ch: Channel): void;
  remove(ch: Channel): void;
  members(key: string): Iterable<Channel>;
}

export interface SessionOptions {
  /** Su CHANNEL_ERROR_BACKOFF_MS (5 s): lo que espera un join que no entra. */
  readonly channelErrorBackoffMs: number;
  readonly limits: RealtimeLimits;
}

/** Un filtro de `postgres_changes` como lo manda el cliente. */
export type PostgresChangesParams = Record<string, unknown>;

export interface ChannelConfig {
  readonly broadcastSelf: boolean;
  readonly broadcastAck: boolean;
  readonly presenceKey: string;
  readonly presenceEnabled: boolean;
  readonly private: boolean;
  readonly postgresChanges: readonly PostgresChangesParams[];
}

const TOPIC_PREFIX = "realtime:";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Su `Join` (payloads/join.ex): la configuración del canal, con sus valores
 *  por defecto. */
function parseConfig(params: Record<string, unknown>): ChannelConfig {
  const config = isObject(params.config) ? params.config : {};
  const broadcast = isObject(config.broadcast) ? config.broadcast : {};
  const presence = isObject(config.presence) ? config.presence : {};
  const changes = Array.isArray(config.postgres_changes) ? config.postgres_changes.filter(isObject) : [];
  return {
    broadcastSelf: broadcast.self === true,
    broadcastAck: broadcast.ack === true,
    presenceKey: typeof presence.key === "string" ? presence.key : "",
    presenceEnabled: presence.enabled === true,
    private: config.private === true,
    postgresChanges: changes,
  };
}

/** Un id estable por filtro (su `:erlang.phash2(params)`): el cliente casa los
 *  cambios que le llegan por este número. FNV-1a de 32 bits del JSON con las
 *  claves ordenadas. */
export function postgresChangesId(params: PostgresChangesParams): number {
  const canon = JSON.stringify(params, Object.keys(params).sort());
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export class Channel {
  claims: Record<string, unknown>;
  accessToken: string;
  private tokenTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly session: Session,
    /** `realtime:<sub>`, el tema del cliente. */
    readonly topic: string,
    readonly sub: string,
    readonly joinRef: string | null,
    readonly config: ChannelConfig,
    confirmed: Extract<Confirmed, { ok: true }>,
    accessToken: string,
  ) {
    this.claims = confirmed.claims;
    this.accessToken = accessToken;
    this.scheduleTokenCheck(confirmed.msUntilRecheck);
  }

  /** Su `tenant_topic`: el proyecto, si es público y el nombre. */
  get key(): string {
    return `${this.session.project.ref}:${this.config.private ? "private" : "public"}:${this.sub}`;
  }

  /** Su `confirm_token` periódico: al vencer el JWT, el canal se cierra. */
  scheduleTokenCheck(ms: number | null): void {
    if (this.tokenTimer) clearTimeout(this.tokenTimer);
    this.tokenTimer = null;
    if (ms === null) return;
    this.tokenTimer = setTimeout(() => void this.recheckToken(), ms);
    this.tokenTimer.unref?.();
  }

  private async recheckToken(): Promise<void> {
    const c = await confirmToken(this.accessToken, this.session.project);
    if (!this.session.channels.has(this.topic)) return;
    if (!c.ok) return this.session.shutdown(this, c.reason === "missing_claims" ? "Fields `role` and `exp` are required in JWT" : c.message);
    this.claims = c.claims;
    this.scheduleTokenCheck(c.msUntilRecheck);
  }

  dispose(): void {
    if (this.tokenTimer) clearTimeout(this.tokenTimer);
    this.tokenTimer = null;
  }
}

/** Lo que dice un join cuyo token no vale (su `join` y su `log_error`: `código: mensaje`). */
function joinTokenError(c: Extract<Confirmed, { ok: false }>): string {
  switch (c.reason) {
    case "expired_token":
      return `InvalidJWTToken: ${c.message}`;
    case "missing_claims":
      return "InvalidJWTToken: Fields `role` and `exp` are required in JWT";
    case "signature_error":
      return "JwtSignatureError: Failed to validate JWT signature";
    default:
      return "MalformedJWT: The token provided is not a valid JWT";
  }
}

function toBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}

export class Session {
  readonly channels = new Map<string, Channel>();
  private closed = false;

  constructor(
    private readonly ws: WebSocket,
    readonly project: RealtimeProject,
    /** El `apikey` con el que entró (su `tenant_token`). */
    readonly socketToken: string,
    private readonly hub: Hub,
    private readonly o: SessionOptions,
  ) {}

  /** Un mensaje del socket. Uno roto cierra ESTE socket (Phoenix lo hace al
   *  no poder decodificarlo), no el servicio. */
  async onMessage(data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): Promise<void> {
    let frame: PhxMessage | UserBroadcastPush;
    try {
      const bytes = toBytes(data);
      frame = decodeFrame(isBinary ? bytes : Buffer.from(bytes).toString("utf8"));
    } catch (err) {
      if (err instanceof InvalidMessageError || err instanceof SyntaxError) {
        this.ws.close(1007, "invalid message");
        return;
      }
      throw err;
    }
    if ("kind" in frame) return this.userBroadcast(frame);
    const m = frame;
    if (m.topic === "phoenix" && m.event === "heartbeat") return this.reply(m, "ok", {});
    if (m.event === "phx_join") return this.join(m);
    const ch = this.channels.get(m.topic);
    if (!ch) return this.reply(m, "error", { reason: "unmatched topic" });
    switch (m.event) {
      case "phx_leave":
        this.removeChannel(ch);
        return this.reply(m, "ok", {});
      case "broadcast":
        return this.textBroadcast(ch, m);
      case "access_token":
        return this.refreshToken(ch, m);
      default:
        // Su `handle_in` de lo desconocido: se ignora (lo apunta en el registro).
        return;
    }
  }

  sendText(frame: string): void {
    if (!this.closed && this.ws.readyState === 1) this.ws.send(frame);
  }

  sendBinary(frame: Uint8Array): void {
    if (!this.closed && this.ws.readyState === 1) this.ws.send(frame, { binary: true });
  }

  push(topic: string, event: string, payload: unknown, joinRef: string | null = null): void {
    this.sendText(encodeText({ joinRef, ref: null, topic, event, payload }));
  }

  private reply(m: { joinRef: string | null; ref: string | null; topic: string }, status: "ok" | "error", response: unknown): void {
    this.sendText(encodeText({ joinRef: m.joinRef, ref: m.ref, topic: m.topic, event: "phx_reply", payload: { status, response } }));
  }

  /** Su `shutdown_response`: el `system` con el error y el canal cerrado. */
  shutdown(ch: Channel, message: string): void {
    this.push(ch.topic, "system", { extension: "system", status: "error", message, channel: ch.sub }, ch.joinRef);
    this.push(ch.topic, "phx_close", {}, ch.joinRef);
    this.removeChannel(ch);
  }

  private async join(m: PhxMessage): Promise<void> {
    if (!m.topic.startsWith(TOPIC_PREFIX)) return this.reply(m, "error", { reason: "unmatched topic" });
    const sub = m.topic.slice(TOPIC_PREFIX.length);
    const params = isObject(m.payload) ? m.payload : {};
    const fail = async (reason: string) => {
      // Su `join_error`: espera antes de contestar (un cliente que reintenta en
      // bucle no satura el servidor).
      await sleep(this.o.channelErrorBackoffMs);
      this.reply(m, "error", { reason });
    };
    if (!sub) return fail("TopicNameRequired: You must provide a topic name");

    // Un join repetido del mismo tema reemplaza al anterior (Phoenix).
    const previous = this.channels.get(m.topic);
    if (previous) this.removeChannel(previous);

    // Su `assign_access_token`: un `sb_…` en el join no cuenta, manda el del socket.
    const asked = typeof params.access_token === "string" ? params.access_token : typeof params.user_token === "string" ? params.user_token : null;
    const token = asked && !asked.startsWith("sb_") ? asked : this.socketToken;
    const c = await confirmToken(token, this.project);
    if (this.closed) return;
    if (!c.ok) return fail(joinTokenError(c));

    const config = parseConfig(params);
    const ch = new Channel(this, m.topic, sub, m.joinRef, config, c, token);
    this.channels.set(m.topic, ch);
    this.hub.add(ch);
    // Su `state`: los filtros de postgres_changes con su id.
    this.reply(m, "ok", { postgres_changes: config.postgresChanges.map((p) => ({ ...p, id: postgresChangesId(p) })) });
  }

  private removeChannel(ch: Channel): void {
    if (this.channels.get(ch.topic) !== ch) return;
    this.channels.delete(ch.topic);
    this.hub.remove(ch);
    ch.dispose();
  }

  /** Su `handle_in("access_token", …)`. */
  private async refreshToken(ch: Channel, m: PhxMessage): Promise<void> {
    const t = isObject(m.payload) ? m.payload.access_token : undefined;
    if (typeof t !== "string" || t.startsWith("sb_") || t === ch.accessToken) return;
    const c = await confirmToken(t, this.project);
    if (!this.channels.has(ch.topic)) return;
    if (!c.ok) return this.shutdown(ch, c.reason === "missing_claims" ? "Fields `role` and `exp` are required in JWT" : c.message);
    ch.accessToken = t;
    ch.claims = c.claims;
    ch.scheduleTokenCheck(c.msUntilRecheck);
  }

  /** Su BroadcastHandler para un canal público: el mensaje tal cual a los del
   *  tema (sin el emisor si no pidió `self`), con su respuesta si pidió `ack`. */
  private fanOut(ch: Channel, frame: { text: string } | { binary: Uint8Array }): void {
    for (const member of this.hub.members(ch.key)) {
      if (member === ch && !ch.config.broadcastSelf) continue;
      if ("text" in frame) member.session.sendText(frame.text);
      else member.session.sendBinary(frame.binary);
    }
  }

  private textBroadcast(ch: Channel, m: PhxMessage): void {
    const size = Buffer.byteLength(JSON.stringify(m.payload ?? null));
    if (payloadTooLarge(size, this.o.limits)) {
      if (ch.config.broadcastAck) this.reply(m, "error", "payload_size_exceeded");
      return;
    }
    this.fanOut(ch, { text: encodeText({ joinRef: null, ref: null, topic: ch.topic, event: "broadcast", payload: m.payload }) });
    if (ch.config.broadcastAck) this.reply(m, "ok", {});
  }

  private userBroadcast(b: UserBroadcastPush): void {
    const ch = this.channels.get(b.topic);
    if (!ch) return this.reply(b, "error", { reason: "unmatched topic" });
    if (payloadTooLarge(b.payload.length, this.o.limits)) {
      if (ch.config.broadcastAck) this.reply(b, "error", "payload_size_exceeded");
      return;
    }
    this.fanOut(ch, { binary: encodeUserBroadcast({ topic: ch.topic, event: b.event, payload: b.payload, json: b.json }) });
    if (ch.config.broadcastAck) this.reply(b, "ok", {});
  }

  /** El socket se fue: sus canales salen de sus temas. */
  closedByPeer(): void {
    this.closed = true;
    for (const ch of [...this.channels.values()]) this.removeChannel(ch);
  }

  close(code: number, reason: string): void {
    this.ws.close(code, reason);
  }
}
