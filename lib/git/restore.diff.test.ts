// @vitest-environment node
// restore, checkout -- <paths> and revert against the real git: same output, same files, same commits.
import { afterEach, describe, expect, it } from "vitest";
import { REVERT_CONFLICT_NOTE } from "./commands/revert";
import { Pair } from "./test-support/pair";

let pair: Pair;
afterEach(() => pair?.dispose());
async function same(args: readonly string[], cwd?: string): Promise<void> {
  const { real, ours } = await pair.both(args, cwd ? { cwd } : {});
  expect(ours).toEqual(real);
  const files = pair.snapshots();
  expect(files.ours).toEqual(files.real);
}

const SITE = { "index.html": "<h1>Uno</h1>\n<p>a</p>\n<p>b</p>\n<p>c</p>\n<p>d</p>\n<p>e</p>\n<p>f</p>\n<p>g</p>\n", "src/App.tsx": "export const App = 1;\n" };

async function threeCommits(): Promise<void> {
  pair = new Pair();
  await pair.start(SITE);
  const edits: [Record<string, string | null>, string][] = [
    [{ "index.html": SITE["index.html"].replace("<h1>Uno</h1>", "<h1>Dos</h1>") }, "Title two"],
    [{ "src/Cart.tsx": "export const Cart = 1;\n" }, "Add the cart"],
    [{ "index.html": SITE["index.html"].replace("<h1>Uno</h1>", "<h1>Dos</h1>").replace("<p>g</p>", "<p>G</p>") }, "Shout g"],
  ];
  for (const [files, message] of edits) {
    pair.tick(600);
    pair.write(files);
    await pair.both(["add", "-A"]);
    await pair.both(["commit", "-q", "-m", message]);
  }
}

describe("bringing files back, against the real git", () => {
  it("restore: from the index, --staged, --source, a folder, a path that matches nothing", async () => {
    await threeCommits();
    pair.write({ "index.html": "broken\n", "src/App.tsx": "broken\n" });
    await same(["restore", "index.html"]);
    await same(["add", "src/App.tsx"]);
    await same(["restore", "--staged", "src/App.tsx"]);
    await same(["restore", "src"]);
    await same(["restore", "--source=HEAD~3", "index.html"]);
    await same(["restore", "--source", "HEAD~3", "--staged", "--worktree", "src"]);
    await same(["status", "-s"]);
    await same(["restore", "nope.txt"]);
    await same(["restore"]);
  });

  it("checkout -- <path>: from the index and from a commit", async () => {
    await threeCommits();
    pair.write({ "index.html": "broken\n" });
    await same(["checkout", "--", "index.html"]);
    await same(["checkout", "HEAD~2", "--", "index.html"]);
    await same(["status", "-s"]);
    await same(["checkout", "HEAD~3", "--", "src"]);
    await same(["checkout", "HEAD", "--", "nope.txt"]);
    await same(["checkout", "main"]);
    // Without "--", git says what it updated (and from which tree).
    pair.write({ "index.html": "broken again\n" });
    await same(["checkout", "index.html"]);
    await same(["checkout", "HEAD~2", "index.html"]);
  });

  it("checkout <commit> (switching) is not available here", async () => {
    await threeCommits();
    const r = await pair.ours.git(["checkout", "HEAD~1"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe("git checkout HEAD~1: not available here: this project's repository has one branch, main. To bring files back from a commit: git checkout <commit> -- <path>.\n");
  });

  it("revert: a commit in the middle, -n, and a dirty file", async () => {
    await threeCommits();
    pair.tick(600);
    await same(["revert", "--no-edit", "HEAD~1"]);
    expect((await pair.heads()).ours).toBe((await pair.heads()).real);
    await same(["log", "--format=%s%n%b"]);
    pair.tick(600);
    await same(["revert", "-n", "HEAD~3"]);
    await same(["status", "-s"]);
    await same(["reset", "-q"]);
    await same(["checkout", "--", "."]);
    pair.write({ "index.html": "dirty\n" });
    // HEAD~2 is "Add the cart", already reverted: nothing to commit.
    await same(["revert", "--no-edit", "HEAD~2"]);
    // HEAD~1 ("Shout g") touches index.html, which is dirty.
    await same(["revert", "--no-edit", "HEAD~1"]);
  });

  it("revert of the commit that created a file changed since: git's modify/delete conflict, word for word", async () => {
    pair = new Pair();
    await pair.start({ "index.html": "home\n" });
    pair.tick(600);
    pair.write({ "page.html": "p1\n" });
    await pair.both(["add", "page.html"]);
    await pair.both(["commit", "-q", "-m", "Add the page"]);
    pair.tick(600);
    pair.write({ "page.html": "p2\n" });
    await pair.both(["commit", "-qam", "Change the page"]);
    const ours = await pair.ours.git(["revert", "--no-edit", "HEAD~1"]);
    const real = pair.real.git(["revert", "--no-edit", "HEAD~1"]);
    expect(ours.exitCode).toBe(real.exitCode);
    expect(ours.stdout).toBe(real.stdout);
    expect(ours.stderr.split("\n")[0]).toBe(real.stderr.split("\n")[0]);
    expect(ours.write).toBeUndefined();
  });

  it("revert with a conflict changes nothing here (git would leave markers)", async () => {
    await threeCommits();
    pair.tick(600);
    pair.write({ "index.html": SITE["index.html"].replace("<h1>Uno</h1>", "<h1>Tres</h1>").replace("<p>g</p>", "<p>G</p>") });
    await pair.both(["commit", "-qam", "Title three"]);
    const before = pair.snapshots().ours;
    const ours = await pair.ours.git(["revert", "--no-edit", "HEAD~3"]);
    const real = pair.real.git(["revert", "--no-edit", "HEAD~3"]);
    expect(real.exitCode).toBe(1);
    expect(real.stdout).toContain("CONFLICT (content): Merge conflict in index.html");
    expect(ours.exitCode).toBe(1);
    expect(ours.stdout).toBe("Auto-merging index.html\nCONFLICT (content): Merge conflict in index.html\n");
    expect(ours.stderr.split("\n")[0]).toBe(real.stderr.split("\n")[0]);
    expect(ours.stderr).toContain(REVERT_CONFLICT_NOTE);
    expect(pair.snapshots().ours).toEqual(before);
    expect(ours.write).toBeUndefined();
  });
});
