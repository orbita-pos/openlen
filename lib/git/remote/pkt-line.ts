// git's pkt-line framing (gitprotocol-common): each packet is four hex digits giving its length, those four included,
// then the payload. 0000 is a flush, 0001 a delimiter, 0002 the end of a response (protocol v2).
export const FLUSH = Symbol("flush");
export const DELIM = Symbol("delim");

/** The longest payload a packet carries (65520 bytes minus the four of the length). */
export const MAX_PAYLOAD = 65516;

const encoder = new TextEncoder();

export function pkt(payload: string | Uint8Array): Uint8Array {
  const data = typeof payload === "string" ? encoder.encode(payload) : payload;
  if (data.byteLength > MAX_PAYLOAD) throw new Error(`pkt-line: a packet of ${data.byteLength} bytes is too long`);
  const out = new Uint8Array(4 + data.byteLength);
  out.set(encoder.encode((4 + data.byteLength).toString(16).padStart(4, "0")), 0);
  out.set(data, 4);
  return out;
}

export function encodePkts(items: readonly (string | Uint8Array | typeof FLUSH | typeof DELIM)[]): Uint8Array {
  const parts = items.map((i) => (i === FLUSH ? encoder.encode("0000") : i === DELIM ? encoder.encode("0001") : pkt(i)));
  return concat(parts);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

export type Pkt = { readonly kind: "data"; readonly data: Uint8Array } | { readonly kind: "flush" | "delim" | "end" };

export function* readPkts(bytes: Uint8Array): Generator<Pkt> {
  let at = 0;
  while (at < bytes.byteLength) {
    if (at + 4 > bytes.byteLength) throw new Error("pkt-line: truncated length");
    const hex = new TextDecoder().decode(bytes.subarray(at, at + 4));
    if (!/^[0-9a-f]{4}$/i.test(hex)) throw new Error(`pkt-line: bad length ${JSON.stringify(hex)}`);
    const length = parseInt(hex, 16);
    if (length === 0) yield { kind: "flush" };
    else if (length === 1) yield { kind: "delim" };
    else if (length === 2) yield { kind: "end" };
    else if (length < 4) throw new Error(`pkt-line: bad length ${length}`);
    else {
      if (at + length > bytes.byteLength) throw new Error("pkt-line: truncated packet");
      yield { kind: "data", data: bytes.subarray(at + 4, at + length) };
      at += length;
      continue;
    }
    at += 4;
  }
}

/** A text packet without its trailing newline. */
export function lineOf(p: Pkt): string | null {
  return p.kind === "data" ? new TextDecoder().decode(p.data).replace(/\n$/, "") : null;
}
