// @vitest-environment node
//
// El serializador V2 de Phoenix con los binarios de broadcast de Supabase
// Realtime, contra el `Serializer` REAL de @supabase/realtime-js 2.117.2: lo que
// él codifica lo leemos igual, y lo que codificamos él lo lee igual.
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { decodeFrame, encodeText, encodeUserBroadcast } from "./serializer";

type ClientMsg = { join_ref: string | null; ref: string | null; topic: string; event: string; payload: unknown };
const require_ = createRequire(import.meta.url);
const ClientSerializer = (require_("@supabase/realtime-js/dist/main/lib/serializer.js") as { default: new () => { encode(m: ClientMsg, cb: (r: unknown) => void): void; decode(raw: unknown, cb: (m: ClientMsg) => void): void } }).default;
const cliente = new ClientSerializer();

const codificaCliente = (m: ClientMsg): string | ArrayBuffer => {
  let out: unknown;
  cliente.encode(m, (r) => (out = r));
  return out as string | ArrayBuffer;
};
const decodificaCliente = (raw: string | ArrayBuffer): ClientMsg => {
  let out: ClientMsg | undefined;
  cliente.decode(raw, (m) => (out = m));
  return out!;
};
const bytes = (b: ArrayBuffer | Uint8Array) => new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b));

describe("serializador V2 (texto)", () => {
  it("lee lo que manda el cliente al unirse", () => {
    const raw = codificaCliente({ join_ref: "1", ref: "1", topic: "realtime:sala", event: "phx_join", payload: { config: { broadcast: { self: false } } } });
    expect(typeof raw).toBe("string");
    expect(decodeFrame(raw)).toEqual({ joinRef: "1", ref: "1", topic: "realtime:sala", event: "phx_join", payload: { config: { broadcast: { self: false } } } });
  });

  it("lo que escribimos, el cliente lo lee igual", () => {
    const m = { joinRef: "1", ref: "2", topic: "realtime:sala", event: "phx_reply", payload: { status: "ok", response: {} } };
    expect(decodificaCliente(encodeText(m))).toEqual({ join_ref: "1", ref: "2", topic: "realtime:sala", event: "phx_reply", payload: { status: "ok", response: {} } });
  });

  it("algo que no es su array V2 es un error, como su decode_text", () => {
    expect(() => decodeFrame(`{"topic":"x"}`)).toThrow(/expected V2 array/);
  });
});

describe("broadcast de usuario (binario)", () => {
  it("lee el userBroadcastPush del cliente con carga JSON, y con acentos y emoji en el tema", () => {
    const raw = codificaCliente({
      join_ref: "3",
      ref: "4",
      topic: "realtime:sala-ñandú-🎉",
      event: "broadcast",
      payload: { type: "broadcast", event: "hola", payload: { x: "árbol" } },
    });
    expect(raw).toBeInstanceOf(ArrayBuffer);
    const d = decodeFrame(bytes(raw as ArrayBuffer));
    expect(d).toMatchObject({ kind: "user_broadcast_push", joinRef: "3", ref: "4", topic: "realtime:sala-ñandú-🎉", event: "hola", json: true });
    expect(JSON.parse(new TextDecoder().decode((d as { payload: Uint8Array }).payload))).toEqual({ x: "árbol" });
  });

  it("lee el userBroadcastPush con carga binaria tal cual", () => {
    const carga = new Uint8Array([0, 255, 7, 42]).buffer;
    const raw = codificaCliente({ join_ref: "3", ref: "5", topic: "realtime:sala", event: "broadcast", payload: { type: "broadcast", event: "bin", payload: carga } });
    const d = decodeFrame(bytes(raw as ArrayBuffer)) as { json: boolean; payload: Uint8Array };
    expect(d.json).toBe(false);
    expect([...d.payload]).toEqual([0, 255, 7, 42]);
  });

  it("el userBroadcast que escribimos, el cliente lo lee como su broadcast", () => {
    const json = encodeUserBroadcast({ topic: "realtime:sala-ñ", event: "hola", payload: new TextEncoder().encode(JSON.stringify({ a: 1 })), json: true });
    const leido = decodificaCliente(json.buffer.slice(json.byteOffset, json.byteOffset + json.byteLength) as ArrayBuffer);
    expect(leido).toEqual({ join_ref: null, ref: null, topic: "realtime:sala-ñ", event: "broadcast", payload: { type: "broadcast", event: "hola", payload: { a: 1 } } });

    const bin = encodeUserBroadcast({ topic: "realtime:sala", event: "bin", payload: new Uint8Array([9, 8]), json: false });
    const b = decodificaCliente(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);
    expect([...new Uint8Array(b.payload && (b.payload as { payload: ArrayBuffer }).payload)]).toEqual([9, 8]);
  });

  it("un tema de más de 255 bytes no se puede escribir (su byte_size!)", () => {
    expect(() => encodeUserBroadcast({ topic: `realtime:${"a".repeat(250)}`, event: "e", payload: new Uint8Array(), json: true })).toThrow(/must be less than or equal to 255 bytes/);
  });
});
