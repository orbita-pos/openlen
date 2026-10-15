// @vitest-environment node
// add, reset and commit against the real git: same output, same hashes.
import { afterEach, describe, expect, it } from "vitest";
import { INDEX_LOCKED } from "./errors";
import { runGit } from "./run";
import { AUTHOR } from "./test-support/real-git";
import { Pair } from "./test-support/pair";

let pair: Pair;
afterEach(() => pair?.dispose());
async function same(args: readonly string[], cwd?: string): Promise<void> {
  const { real, ours } = await pair.both(args, cwd ? { cwd } : {});
  expect(ours).toEqual(real);
}
async function sameHeads(): Promise<void> {
  const h = await pair.heads();
  expect(h.ours).toBe(h.real);
}

const SITE = { "index.html": "<h1>Hola</h1>\n", "menu/index.html": "<h1>Menú</h1>\n", "src/App.tsx": "export const App = 1;\n", ".gitignore": "*.log\n" };

describe("add and commit, against the real git", () => {
  it("add then commit: same summary, same commit", async () => {
    pair = new Pair();
    await pair.start(SITE);
    pair.tick();
    pair.write({ "index.html": "<h1>Hola!</h1>\n", "src/Cart.tsx": "export const Cart = 1;\n", "menu/index.html": null });
    await same(["add", "index.html", "src/Cart.tsx", "menu/index.html"]);
    await same(["status"]);
    await same(["status", "-s"]);
    await same(["diff", "--cached"]);
    await same(["diff", "--cached", "--stat"]);
    await same(["commit", "-m", "Add the cart so customers can order", "-m", "Co-Authored-By: Len <noreply@openlen.com>"]);
    await sameHeads();
    await same(["status"]);
    await same(["diff", "HEAD~1", "HEAD"]);
    await same(["diff", "HEAD~1..HEAD", "--stat"]);
    await same(["diff", "HEAD~1...HEAD", "--name-status"]);
  });

  it("the message is cleaned up the same way (the heredoc Len writes)", async () => {
    pair = new Pair();
    await pair.start(SITE);
    pair.tick();
    pair.write({ "index.html": "x\n" });
    await same(["commit", "-a", "-m", "\n  Change the title.  \n\n\n\nCo-Authored-By: Len <noreply@openlen.com>\n\n"]);
    await sameHeads();
  });

  it("commit -a, commit <path> (only that path), and nothing to commit", async () => {
    pair = new Pair();
    await pair.start(SITE);
    pair.tick();
    pair.write({ "index.html": "a\n", "src/App.tsx": "b\n" });
    await same(["add", "src/App.tsx"]);
    pair.write({ "src/App.tsx": "c\n" });
    await same(["commit", "-m", "Only the page", "index.html"]);
    await sameHeads();
    await same(["status", "-s"]);
    pair.tick();
    await same(["commit", "-a", "-m", "The rest"]);
    await sameHeads();
    await same(["commit", "-m", "Again"]);
    pair.write({ "index.html": "d\n" });
    await same(["commit", "-m", "Not staged"]);
    await same(["commit", "-m", "  \n"]);
  });

  it("add: from a subfolder, -A, -u, -n, -v, an ignored file, a pathspec that matches nothing", async () => {
    pair = new Pair();
    await pair.start(SITE);
    pair.write({ "src/New.tsx": "n\n", "top.txt": "t\n", "x.log": "l\n", "index.html": "changed\n" });
    await same(["add", "-n", "."], "src");
    await same(["add", "."], "src");
    await same(["status", "-s"]);
    await same(["add", "-u"]);
    await same(["status", "-s"]);
    await same(["add", "x.log"]);
    await same(["add", "nope.txt"]);
    await same(["add"]);
    await same(["add", "-v", "-A"]);
    await same(["status", "-s"]);
  });

  it("reset unstages: all, or some paths", async () => {
    pair = new Pair();
    await pair.start(SITE);
    pair.write({ "index.html": "a\n", "src/App.tsx": "b\n" });
    await same(["add", "-A"]);
    await same(["reset", "--", "index.html"]);
    await same(["status", "-s"]);
    await same(["reset"]);
    await same(["status", "-s"]);
    await same(["add", "-A"]);
    await same(["reset", "-q"]);
    await same(["status", "-s"]);
  });

  it("two commits at once: the late one gets git's index.lock and nothing is lost", async () => {
    pair = new Pair();
    await pair.start(SITE);
    const store = pair.ours.store;
    const stale = await store.readRepo();
    pair.ours.write({ "index.html": "first\n" });
    expect((await pair.ours.git(["commit", "-a", "-m", "First"])).exitCode).toBe(0);
    const late = await runGit(
      { store: { ...store, readRepo: async () => stale }, files: { ...pair.ours.files, "/index.html": "second\n" }, cwd: "/", identity: AUTHOR, owner: AUTHOR, now: () => new Date() },
      ["commit", "-a", "-m", "Second"],
    );
    expect(late).toEqual({ stdout: "", stderr: INDEX_LOCKED, exitCode: 128 });
    expect((await store.readRepo())!.version).toBe(1);
  });
});
