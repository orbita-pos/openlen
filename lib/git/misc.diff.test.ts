// @vitest-environment node
// blame, grep, the small commands and the ones that aren't here, against the real git.
import { afterEach, describe, expect, it } from "vitest";
import { Pair } from "./test-support/pair";

let pair: Pair;
afterEach(() => pair?.dispose());
async function same(args: readonly string[], cwd?: string): Promise<void> {
  const { real, ours } = await pair.both(args, cwd ? { cwd } : {});
  expect(ours).toEqual(real);
}

async function history(): Promise<void> {
  pair = new Pair();
  await pair.start({ "index.html": "<h1>Hola</h1>\n<p>uno</p>\n<p>dos</p>\n", "src/App.tsx": "export function App() {\n  return <Cart />;\n}\n", "src/cart.ts": "export const cart = [];\n" });
  pair.tick(3600);
  pair.write({ "index.html": "<h1>Hola</h1>\n<p>UNO</p>\n<p>dos</p>\n<p>tres</p>\n" });
  await pair.both(["commit", "-qam", "Louder one, add three"]);
}

describe("blame and grep, against the real git", () => {
  it("blame: the file, -s, -L, -e, a commit, a missing file", async () => {
    await history();
    for (const args of [["blame", "index.html"], ["blame", "-s", "index.html"], ["blame", "-L", "2,3", "index.html"], ["blame", "-e", "index.html"], ["blame", "HEAD~1", "index.html"], ["blame", "--", "index.html"], ["blame", "nope.txt"]]) {
      await same(args);
    }
    await same(["blame", "App.tsx"], "src");
  });

  it("blame: lines not committed yet (the date is the clock's)", async () => {
    await history();
    pair.write({ "index.html": "<h1>Hola</h1>\n<p>UNO</p>\n<p>cambiado</p>\n<p>tres</p>\n" });
    const { real, ours } = await pair.both(["blame", "index.html"]);
    const clock = /Not Committed Yet \d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d{4}/g;
    expect(ours.stdout.replace(clock, "NOW")).toBe(real.stdout.replace(clock, "NOW"));
  });

  it("grep: patterns, flags, a commit, the cwd as scope, no match", async () => {
    await history();
    for (const args of [["grep", "uno"], ["grep", "-n", "-i", "uno"], ["grep", "-l", "export"], ["grep", "-c", "p>"], ["grep", "-w", "cart"], ["grep", "-E", "UNO|dos"], ["grep", "-F", "<p>"], ["grep", "-e", "uno", "-e", "tres"], ["grep", "uno", "HEAD~1"], ["grep", "-v", "p>", "--", "index.html"], ["grep", "nothing-here"], ["grep", "-q", "UNO"], ["grep", "Cart+"], ["grep", "Cart\\+"]]) {
      await same(args);
    }
    await same(["grep", "-n", "cart"], "src");
  });
});

describe("the small commands, against the real git", () => {
  it("ls-files, rev-parse, branch, config, init, remote", async () => {
    await history();
    pair.write({ "new.txt": "n\n", "src/App.tsx": "changed\n" });
    for (const args of [["ls-files"], ["ls-files", "-m"], ["ls-files", "-o", "--exclude-standard"], ["rev-parse", "HEAD"], ["rev-parse", "--short", "HEAD"], ["rev-parse", "--abbrev-ref", "HEAD"], ["rev-parse", "HEAD~1"], ["rev-parse", "--is-inside-work-tree"], ["rev-parse", "nope"], ["branch"], ["branch", "--show-current"], ["branch", "-v"], ["config", "user.name"], ["config", "user.email"], ["config", "--get", "user.name"], ["remote"], ["remote", "-v"]]) {
      await same(args);
    }
    await same(["ls-files"], "src");
    await same(["rev-parse", "--show-prefix"], "src");
  });

  it("push, pull and fetch say what git says with no remote", async () => {
    await history();
    await same(["push"]);
    await same(["fetch"]);
    await same(["pull"]);
  });

  it("not a git command, and the ones that aren't here", async () => {
    await history();
    await same(["frobnicate"]);
    const stash = await pair.ours.git(["stash"]);
    expect(stash).toEqual({ stdout: "", stderr: "git stash: not available here: this project's repository keeps no stash; to set changes aside, commit them.\n", exitCode: 1 });
    expect((await pair.ours.git(["branch", "feature"])).stderr).toMatch(/^git branch feature: not available here: /);
    expect((await pair.ours.git(["config", "user.name", "X"])).stderr).toMatch(/^git config: not available here: /);
    expect((await pair.ours.git(["init"])).stdout).toBe("Reinitialized existing Git repository in /.git/\n");
    expect((await pair.ours.git(["rev-parse", "--show-toplevel"])).stdout).toBe("/\n");
  });
});
