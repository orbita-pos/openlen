// The pure half of a blob pointer (see ./blob.ts): what it looks like and how big the file is. No node
// imports: the folder rules use it, and the client imports those.

export const BLOB_PREFIX = "￿openlen-blob:";

export interface BlobRef {
  readonly sha256: string;
  readonly size: number;
  /** Git's id for these bytes as a blob: what `git status` compares without downloading them. */
  readonly gitOid: string;
}

const POINTER = /^￿openlen-blob:([0-9a-f]{64}):(\d+):([0-9a-f]{40})$/;

export function isBlobPointer(content: string): boolean {
  return content.startsWith(BLOB_PREFIX);
}

export function makePointer(r: BlobRef): string {
  return `${BLOB_PREFIX}${r.sha256}:${r.size}:${r.gitOid}`;
}

export function parsePointer(content: string): BlobRef | null {
  const m = POINTER.exec(content);
  return m ? { sha256: m[1]!, size: Number(m[2]), gitOid: m[3]! } : null;
}

const encoder = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/** Git's rule (a NUL in the first 8000 bytes), plus bytes that aren't UTF-8: `projectFiles.content` is
 *  UTF-8 text, so Latin-1 or UTF-16 text is kept as a blob to keep every byte. */
export function isBinaryBytes(bytes: Uint8Array): boolean {
  if (bytes.subarray(0, 8000).includes(0)) return true;
  try {
    strictUtf8.decode(bytes);
    return false;
  } catch {
    return true;
  }
}

/** The file's size in bytes: a pointer's own, a text's in UTF-8. */
export function sizeOf(content: string): number {
  return parsePointer(content)?.size ?? encoder.encode(content).byteLength;
}
