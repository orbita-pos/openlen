import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __setStorageForTest } from "@/lib/storage";
import { FilesystemStorage } from "@/lib/storage/filesystem";

import { BLOB_PREFIX, getBlob, isBinaryBytes, isBlobPointer, makePointer, parsePointer, putBlob, sizeOf, toStoredContent } from "./blob";

// A real PNG header + a little IHDR: binary by the NUL rule.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01]);

let dir: string;
let uploads: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openlen-blob-"));
  uploads = [];
  const fs = new FilesystemStorage({ rootDir: dir, publicUrlBase: "/uploads" });
  __setStorageForTest({
    upload: (a) => {
      uploads.push(a.key);
      return fs.upload(a);
    },
    delete: (k) => fs.delete(k),
    read: (k) => fs.read(k),
    exists: (k) => fs.exists(k),
  });
});

afterEach(() => {
  __setStorageForTest(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("isBinaryBytes", () => {
  it("a PNG is binary", () => expect(isBinaryBytes(PNG)).toBe(true));
  it("UTF-8 text is not", () => expect(isBinaryBytes(new TextEncoder().encode("hola\nqué tal\n"))).toBe(false));
  it("Latin-1 text (not valid UTF-8) is stored as binary", () => expect(isBinaryBytes(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]))).toBe(true));
});

describe("pointers", () => {
  it("never holds a NUL: Postgres text can't store one", () => {
    expect(makePointer({ sha256: "a".repeat(64), size: 1, gitOid: "b".repeat(40) })).not.toContain("\u0000");
  });

  it("a text that happens to start like a pointer is kept as a blob, so the two never mix", async () => {
    const tricky = new TextEncoder().encode(`${BLOB_PREFIX}${"a".repeat(64)}:1:${"b".repeat(40)}`);
    const stored = await toStoredContent(tricky);
    expect(parsePointer(stored)?.size).toBe(tricky.byteLength);
    expect(Array.from(await getBlob(stored))).toEqual(Array.from(tricky));
  });

  it("round-trips and is told apart from text", () => {
    const ref = { sha256: "a".repeat(64), size: 20, gitOid: "b".repeat(40) };
    const p = makePointer(ref);
    expect(isBlobPointer(p)).toBe(true);
    expect(parsePointer(p)).toEqual(ref);
    expect(sizeOf(p)).toBe(20);
    expect(parsePointer("hola")).toBeNull();
    expect(isBlobPointer("hola")).toBe(false);
    expect(sizeOf("qué")).toBe(4);
  });
});

describe("putBlob / getBlob", () => {
  it("stores a binary as a pointer and gives the same bytes back", async () => {
    const stored = await toStoredContent(PNG);
    expect(isBlobPointer(stored)).toBe(true);
    expect(Array.from(await getBlob(stored))).toEqual(Array.from(PNG));
  });

  it("keeps text as text", async () => {
    expect(await toStoredContent(new TextEncoder().encode("hola\n"))).toBe("hola\n");
  });

  it("the pointer's gitOid is real git's blob id", async () => {
    const ref = await putBlob(PNG);
    const file = join(dir, "x.png");
    writeFileSync(file, PNG);
    const real = execFileSync("git", ["hash-object", file], { encoding: "utf8" }).trim();
    expect(ref.gitOid).toBe(real);
    expect(ref.size).toBe(PNG.byteLength);
  });

  it("uploads the same bytes only once", async () => {
    await putBlob(PNG);
    await putBlob(PNG);
    expect(uploads.filter((k) => k.startsWith("blobs/"))).toHaveLength(1);
  });
});
