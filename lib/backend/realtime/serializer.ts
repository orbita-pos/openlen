// El serializador del socket de Supabase Realtime (supabase/realtime @ f86df8c3,
// Apache-2.0, lib/realtime_web/socket/v2_serializer.ex): el V2 de Phoenix
// (`[join_ref, ref, topic, event, payload]` en texto) más sus dos binarios de
// broadcast de usuario, el que manda el cliente (`user_broadcast_push`, 3) y el
// que reparte el servidor (`user_broadcast`, 4). Es lo que habla
// `realtime-js` 2.117.2 por defecto (`vsn=2.0.0`).

/** Un mensaje de Phoenix. */
export interface PhxMessage {
  readonly joinRef: string | null;
  readonly ref: string | null;
  readonly topic: string;
  readonly event: string;
  readonly payload: unknown;
}

/** Un broadcast de usuario tal como llega del cliente (binario, tipo 3). */
export interface UserBroadcastPush {
  readonly kind: "user_broadcast_push";
  readonly joinRef: string | null;
  readonly ref: string | null;
  readonly topic: string;
  /** El `event` del usuario (`send({ event })`). */
  readonly event: string;
  /** La carga del usuario: el JSON en UTF-8 si `json`, si no los bytes tal cual. */
  readonly payload: Uint8Array;
  readonly json: boolean;
  readonly metadata: Record<string, unknown>;
}

const PUSH = 0;
const USER_BROADCAST_PUSH = 3;
const USER_BROADCAST = 4;

/** Su `Phoenix.Socket.InvalidMessageError`. */
export class InvalidMessageError extends Error {}

/** Lo que llega por el socket (texto o binario). Lanza InvalidMessageError. */
export function decodeFrame(data: string | Uint8Array): PhxMessage | UserBroadcastPush {
  if (typeof data === "string") return decodeText(data);
  return decodeBinary(data);
}

function decodeText(raw: string): PhxMessage {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new InvalidMessageError(`expected V2 array, got: ${raw.slice(0, 200)}`);
  }
  if (!Array.isArray(v) || v.length < 5) throw new InvalidMessageError(`expected V2 array, got: ${raw.slice(0, 200)}`);
  const [joinRef, ref, topic, event, payload] = v as [unknown, unknown, unknown, unknown, unknown];
  if (typeof topic !== "string" || typeof event !== "string") throw new InvalidMessageError(`expected V2 array, got: ${raw.slice(0, 200)}`);
  return { joinRef: refOrNull(joinRef), ref: refOrNull(ref), topic, event, payload };
}

function refOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function decodeBinary(b: Uint8Array): PhxMessage | UserBroadcastPush {
  const take = (start: number, len: number): Uint8Array => {
    if (start + len > b.length) throw new InvalidMessageError("binary frame too short");
    return b.subarray(start, start + len);
  };
  const text = (bytes: Uint8Array): string => {
    try {
      return utf8.decode(bytes);
    } catch {
      throw new InvalidMessageError("binary frame is not UTF-8");
    }
  };
  if (b.length < 1) throw new InvalidMessageError("empty binary frame");
  const kind = b[0];
  if (kind === USER_BROADCAST_PUSH) {
    if (b.length < 7) throw new InvalidMessageError("binary frame too short");
    const [joinRefSize, refSize, topicSize, eventSize, metadataSize, encoding] = [b[1]!, b[2]!, b[3]!, b[4]!, b[5]!, b[6]!];
    let o = 7;
    const joinRef = text(take(o, joinRefSize));
    o += joinRefSize;
    const ref = text(take(o, refSize));
    o += refSize;
    const topic = text(take(o, topicSize));
    o += topicSize;
    const event = text(take(o, eventSize));
    o += eventSize;
    const meta = metadataSize > 0 ? text(take(o, metadataSize)) : "";
    o += metadataSize;
    let metadata: Record<string, unknown> = {};
    if (meta) {
      try {
        metadata = JSON.parse(meta) as Record<string, unknown>;
      } catch {
        throw new InvalidMessageError("broadcast metadata is not JSON");
      }
    }
    return { kind: "user_broadcast_push", joinRef: joinRef || null, ref: ref || null, topic, event, payload: b.slice(o), json: encoding !== 0, metadata };
  }
  if (kind === PUSH) {
    // Su `@push` binario (`payload: {:binary, data}`): un evento con bytes.
    if (b.length < 5) throw new InvalidMessageError("binary frame too short");
    const [joinRefSize, refSize, topicSize, eventSize] = [b[1]!, b[2]!, b[3]!, b[4]!];
    let o = 5;
    const joinRef = text(take(o, joinRefSize));
    o += joinRefSize;
    const ref = text(take(o, refSize));
    o += refSize;
    const topic = text(take(o, topicSize));
    o += topicSize;
    const event = text(take(o, eventSize));
    o += eventSize;
    return { joinRef: joinRef || null, ref: ref || null, topic, event, payload: b.slice(o) };
  }
  throw new InvalidMessageError(`unknown binary frame kind ${String(kind)}`);
}

/** Un mensaje como texto V2 (su `encode!` de Message y Reply). */
export function encodeText(m: PhxMessage): string {
  return JSON.stringify([m.joinRef, m.ref, m.topic, m.event, m.payload]);
}

const enc = new TextEncoder();

/** Su `byte_size!`: cada trozo con su longitud en un byte. */
function sized(value: string, kind: string): Uint8Array {
  const bytes = enc.encode(value);
  if (bytes.length > 255) {
    throw new RangeError(`unable to convert ${kind} to binary.\n\nmust be less than or equal to 255 bytes, but is ${bytes.length} bytes.`);
  }
  return bytes;
}

/** El broadcast de usuario que reparte el servidor (tipo 4, su
 *  `fastlane!(%UserBroadcast{})`). */
export function encodeUserBroadcast(o: {
  readonly topic: string;
  readonly event: string;
  readonly payload: Uint8Array;
  readonly json: boolean;
  readonly metadata?: Record<string, unknown>;
}): Uint8Array {
  const topic = sized(o.topic, "topic");
  const event = sized(o.event, "user_event");
  const metadata = o.metadata ? sized(JSON.stringify(o.metadata), "metadata") : new Uint8Array();
  const out = new Uint8Array(5 + topic.length + event.length + metadata.length + o.payload.length);
  out.set([USER_BROADCAST, topic.length, event.length, metadata.length, o.json ? 1 : 0], 0);
  let p = 5;
  out.set(topic, p);
  p += topic.length;
  out.set(event, p);
  p += event.length;
  out.set(metadata, p);
  p += metadata.length;
  out.set(o.payload, p);
  return out;
}
