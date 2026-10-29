// Writing a git packfile (gitformat-pack, version 2): every object whole, no deltas — what a push needs, and what any
// receive-pack accepts. An external blob must come with its bytes: the caller reads them from storage first.
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import type { GitObject } from "../objects";
import { concat } from "./pkt-line";

const NUMBER: Readonly<Record<GitObject["type"], number>> = { commit: 1, tree: 2, blob: 3, tag: 4 };

function header(type: number, size: number): Uint8Array {
  const out: number[] = [];
  let c = (type << 4) | (size & 15);
  let rest = Math.floor(size / 16);
  while (rest > 0) {
    out.push(c | 0x80);
    c = rest & 0x7f;
    rest = Math.floor(rest / 128);
  }
  out.push(c);
  return Uint8Array.from(out);
}

export function writePack(objects: readonly GitObject[]): Uint8Array {
  const unique = [...new Map(objects.map((o) => [o.oid, o])).values()];
  const head = new Uint8Array(12);
  head.set(new TextEncoder().encode("PACK"), 0);
  const view = new DataView(head.buffer);
  view.setUint32(4, 2);
  view.setUint32(8, unique.length);
  const parts: Uint8Array[] = [head];
  for (const o of unique) {
    if (o.external) throw new Error(`pack: blob ${o.oid} is external; read its bytes before packing it`);
    parts.push(header(NUMBER[o.type], o.content.byteLength), new Uint8Array(deflateSync(o.content)));
  }
  const body = concat(parts);
  return concat([body, new Uint8Array(createHash("sha1").update(body).digest())]);
}
