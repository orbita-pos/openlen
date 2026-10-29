// Reading a git packfile (gitformat-pack), version 2 or 3: each object's type and size, its zlib stream, and the two
// kinds of delta — OFS_DELTA (its base earlier in the same pack, by offset) and REF_DELTA (its base by oid, in the pack
// or, for a thin pack, among the objects we already have).
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

import { makeObject, type GitObject, type ObjectType } from "../objects";

const TYPES: Readonly<Record<number, ObjectType>> = { 1: "commit", 2: "tree", 3: "blob", 4: "tag" };
export const OFS_DELTA = 6;
export const REF_DELTA = 7;

export interface PackEntry {
  readonly offset: number;
  /** 1 commit, 2 tree, 3 blob, 4 tag, 6 OFS_DELTA, 7 REF_DELTA. */
  readonly type: number;
  /** The inflated data: the object, or the delta. */
  readonly data: Uint8Array;
  readonly baseOffset?: number;
  readonly baseOid?: string;
}

/** Every entry of the pack, as stored (deltas not applied), after checking its header and checksum. */
export function scanPack(bytes: Uint8Array): PackEntry[] {
  if (bytes.byteLength < 32 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "PACK") throw new Error("pack: not a packfile");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4);
  if (version !== 2 && version !== 3) throw new Error(`pack: version ${version} is not supported`);
  const count = view.getUint32(8);
  const body = bytes.subarray(0, bytes.byteLength - 20);
  const sum = createHash("sha1").update(body).digest();
  if (!sum.equals(Buffer.from(bytes.subarray(bytes.byteLength - 20)))) throw new Error("pack: the checksum does not match");

  const entries: PackEntry[] = [];
  let at = 12;
  for (let i = 0; i < count; i++) {
    const offset = at;
    let c = body[at++]!;
    const type = (c >> 4) & 7;
    let size = c & 15;
    let shift = 4;
    while (c & 0x80) {
      c = body[at++]!;
      size += (c & 0x7f) * 2 ** shift;
      shift += 7;
    }
    let baseOffset: number | undefined;
    let baseOid: string | undefined;
    if (type === OFS_DELTA) {
      c = body[at++]!;
      let back = c & 0x7f;
      while (c & 0x80) {
        c = body[at++]!;
        back = (back + 1) * 128 + (c & 0x7f);
      }
      baseOffset = offset - back;
    } else if (type === REF_DELTA) {
      baseOid = Buffer.from(body.subarray(at, at + 20)).toString("hex");
      at += 20;
    } else if (!TYPES[type]) throw new Error(`pack: object type ${type} at ${offset}`);
    if (at >= body.byteLength) throw new Error("pack: truncated");
    const inflated = inflateSync(body.subarray(at), { info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    if (inflated.buffer.byteLength !== size) throw new Error(`pack: object at ${offset} inflates to ${inflated.buffer.byteLength} bytes, not ${size}`);
    at += inflated.engine.bytesWritten;
    entries.push({ offset, type, data: new Uint8Array(inflated.buffer), ...(baseOffset !== undefined ? { baseOffset } : {}), ...(baseOid ? { baseOid } : {}) });
  }
  if (at !== body.byteLength) throw new Error("pack: trailing bytes after the last object");
  return entries;
}

function deltaSize(delta: Uint8Array, at: { i: number }): number {
  let size = 0;
  let shift = 0;
  let c: number;
  do {
    c = delta[at.i++]!;
    size += (c & 0x7f) * 2 ** shift;
    shift += 7;
  } while (c & 0x80);
  return size;
}

/** patch-delta.c: copy-from-base and insert instructions. */
export function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  const at = { i: 0 };
  if (deltaSize(delta, at) !== base.byteLength) throw new Error("pack: a delta's base has the wrong size");
  const out = new Uint8Array(deltaSize(delta, at));
  let o = 0;
  while (at.i < delta.byteLength) {
    const c = delta[at.i++]!;
    if (c & 0x80) {
      let off = 0;
      let size = 0;
      if (c & 0x01) off += delta[at.i++]!;
      if (c & 0x02) off += delta[at.i++]! * 0x100;
      if (c & 0x04) off += delta[at.i++]! * 0x10000;
      if (c & 0x08) off += delta[at.i++]! * 0x1000000;
      if (c & 0x10) size += delta[at.i++]!;
      if (c & 0x20) size += delta[at.i++]! * 0x100;
      if (c & 0x40) size += delta[at.i++]! * 0x10000;
      if (size === 0) size = 0x10000;
      if (off + size > base.byteLength || o + size > out.byteLength) throw new Error("pack: a delta copies out of range");
      out.set(base.subarray(off, off + size), o);
      o += size;
    } else if (c !== 0) {
      if (o + c > out.byteLength || at.i + c > delta.byteLength) throw new Error("pack: a delta inserts out of range");
      out.set(delta.subarray(at.i, at.i + c), o);
      o += c;
      at.i += c;
    } else throw new Error("pack: a delta has an instruction 0");
  }
  if (o !== out.byteLength) throw new Error("pack: a delta ends short");
  return out;
}

/** Every object of the pack, deltas applied. `base` finds a REF_DELTA's base outside the pack (a thin pack). */
export async function readPack(bytes: Uint8Array, base: (oid: string) => Promise<GitObject | undefined>): Promise<GitObject[]> {
  const entries = scanPack(bytes);
  const byOffset = new Map<number, GitObject>();
  const byOid = new Map<string, GitObject>();
  const resolved = (e: PackEntry, o: GitObject) => {
    byOffset.set(e.offset, o);
    byOid.set(o.oid, o);
  };
  let pending = entries;
  for (const e of entries) if (TYPES[e.type]) resolved(e, makeObject(TYPES[e.type]!, e.data));
  pending = entries.filter((e) => !TYPES[e.type]);
  // A delta's base can itself be a delta: resolve in rounds until nothing moves.
  while (pending.length > 0) {
    const next: PackEntry[] = [];
    for (const e of pending) {
      const b = e.baseOffset !== undefined ? byOffset.get(e.baseOffset) : byOid.get(e.baseOid!);
      if (b) resolved(e, makeObject(b.type, applyDelta(b.content, e.data)));
      else next.push(e);
    }
    if (next.length === pending.length) {
      // What is left needs a base from outside the pack.
      let found = false;
      for (const e of next) {
        if (e.baseOid === undefined) continue;
        const b = await base(e.baseOid);
        if (b && !b.external) {
          byOid.set(b.oid, b);
          found = true;
        }
      }
      if (!found) throw new Error(`pack: ${next.length} deltas have no base`);
    }
    pending = next;
  }
  return entries.map((e) => byOffset.get(e.offset)!);
}
