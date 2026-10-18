// @vitest-environment node
import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemArtifactStorage, R2ArtifactStorage } from "./private-storage";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const local = relative(resolve(tmpdir()), resolve(root));
    if (!local.startsWith("len3-") || local.includes("..") || local.includes("/") || local.includes("\\")) throw new Error("unexpected test cleanup target");
    await rm(root, { recursive: true, force: true });
  }
});
async function makeStorage() { const root = await mkdtemp(join(tmpdir(), "len3-private-")); roots.push(root); return { root, storage: new FilesystemArtifactStorage(root) }; }

describe("private output storage", () => {
  it("stores bytes privately, returns no public URL and treats repeated puts as immutable", async () => {
    const { storage } = await makeStorage();
    await storage.put("project/a/result.pdf", new Uint8Array([1, 2, 3]));
    expect([...await storage.get("project/a/result.pdf")]).toEqual([1, 2, 3]);
    await storage.put("project/a/result.pdf", new Uint8Array([1, 2, 3]));
    await expect(storage.put("project/a/result.pdf", new Uint8Array([9]))).rejects.toMatchObject({ code: "object_conflict" });
    await storage.delete("project/a/result.pdf");
    await expect(storage.get("project/a/result.pdf")).rejects.toThrow();
    await expect(storage.delete("never/uploaded/result.pdf")).resolves.toBeUndefined();
  });
  it("rejects traversal and absolute URLs without writing outside the root", async () => {
    const { root, storage } = await makeStorage();
    for (const key of ["../escape", "/absolute", "p/../../escape", "p\\..\\escape", "https://public.test/x"]) await expect(storage.put(key, new Uint8Array([1]))).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });
  // Windows sandbox cannot create reparse points; this exact boundary also ran
  // against the production module in isolated Linux (see execution ledger).
  it.runIf(process.platform !== "win32")("refuses a parent junction leading out of private storage", async () => {
    const { root, storage } = await makeStorage();
    const outside = await mkdtemp(join(tmpdir(), "len3-outside-")); roots.push(outside);
    await symlink(outside, join(root, "escape"), "junction");
    await expect(storage.put("escape/file", new Uint8Array([1]))).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });
  it("R2 uses private object operations and never constructs public URLs", async () => {
    const values = new Map<string, Uint8Array>();
    const transport = {
      put: async (key: string, bytes: Uint8Array) => { values.set(key, bytes); },
      get: async (key: string) => values.get(key)!,
      delete: async (key: string) => { values.delete(key); },
    };
    const storage = new R2ArtifactStorage(transport);
    expect(await storage.put("p/a/x.png", new Uint8Array([7]))).toBeUndefined();
    expect([...await storage.get("p/a/x.png")]).toEqual([7]);
    await expect(storage.get("../x")).rejects.toThrow();
    // It exercises the storage contract; no credential or network dependency.
    await storage.delete("p/a/x.png");
    expect(values.size).toBe(0);
  });
});
