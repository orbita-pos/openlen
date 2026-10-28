// A project's binary files (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §4). A binary still lives
// in `projectFiles.content`, as a POINTER: U+FFFF + "openlen-blob:" + its sha256, size and git blob id. U+FFFF
// is a Unicode noncharacter (Postgres text can't hold the NUL a binary would start with), and a text that does
// start with the prefix is stored as a blob itself, so the two can never be confused. Every place that
// passes a project's files as `Record<string, string>` keeps working; only what touches bytes resolves it.
// The bytes go to the uploads storage under `blobs/<sha256>`: content-addressed, so the same file twice (a
// copy, a move, a remix, a commit) is stored once, and nothing here deletes one (another path may hold it).

import { createHash } from "node:crypto";

import { hashObject } from "@/lib/git/objects";
import { getStorage } from "@/lib/storage";

import { isBlobPointer, makePointer, parsePointer, type BlobRef } from "./blob-pointer";

export { BLOB_PREFIX, isBlobPointer, makePointer, parsePointer, sizeOf, type BlobRef } from "./blob-pointer";

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/** Git's rule (a NUL in the first 8000 bytes), plus bytes that aren't UTF-8: `projectFiles.content` is
 *  UTF-8 text, so Latin-1 or UTF-16 text is kept as a blob to keep every byte. */
export function isBinaryBytes(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8000);
  if (head.includes(0)) return true;
  try {
    strictUtf8.decode(bytes);
    return false;
  } catch {
    return true;
  }
}

const keyOf = (sha256: string) => `blobs/${sha256}`;

function storage() {
  const s = getStorage();
  if (!s.read || !s.exists) throw new Error("this storage can't hold project files (no read)");
  return s as typeof s & Required<Pick<typeof s, "read" | "exists">>;
}

/** Stores the bytes (once: if they're already there, nothing is uploaded) and says what they are. */
export async function putBlob(bytes: Uint8Array): Promise<BlobRef> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ref: BlobRef = { sha256, size: bytes.byteLength, gitOid: hashObject("blob", bytes) };
  const s = storage();
  if (!(await s.exists(keyOf(sha256)))) {
    await s.upload({ key: keyOf(sha256), contentType: "application/octet-stream", body: Buffer.from(bytes) });
  }
  remember(sha256, bytes);
  return ref;
}

// A small cache: the canvas asks for the same image many times while someone edits.
const CACHE_BYTES = 64 * 1024 * 1024;
const cache = new Map<string, Uint8Array>();
let cached = 0;

function remember(sha256: string, bytes: Uint8Array): void {
  if (bytes.byteLength > CACHE_BYTES / 4 || cache.has(sha256)) return;
  cache.set(sha256, bytes);
  cached += bytes.byteLength;
  for (const [k, v] of cache) {
    if (cached <= CACHE_BYTES) break;
    cache.delete(k);
    cached -= v.byteLength;
  }
}

/** The bytes of a pointer (or of a sha256). Throws if they're missing: a pointer whose bytes are gone is a
 *  broken file, never an empty one. */
export async function getBlob(ref: BlobRef | string): Promise<Uint8Array> {
  const sha256 = typeof ref === "string" ? (parsePointer(ref)?.sha256 ?? (/^[0-9a-f]{64}$/.test(ref) ? ref : null)) : ref.sha256;
  if (!sha256) throw new Error("not a blob pointer");
  const hit = cache.get(sha256);
  if (hit) {
    cache.delete(sha256);
    cache.set(sha256, hit);
    return hit;
  }
  const buf = await storage().read(keyOf(sha256));
  if (!buf) throw new Error(`blob ${sha256} is missing from storage`);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  remember(sha256, bytes);
  return bytes;
}

/** What goes into `projectFiles.content` for these bytes: the text itself, or a pointer. */
export async function toStoredContent(bytes: Uint8Array): Promise<string> {
  if (!isBinaryBytes(bytes)) {
    const text = strictUtf8.decode(bytes);
    if (!isBlobPointer(text)) return text;
  }
  return makePointer(await putBlob(bytes));
}
