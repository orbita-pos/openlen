// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { GitFatal } from "./errors";
import { memoryStore } from "./memory-store";
import { blobOf, encodeCommit, makeObject } from "./objects";
import { Repository, buildTree } from "./repository";
import { RealRepo } from "./test-support/real-git";

const real = new RealRepo();
afterAll(() => real.dispose());

describe("buildTree", () => {
  it("builds the same root tree as `git write-tree` for nested files", () => {
    const files = { "index.html": "<h1>Hola</h1>\n", "menu/index.html": "<h1>Menú</h1>\n", "src/components/Cart.tsx": "x\n", "src/App.tsx": "y\n", "a-b.txt": "z\n" };
    real.write(files);
    real.git(["add", "-A"]);
    const index = Object.fromEntries(Object.entries(files).map(([p, c]) => [p, blobOf(c).oid]));
    expect(buildTree(index).root).toBe(real.git(["write-tree"]).stdout.trim());
  });
});

describe("Repository", () => {
  async function withCommits() {
    const store = memoryStore();
    const sig = { name: "Ana", email: "a@b", timestamp: 1, timezone: "+0000" };
    const b1 = blobOf("one\n");
    const b2 = blobOf("two\n");
    const t1 = buildTree({ "a.txt": b1.oid, "dir/b.txt": b1.oid });
    const t2 = buildTree({ "a.txt": b2.oid, "dir/b.txt": b1.oid });
    const c1 = makeObject("commit", encodeCommit({ tree: t1.root, parents: [], author: sig, committer: sig, message: "first\n" }));
    const c2 = makeObject("commit", encodeCommit({ tree: t2.root, parents: [c1.oid], author: sig, committer: sig, message: "second\n" }));
    await store.writeObjects([b1, b2, ...t1.objects, ...t2.objects, c1, c2]);
    return { store, repo: new Repository(store), c1: c1.oid, c2: c2.oid, b2: b2.oid };
  }

  it("reads the files of a commit, nested", async () => {
    const { repo, c2, b2 } = await withCommits();
    const files = await repo.filesOfCommit(c2);
    expect([...files.keys()]).toEqual(["a.txt", "dir/b.txt"]);
    expect(files.get("a.txt")).toBe(b2);
    expect(await repo.text(b2)).toBe("two\n");
  });

  it("walks the history newest first", async () => {
    const { repo, c1, c2 } = await withCommits();
    const seen: string[] = [];
    for await (const { oid } of repo.history(c2)) seen.push(oid);
    expect(seen).toEqual([c2, c1]);
  });

  it("a missing object is git's `bad object`", async () => {
    const { repo } = await withCommits();
    await expect(repo.object("f".repeat(40))).rejects.toBeInstanceOf(GitFatal);
  });

  it("the memory store compares and swaps", async () => {
    const store = memoryStore();
    const first = await store.createRepo("a".repeat(40), {});
    expect(await store.createRepo("b".repeat(40), {})).toEqual(first);
    expect(await store.updateRepo(0, "c".repeat(40), { "x.txt": "d".repeat(40) })).toMatchObject({ version: 1 });
    expect(await store.updateRepo(0, "e".repeat(40), {})).toBeNull();
  });
});
