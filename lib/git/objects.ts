// Git's object format, byte for byte (spec local 2026-10-15-git-for-len, §2). Pure: the
// differential tests check every hash against the real git binary.
import { createHash } from "node:crypto";

export type ObjectType = "blob" | "tree" | "commit";
export type EntryMode = "100644" | "40000";

export interface GitObject {
  readonly oid: string;
  readonly type: ObjectType;
  readonly content: Uint8Array;
}

export interface TreeEntry {
  readonly name: string;
  readonly mode: EntryMode;
  readonly oid: string;
}

export interface Signature {
  readonly name: string;
  readonly email: string;
  /** Seconds since the epoch. */
  readonly timestamp: number;
  /** "+0000": OpenLen always writes UTC. */
  readonly timezone: string;
}

export interface Commit {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly author: Signature;
  readonly committer: Signature;
  /** As stored: cleaned up and ending in "\n". */
  readonly message: string;
}

export const EMPTY_TREE_OID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const NULL_OID = "0".repeat(40);

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const utf8 = (text: string): Uint8Array => encoder.encode(text);
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);

export function hashObject(type: ObjectType, content: Uint8Array): string {
  return createHash("sha1").update(`${type} ${content.byteLength}\0`).update(content).digest("hex");
}

export function makeObject(type: ObjectType, content: Uint8Array): GitObject {
  return { oid: hashObject(type, content), type, content };
}

export function blobOf(text: string): GitObject {
  return makeObject("blob", utf8(text));
}

/** Git orders names by their bytes. */
export function compareNames(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

// In a tree, a subtree sorts as if its name ended in "/".
const sortKey = (e: TreeEntry): string => (e.mode === "40000" ? `${e.name}/` : e.name);

export function encodeTree(entries: readonly TreeEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => compareNames(sortKey(a), sortKey(b)));
  return Buffer.concat(sorted.flatMap((e) => [Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.oid, "hex")]));
}

export function decodeTree(content: Uint8Array): TreeEntry[] {
  const bytes = Buffer.from(content);
  const out: TreeEntry[] = [];
  let i = 0;
  while (i < bytes.length) {
    const space = bytes.indexOf(0x20, i);
    const nul = bytes.indexOf(0x00, space);
    out.push({
      mode: bytes.toString("utf8", i, space) as EntryMode,
      name: bytes.toString("utf8", space + 1, nul),
      oid: bytes.toString("hex", nul + 1, nul + 21),
    });
    i = nul + 21;
  }
  return out;
}

const formatSignature = (s: Signature): string => `${s.name} <${s.email}> ${s.timestamp} ${s.timezone}`;

function parseSignature(text: string): Signature {
  const m = /^(.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(text);
  if (!m) throw new Error(`bad signature: ${text}`);
  return { name: m[1]!, email: m[2]!, timestamp: Number(m[3]), timezone: m[4]! };
}

export function encodeCommit(c: Commit): Uint8Array {
  const header = [
    `tree ${c.tree}`,
    ...c.parents.map((p) => `parent ${p}`),
    `author ${formatSignature(c.author)}`,
    `committer ${formatSignature(c.committer)}`,
  ];
  return utf8(`${header.join("\n")}\n\n${c.message}`);
}

export function decodeCommit(content: Uint8Array): Commit {
  const text = fromUtf8(content);
  const split = text.indexOf("\n\n");
  let tree = "";
  const parents: string[] = [];
  let author: Signature | null = null;
  let committer: Signature | null = null;
  for (const line of text.slice(0, split).split("\n")) {
    const space = line.indexOf(" ");
    const key = line.slice(0, space);
    const value = line.slice(space + 1);
    if (key === "tree") tree = value;
    else if (key === "parent") parents.push(value);
    else if (key === "author") author = parseSignature(value);
    else if (key === "committer") committer = parseSignature(value);
  }
  if (!tree || !author || !committer) throw new Error("bad commit object");
  return { tree, parents, author, committer, message: text.slice(split + 2) };
}
