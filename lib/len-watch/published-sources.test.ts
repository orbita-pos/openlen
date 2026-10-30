// What a publish keeps of itself (spec local 2026-10-30-len-watch, §5.5 step 1): the sources it published, as a git
// commit that hangs off the project's history without moving any branch.
import { describe, expect, it } from "vitest";

import { makePointer } from "@/lib/files/blob-pointer";
import { memoryStore } from "@/lib/git/memory-store";
import { Repository } from "@/lib/git/repository";

import { commitPublished, snapshotFiles } from "./published-sources";

const OWNER = { name: "Ana", email: "ana@users.noreply.openlen.app" };
const NOW = new Date("2026-10-30T12:00:00Z");
const POINTER = makePointer({ sha256: "a".repeat(64), size: 12, gitOid: "b".repeat(40) });

describe("snapshotFiles", () => {
  it("the site's pages by their paths plus the folder, without editor marks", () => {
    const f = snapshotFiles({ html: '<p data-op-id="a">Hi</p>', pages: { precios: { html: "<p>$</p>" } } }, { "/src/App.tsx": "x", "/img/a.webp": POINTER });
    expect(Object.keys(f.versioned).sort()).toEqual(["/img/a.webp", "/index.html", "/precios/index.html", "/src/App.tsx"]);
    expect(f.versioned["/index.html"]).toBe("<p>Hi</p>");
    // A binary travels as its pointer: its bytes are never read.
    expect(f.versioned["/img/a.webp"]).toBe(POINTER);
  });

  it("what git never sees (the npm lock under /.openlen) is kept apart, not in the commit", () => {
    const f = snapshotFiles({ html: "<p>Hi</p>" }, { "/.openlen/esm-lock.json": "{}", "/src/App.tsx": "x" });
    expect(Object.keys(f.versioned).sort()).toEqual(["/index.html", "/src/App.tsx"]);
    expect(f.extra).toEqual({ "/.openlen/esm-lock.json": "{}" });
  });
});

describe("commitPublished", () => {
  it("hangs the commit off HEAD and moves no branch", async () => {
    const store = memoryStore();
    await commitPublished(store, { "/index.html": "v1" }, OWNER, NOW);
    const before = await store.readRepo();
    const oid = await commitPublished(store, { "/index.html": "v2", "/src/App.tsx": "x" }, OWNER, NOW);
    const after = await store.readRepo();
    expect(after).toEqual(before);
    const repo = new Repository(store);
    const commit = await repo.commit(oid);
    expect(commit.parents).toEqual([before!.head]);
    const files = await repo.files(commit.tree);
    expect([...files.keys()].sort()).toEqual(["index.html", "src/App.tsx"]);
    expect(await repo.text(files.get("index.html")!)).toBe("v2");
  });

  it("creates the repository first when the project never used git, as git does on first use", async () => {
    const store = memoryStore();
    const oid = await commitPublished(store, { "/index.html": "v1" }, OWNER, NOW);
    const repo = await store.readRepo();
    expect(repo!.refs).toEqual({ main: repo!.head });
    expect((await new Repository(store).commit(oid)).parents).toEqual([repo!.head]);
    expect((await new Repository(store).commit(repo!.head)).message).toBe("Initial commit\n");
  });
});
