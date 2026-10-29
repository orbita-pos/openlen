// A file's content as git sees it (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8). Text is a blob of
// its UTF-8 bytes, as always. A binary is a blob POINTER (lib/files/blob-pointer.ts): its blob is EXTERNAL —its id
// is the pointer's gitOid, the id git gives those bytes, and the bytes stay in storage—, so `add`, `status` and
// `commit` never download it, and reading the blob back gives the pointer, which is what the folder stores.
import { makePointer, parsePointer } from "@/lib/files/blob-pointer";

import { blobOf, type GitObject } from "./objects";

export function blobForContent(content: string): GitObject {
  const ref = parsePointer(content);
  if (!ref) return blobOf(content);
  return { oid: ref.gitOid, type: "blob", content: new Uint8Array(0), external: ref };
}

export function oidOfContent(content: string): string {
  return parsePointer(content)?.gitOid ?? blobOf(content).oid;
}

/** What a blob is in the working tree: an external one's pointer, or its text. */
export function contentOfBlob(o: GitObject): string {
  return o.external ? makePointer(o.external) : new TextDecoder().decode(o.content);
}
