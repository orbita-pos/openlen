// El broadcast por HTTP de Supabase Realtime (supabase/realtime @ f86df8c3,
// Apache-2.0: router.ex, BroadcastController / BroadcastSingleController,
// Tenants.BatchBroadcast, AuthTenant y sus vistas de error):
//
//   POST /realtime/v1/api/broadcast                      {messages: [{topic, event, payload, private?, id?}]}
//   POST /realtime/v1/api/broadcast/:topic/events/:event  el cuerpo es la carga (JSON o bytes), ?private=true
//
// Lo usa `realtime-js` en `send()` de un canal sin unirse y en `httpSend()`.
// 202 sin cuerpo; 401 {message: "Unauthorized"}; 422 {errors: …}.

import type http from "node:http";

import { authorizeSocket } from "./auth";
import { writeAuthorization, emptyPolicies, ensureMessagePartitions } from "./authorization";
import type { Hub, RealtimeProject } from "./channel";
import { payloadTooLarge, type RealtimeLimits } from "./limits";
import { encodeText, encodeUserBroadcast } from "./serializer";

const BATCH = /^\/realtime\/v1\/api\/broadcast\/?$/;
const SINGLE = /^\/realtime\/v1\/api\/broadcast\/([^/]+)\/events\/([^/]+)\/?$/;

export function isBroadcastApi(pathname: string): boolean {
  return BATCH.test(pathname) || SINGLE.test(pathname);
}

const MAX_BODY = 8 * 1024 * 1024;

async function readBody(req: http.IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > MAX_BODY) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function send(res: http.ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

interface Message {
  readonly topic: string;
  readonly event: string;
  readonly private: boolean;
  /** JSON (texto del canal) o bytes (un `httpSend` binario). */
  readonly payload: { json: unknown } | { bytes: Uint8Array };
  readonly id?: string;
}

/** Su `message_changeset`: los obligatorios y el tamaño, con sus textos. */
function validate(raw: unknown, limits: RealtimeLimits): { message?: Message; errors: Record<string, string[]> } {
  const m = isObject(raw) ? raw : {};
  const errors: Record<string, string[]> = {};
  for (const f of ["topic", "payload", "event"] as const) {
    if (m[f] === undefined || m[f] === null || m[f] === "") errors[f] = ["can't be blank"];
  }
  if (!errors.payload && payloadTooLarge(Buffer.byteLength(JSON.stringify(m.payload)), limits)) errors.payload = ["Payload size exceeds tenant limit"];
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    message: {
      topic: String(m.topic),
      event: String(m.event),
      private: m.private === true,
      payload: { json: m.payload },
      ...(typeof m.id === "string" ? { id: m.id } : {}),
    },
  };
}

/** Su `send_message_and_count`: al tema (público o privado) del proyecto. */
function deliver(hub: Hub, project: RealtimeProject, m: Message): void {
  const key = `${project.ref}:${m.private ? "private" : "public"}:${m.topic}`;
  const topic = `realtime:${m.topic}`;
  let frame: { text: string } | { binary: Uint8Array };
  if ("bytes" in m.payload) {
    frame = { binary: encodeUserBroadcast({ topic, event: m.event, payload: m.payload.bytes, json: false }) };
  } else {
    const payload: Record<string, unknown> = { payload: m.payload.json, event: m.event, type: "broadcast", ...(m.id ? { meta: { id: m.id } } : {}) };
    frame = { text: encodeText({ joinRef: null, ref: null, topic, event: "broadcast", payload }) };
  }
  for (const member of hub.members(key)) {
    if (member.policies && member.policies.broadcast.read !== true) continue;
    if ("text" in frame) member.session.sendText(frame.text);
    else member.session.sendBinary(frame.binary);
  }
}

export async function handleBroadcastApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  project: RealtimeProject,
  hub: Hub,
  limits: RealtimeLimits,
): Promise<void> {
  if (req.method !== "POST") return send(res, 404, { message: "not found" });
  // Su AuthTenant: el `Authorization: Bearer` o la `apikey`.
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
  const apikey = typeof req.headers.apikey === "string" ? req.headers.apikey : null;
  const auth = await authorizeSocket(bearer ?? apikey, project);
  if (!auth.ok) return send(res, 401, { message: "Unauthorized" });

  const body = await readBody(req);
  if (body === null) return send(res, 413, { message: "Payload Too Large" });

  let messages: Message[];
  const single = SINGLE.exec(url.pathname);
  if (single) {
    const topic = decodeURIComponent(single[1]!);
    const event = decodeURIComponent(single[2]!);
    const isPrivate = url.searchParams.get("private") === "true";
    const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type === "application/octet-stream") {
      if (payloadTooLarge(body.length, limits)) return send(res, 422, { errors: { payload: ["Payload size exceeds tenant limit"] } });
      messages = [{ topic, event, private: isPrivate, payload: { bytes: new Uint8Array(body) } }];
    } else if (type === "application/json") {
      let payload: unknown;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        return send(res, 400, { message: "Invalid JSON" });
      }
      const v = validate({ topic, event, payload, private: isPrivate }, limits);
      if (!v.message) return send(res, 422, { errors: v.errors });
      messages = [v.message];
    } else {
      return send(res, 415, { message: "Unsupported content type" });
    }
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8") || "{}");
    } catch {
      return send(res, 400, { message: "Invalid JSON" });
    }
    const raw = isObject(parsed) && Array.isArray(parsed.messages) ? parsed.messages : null;
    if (!raw) return send(res, 422, { errors: { messages: ["can't be blank"] } });
    const checked = raw.map((m) => validate(m, limits));
    if (checked.some((c) => !c.message)) return send(res, 422, { errors: { messages: checked.map((c) => c.errors) } });
    messages = checked.map((c) => c.message!);
  }

  // Su `check_rate_limit`: los mensajes cuentan como eventos del proyecto.
  if (hub.hit(project.ref, "events", messages.length) > limits.maxEventsPerSecond) {
    return send(res, 429, { message: "Too many messages per second" });
  }

  for (const m of messages.filter((x) => !x.private)) deliver(hub, project, m);
  // Los privados, por tema, si RLS deja escribir (su `permissions_for_message`).
  const privateByTopic = new Map<string, Message[]>();
  for (const m of messages.filter((x) => x.private)) privateByTopic.set(m.topic, [...(privateByTopic.get(m.topic) ?? []), m]);
  if (privateByTopic.size > 0 && project.db) {
    await ensureMessagePartitions(project.db, project.ref);
    for (const [topic, list] of privateByTopic) {
      const p = await writeAuthorization(project.db, { topic, claims: auth.claims }, emptyPolicies(), "broadcast").catch(() => null);
      if (p?.broadcast.write === true) for (const m of list) deliver(hub, project, m);
    }
  }
  send(res, 202);
}
