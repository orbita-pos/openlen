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

import { randomUUID } from "node:crypto";

import type { WebSocket } from "ws";

import type { ProjectDatabase } from "../db";
import { confirmToken, type Confirmed, type RealtimeKeys } from "./auth";
import { emptyPolicies, ensureMessagePartitions, readAuthorizations, writeAuthorization, type Policies } from "./authorization";
import { payloadTooLarge, type RealtimeLimits } from "./limits";
import type { PostgresChangesHub } from "./changes";
import type { PresenceDiff, PresenceRegistry } from "./presence";
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
  readonly presence: PresenceRegistry<Channel>;
  readonly changes: PostgresChangesHub;
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
  /** Su `presence_key`: la del join, o un uuid. */
  readonly presenceKey: string;
  /** Su `presence_enabled?`: lo pidió al unirse, o hizo un `track`. */
  presenceEnabled: boolean;
  /** Su `presence_client_rate_limit`. */
  presenceWindow: { counter: number; resetAt: number | null } = { counter: 0, resetAt: null };
  /** El id de cada filtro de postgres_changes (el que conoce el cliente). */
  readonly postgresChangesIds = new Map<PostgresChangesParams, number>();
  /** id del filtro → uuid de su fila en `realtime.subscription` (changes.ts). */
  readonly subscriptionUuids = new Map<number, string>();
  /** Las de un canal privado (authorization.ts); null en uno público. */
  policies: Policies | null = null;
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
    this.presenceKey = config.presenceKey || randomUUID();
    this.presenceEnabled = config.presenceEnabled;
    for (const p of config.postgresChanges) this.postgresChangesIds.set(p, postgresChangesId(p));
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
  /** Lo de un mismo tema, en orden (el proceso de un canal en Phoenix). */
  private readonly chains = new Map<string, Promise<void>>();

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
    // En orden por tema: un join con su espera no frena el latido ni otros
    // canales, y dos broadcasts del mismo canal no se adelantan.
    const decoded = frame;
    const prev = this.chains.get(decoded.topic) ?? Promise.resolve();
    const next = prev.then(() => this.handle(decoded)).catch((err: unknown) => console.error("[realtime] mensaje", this.project.ref, err));
    this.chains.set(decoded.topic, next);
    void next.finally(() => {
      if (this.chains.get(decoded.topic) === next) this.chains.delete(decoded.topic);
    });
    await next;
  }

  private async handle(frame: PhxMessage | UserBroadcastPush): Promise<void> {
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
      case "presence":
        return this.presence(ch, m);
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

    // Su `maybe_assign_policies`: un canal privado entra si RLS le deja leer
    // broadcast (o presence, si lo activa).
    let policies: Policies | null = null;
    if (config.private) {
      const db = this.project.db;
      if (!db) return fail("UnableToConnectToProject: Realtime was unable to connect to the project database");
      const denied = `Unauthorized: You do not have permissions to read from this Channel topic: ${sub}`;
      try {
        await ensureMessagePartitions(db, this.project.ref);
        policies = await readAuthorizations(db, { topic: sub, claims: c.claims }, emptyPolicies(), { presenceEnabled: config.presenceEnabled });
      } catch (err) {
        console.error("[realtime] políticas", this.project.ref, err);
        // Su `:rls_policy_error` (un error de Postgres) es «no»; lo demás, no llegar a la base.
        const sqlstate = typeof (err as { code?: unknown }).code === "string";
        return fail(sqlstate ? denied : "UnableToConnectToProject: Realtime was unable to connect to the project database");
      }
      if (this.closed) return;
      if (!policies.broadcast.read && !policies.presence.read) return fail(denied);
    }

    const ch = new Channel(this, m.topic, sub, m.joinRef, config, c, token);
    ch.policies = policies;
    this.channels.set(m.topic, ch);
    this.hub.add(ch);
    // Su `state`: los filtros de postgres_changes con su id.
    this.reply(m, "ok", { postgres_changes: config.postgresChanges.map((p) => ({ ...p, id: ch.postgresChangesIds.get(p)! })) });
    // Su `:sync_presence` tras unirse, si lo pidió (y, si es privado, si puede leerla).
    if (ch.presenceEnabled && this.canReadPresence(ch)) this.push(ch.topic, "presence_state", this.hub.presence.state(ch.key), ch.joinRef);
    // Su `start_postgres_subscribe`: después de contestar al join.
    if (config.postgresChanges.length > 0) void this.hub.changes.subscribe(ch);
  }

  /** Su `push_system_message`. */
  pushSystem(ch: Channel, extension: string, status: "ok" | "error", message: string): void {
    this.push(ch.topic, "system", { extension, status, message, channel: ch.sub }, ch.joinRef);
  }

  private removeChannel(ch: Channel): void {
    if (this.channels.get(ch.topic) !== ch) return;
    this.channels.delete(ch.topic);
    this.hub.remove(ch);
    ch.dispose();
    // Phoenix.Presence lo saca al morir el proceso del canal.
    const diff = this.hub.presence.untrack(ch.key, ch);
    if (diff) this.presenceDiff(ch, diff);
    // Y sus suscripciones de postgres_changes (su `terminate`).
    void this.hub.changes.unsubscribe(ch);
  }

  /** Su `can_read_presence?`: en un canal público, siempre. */
  private canReadPresence(ch: Channel): boolean {
    return !ch.policies || ch.policies.presence.read === true;
  }

  /** El diff a todos los del tema que pueden leerla (en un canal público,
   *  todos: su MessageDispatcher con `presence_read? = true`). */
  private presenceDiff(ch: Channel, diff: PresenceDiff): void {
    const frame = encodeText({ joinRef: null, ref: null, topic: ch.topic, event: "presence_diff", payload: diff });
    for (const member of this.hub.members(ch.key)) if (member.session.canReadPresence(member)) member.session.sendText(frame);
  }

  /** Su `PresenceHandler.handle`: `track` y `untrack`, con su límite por cliente. */
  private async presence(ch: Channel, m: PhxMessage): Promise<void> {
    const p = isObject(m.payload) ? m.payload : {};
    if (typeof p.event !== "string") return this.reply(m, "ok", {});
    // Su `limit_client_presence_event`: N llamadas por ventana.
    const now = Date.now();
    const w = ch.presenceWindow;
    if (w.resetAt === null || now > w.resetAt) {
      w.counter = 1;
      w.resetAt = now + this.o.limits.clientPresenceWindowMs;
    } else if (w.counter >= this.o.limits.clientPresenceMaxCalls) {
      return this.shutdown(ch, "Client presence rate limit exceeded");
    } else {
      w.counter++;
    }
    const event = p.event.toLowerCase();
    if (event === "untrack") {
      const diff = this.hub.presence.untrack(ch.key, ch);
      if (diff) this.presenceDiff(ch, diff);
      return this.reply(m, "ok", {});
    }
    if (event !== "track") return this.reply(m, "error", {});
    // Un canal privado escribe presence si RLS le deja (su `authorize`, la
    // primera vez; antes, la lectura si no se miró al unirse).
    if (ch.policies && this.project.db) {
      if (ch.policies.presence.write === null) {
        const ctx = { topic: ch.sub, claims: ch.claims };
        try {
          if (ch.policies.presence.read === null) ch.policies = await readAuthorizations(this.project.db, ctx, ch.policies, { presenceEnabled: true });
          ch.policies = await writeAuthorization(this.project.db, ctx, ch.policies, "presence");
        } catch (err) {
          console.error("[realtime] políticas de presence", this.project.ref, err);
          return this.reply(m, "error", {});
        }
      }
      if (ch.policies.presence.write !== true) return this.reply(m, "error", {});
    }
    const payload = "payload" in p ? p.payload : {};
    if (!isObject(payload)) return this.reply(m, "error", { reason: "Presence track payload must be a map" });
    if (payloadTooLarge(Buffer.byteLength(JSON.stringify(payload)), this.o.limits)) return this.shutdown(ch, "Track message size exceeded");
    // Su `:no_payload_change`: la misma carga no hace nada.
    const before = this.hub.presence.payloadOf(ch.key, ch);
    if (before && JSON.stringify(before) === JSON.stringify(payload)) return this.reply(m, "ok", {});
    const diff = this.hub.presence.track(ch.key, ch, ch.presenceKey, payload);
    this.reply(m, "ok", {});
    this.presenceDiff(ch, diff);
    // Un `track` con presence apagado lo enciende y le manda el estado (`:resync`).
    if (!ch.presenceEnabled) {
      ch.presenceEnabled = true;
      if (this.canReadPresence(ch)) this.push(ch.topic, "presence_state", this.hub.presence.state(ch.key), ch.joinRef);
    }
  }

  /** Su `handle_in("access_token", …)`. */
  private async refreshToken(ch: Channel, m: PhxMessage): Promise<void> {
    const t = isObject(m.payload) ? m.payload.access_token : undefined;
    if (typeof t !== "string" || t.startsWith("sb_") || t === ch.accessToken) return;
    const c = await confirmToken(t, this.project);
    if (!this.channels.has(ch.topic)) return;
    if (!c.ok) return this.shutdown(ch, c.reason === "missing_claims" ? "Fields `role` and `exp` are required in JWT" : c.message);
    // Su `apply_access_token` en un canal privado: las políticas, otra vez con
    // los claims nuevos (las de escribir, a calcular de nuevo).
    if (ch.policies && this.project.db) {
      const previous = ch.policies;
      const denied = `You do not have permissions to read from this Channel topic: ${ch.sub}`;
      let next: Policies;
      try {
        next = await readAuthorizations(this.project.db, { topic: ch.sub, claims: c.claims }, emptyPolicies(), { presenceEnabled: ch.presenceEnabled });
      } catch (err) {
        console.error("[realtime] políticas", this.project.ref, err);
        return this.shutdown(ch, denied);
      }
      if (!this.channels.has(ch.topic)) return;
      if (!next.broadcast.read && !next.presence.read) return this.shutdown(ch, denied);
      // Su `check_read_permissions_revoked`.
      if ((previous.broadcast.read === true && next.broadcast.read === false) || (previous.presence.read === true && next.presence.read === false)) {
        return this.shutdown(ch, `You no longer have permission to read from this Channel topic: ${ch.sub}`);
      }
      ch.policies = next;
    }
    ch.accessToken = t;
    ch.claims = c.claims;
    ch.scheduleTokenCheck(c.msUntilRecheck);
    // Su `apply_access_token`: las suscripciones con los claims nuevos (la
    // misma fila: `on conflict … do update set claims`).
    if (ch.config.postgresChanges.length > 0) void this.hub.changes.subscribe(ch);
  }

  /** Su BroadcastHandler para un canal público: el mensaje tal cual a los del
   *  tema (sin el emisor si no pidió `self`), con su respuesta si pidió `ack`. */
  private fanOut(ch: Channel, frame: { text: string } | { binary: Uint8Array }): void {
    for (const member of this.hub.members(ch.key)) {
      if (member === ch && !ch.config.broadcastSelf) continue;
      // Su MessageDispatcher: en un privado, sólo quien puede leer broadcast.
      if (member.policies && member.policies.broadcast.read !== true) continue;
      if ("text" in frame) member.session.sendText(frame.text);
      else member.session.sendBinary(frame.binary);
    }
  }

  /** Su BroadcastHandler para un canal privado: escribe si RLS le deja (la
   *  primera vez se mira; luego, guardado hasta un token nuevo). Si no, nada
   *  —ni la respuesta del `ack`, como el suyo (`{:noreply}`)—. */
  private async canBroadcast(ch: Channel): Promise<boolean> {
    if (!ch.policies) return true;
    if (ch.policies.broadcast.write === null && this.project.db) {
      try {
        ch.policies = await writeAuthorization(this.project.db, { topic: ch.sub, claims: ch.claims }, ch.policies, "broadcast");
      } catch (err) {
        console.error("[realtime] políticas de broadcast", this.project.ref, err);
        return false;
      }
    }
    return ch.policies.broadcast.write === true;
  }

  private async textBroadcast(ch: Channel, m: PhxMessage): Promise<void> {
    if (!(await this.canBroadcast(ch))) return;
    const size = Buffer.byteLength(JSON.stringify(m.payload ?? null));
    if (payloadTooLarge(size, this.o.limits)) {
      if (ch.config.broadcastAck) this.reply(m, "error", "payload_size_exceeded");
      return;
    }
    this.fanOut(ch, { text: encodeText({ joinRef: null, ref: null, topic: ch.topic, event: "broadcast", payload: m.payload }) });
    if (ch.config.broadcastAck) this.reply(m, "ok", {});
  }

  private async userBroadcast(b: UserBroadcastPush): Promise<void> {
    const ch = this.channels.get(b.topic);
    if (!ch) return this.reply(b, "error", { reason: "unmatched topic" });
    if (!(await this.canBroadcast(ch))) return;
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
