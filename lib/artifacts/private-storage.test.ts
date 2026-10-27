// @vitest-environment node
import { chmod, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemArtifactStorage, R2ArtifactStorage, privateStorageFromEnv, storageModes } from "./private-storage";

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
  it("keeps objects private unless the folder was made readable to its group", () => {
    expect(storageModes(0o40700)).toEqual({ dir: 0o700, file: 0o600 });
    expect(storageModes(0o40740)).toEqual({ dir: 0o700, file: 0o600 }); // the group could not enter it
    expect(storageModes(0o42750)).toEqual({ dir: 0o750, file: 0o640 }); // the box: setgid, group may read
    expect(storageModes(0o40755)).toEqual({ dir: 0o750, file: 0o640 }); // others never get a bit from us
  });
  it.runIf(process.platform !== "win32")("writes group-readable objects into a folder the operator shared with a group", async () => {
    const { root, storage } = await makeStorage();
    await chmod(root, 0o750);
    await storage.put("project/a/result.pdf", new Uint8Array([1]));
    expect((await stat(join(root, "project"))).mode & 0o777).toBe(0o750);
    expect((await stat(join(root, "project/a/result.pdf"))).mode & 0o777).toBe(0o640);
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

// One way to choose the private store, shared by the deliverables and, in development without R2, by
// what `present` delivers (spec local 2026-10-26-len-skills, §4.9): never a folder under public.
describe("privateStorageFromEnv", () => {
  it("uses OPENLEN_ARTIFACTS_DIR when there is no private bucket", async () => {
    const root = await mkdtemp(join(tmpdir(), "len3-private-env-"));
    roots.push(root);
    const storage = await privateStorageFromEnv({ OPENLEN_ARTIFACTS_DIR: root });
    await storage.put("deliveries/p1/t1/a-x.xlsx", new Uint8Array([1, 2]));
    expect([...(await new FilesystemArtifactStorage(root).get("deliveries/p1/t1/a-x.xlsx"))]).toEqual([1, 2]);
  });

  it("never a folder under public, and none at all in production without one", async () => {
    await expect(privateStorageFromEnv({ OPENLEN_ARTIFACTS_DIR: join(tmpdir(), "public", "x") })).rejects.toThrow();
    await expect(privateStorageFromEnv({ NODE_ENV: "production" })).rejects.toThrow();
  });
});
