// @vitest-environment node
// `git status` against the real git: same bytes, same exit code.
import { afterEach, describe, expect, it } from "vitest";
import { Pair } from "./test-support/pair";

let pair: Pair;
afterEach(() => pair?.dispose());

async function same(args: readonly string[], cwd?: string): Promise<void> {
  const { real, ours } = await pair.both(args, cwd ? { cwd } : {});
  expect(ours).toEqual(real);
}

const SITE = { "index.html": "<h1>Hola</h1>\n", "menu/index.html": "<h1>Menú</h1>\n", "src/main.tsx": "x\n" };

describe("git status, against the real git", () => {
  it("starts from the same Initial commit", async () => {
    pair = new Pair();
    await pair.start(SITE);
    const h = await pair.heads();
    expect(h.ours).toBe(h.real);
  });

  it("clean", async () => {
    pair = new Pair();
    await pair.start(SITE);
    await same(["status"]);
    await same(["status", "--short"]);
  });

  it("modified, deleted and untracked, in every format", async () => {
    pair = new Pair();
    await pair.start(SITE);
    pair.write({ "index.html": "<h1>Hola!</h1>\n", "menu/index.html": null, "src/App.tsx": "y\n", "notes.txt": "n\n" });
    for (const args of [["status"], ["status", "--short"], ["status", "-s", "-b"], ["status", "--porcelain"], ["status", "-sb"]]) await same(args);
  });

  it("an untracked folder shows as one line", async () => {
    pair = new Pair();
    await pair.start(SITE);
    pair.write({ "new/a.txt": "a\n", "new/deep/b.txt": "b\n", "src/x.tsx": "x\n" });
    await same(["status"]);
    await same(["status", "-s"]);
    await same(["status", "-uall"]);
    await same(["status", "-uno"]);
    await same(["status", "--untracked-files=no"]);
  });

  it("from a subfolder: paths relative to it; porcelain stays at the root", async () => {
    pair = new Pair();
    await pair.start(SITE);
    pair.write({ "index.html": "<h1>Hola!</h1>\n", "src/main.tsx": "z\n", "src/new.tsx": "n\n" });
    await same(["status"], "src");
    await same(["status", "-s"], "src");
    await same(["status", "--porcelain"], "src");
  });

  it("a .gitignore hides untracked files, not tracked ones", async () => {
    pair = new Pair();
    await pair.start({ ...SITE, ".gitignore": "*.log\ndist/\n", "keep.log": "tracked anyway?\n" });
    pair.write({ "x.log": "x\n", "dist/a.js": "a\n", "keep.log": "changed\n" });
    await same(["status"]);
    await same(["status", "-s"]);
  });

  it("names with accents are quoted like git (and, in the short format, names with spaces)", async () => {
    pair = new Pair();
    await pair.start({ "café.html": "c\n", "mi página/index.html": "p\n", "con espacio.html": "e\n" });
    pair.write({ "café.html": "c2\n", "mi página/index.html": "p2\n", "con espacio.html": "e2\n", "ñandú.txt": "n\n" });
    await same(["status"]);
    await same(["status", "-s"]);
  });

  it("a pathspec narrows the list", async () => {
    pair = new Pair();
    await pair.start(SITE);
    pair.write({ "index.html": "a\n", "src/main.tsx": "b\n" });
    await same(["status", "src"]);
    await same(["status", "-s", "--", "index.html"]);
  });
});
