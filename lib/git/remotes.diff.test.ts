// @vitest-environment node
// git remote, fetch, pull and push in OpenLen's git (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8),
// against the real git 2.45.2. Both use ONE URL on the same `git http-backend` server, which serves each its own bare
// repository (by User-Agent), so even a commit that carries the URL — a pull's merge — is the same on both sides.
// What "someone else" pushes is made once and pushed to both repositories.
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GitHttpServer } from "./test-support/http-backend";
import { Pair } from "./test-support/pair";
import type { GitOutput } from "./test-support/real-git";

let server: GitHttpServer;
let pair: Pair;

beforeEach(async () => {
  server = new GitHttpServer();
  server.splitByAgent = true;
  await server.start();
  server.bare("site", "real");
  server.bare("site", "ours");
  pair = new Pair();
  await pair.start({ "index.html": "<h1>Hola</h1>\n<p>uno</p>\n<p>dos</p>\n" });
  pair.real.git(["config", "pull.rebase", "false"]);
});
afterEach(async () => {
  pair.dispose();
  await server.dispose();
});

/** The same command on both sides; `{url}` in an argument is the remote's URL. */
async function same(args: readonly string[]): Promise<void> {
  const real: GitOutput = await pair.real.remoteGit(args.map((a) => a.replace("{url}", server.url("site"))));
  const ours = await pair.ours.git(args.map((a) => a.replace("{url}", server.url("site"))));
  expect({ stdout: ours.stdout, stderr: ours.stderr, exitCode: ours.exitCode }, args.join(" ")).toEqual(real);
}
async function sameHeads(): Promise<void> {
  const h = await pair.heads();
  expect(h.ours).toBe(h.real);
}
function sameFiles(): void {
  const s = pair.snapshots();
  expect(s.ours).toEqual(s.real);
}

/** "Someone else": a clone of the real side's remote, a commit there, pushed to both sides' repositories. */
async function someoneElsePushes(files: Readonly<Record<string, string>>, message: string): Promise<void> {
  const dir = path.join(server.root, `other-${Math.random().toString(36).slice(2)}`);
  expect((await server.remoteGit(["clone", "-q", server.url("site"), dir])).exitCode).toBe(0);
  for (const [p, c] of Object.entries(files)) writeFileSync(path.join(dir, p), c);
  server.git(["add", "-A"], dir);
  server.git(["-c", "user.name=Otra", "-c", "user.email=otra@x", "commit", "-q", "-m", message], dir);
  expect((await server.remoteGit(["push", "-q", "origin", "HEAD:main"], dir)).exitCode).toBe(0);
  expect(server.git(["push", "-q", path.join(server.root, "ours", "site.git"), "HEAD:main"], dir).exitCode).toBe(0);
}

// Each test talks HTTP a few dozen times on both sides: more than vitest's 5 s.
describe("remotes, against the real git", { timeout: 60_000 }, () => {
  it("🔴 remote add, -v, push without and with -u, push again, status and branch -vv", async () => {
    await same(["remote", "add", "origin", "{url}"]);
    await same(["remote"]);
    await same(["remote", "-v"]);
    await same(["remote", "get-url", "origin"]);
    await same(["remote", "add", "origin", "{url}"]);
    await same(["remote", "remove", "nope"]);
    await same(["push"]);
    await same(["push", "-u", "origin", "main"]);
    await same(["push"]);
    await same(["status"]);
    await same(["status", "-sb"]);
    await same(["branch", "-vv"]);
    await same(["branch", "-a"]);
    await same(["branch", "-r"]);
    await same(["log", "--oneline", "--decorate", "--all"]);
  });

  it("🔴 someone else pushes: fetch, status behind, pull fast-forwards; the same files and commits", async () => {
    await same(["remote", "add", "origin", "{url}"]);
    await same(["push", "-u", "origin", "main"]);
    await someoneElsePushes({ "index.html": "<h1>Hola</h1>\n<p>uno de otra</p>\n<p>dos</p>\n", "nuevo.txt": "n\n" }, "de otra");
    await same(["fetch"]);
    await same(["status"]);
    await same(["status", "-sb"]);
    await same(["log", "--oneline", "--decorate", "--all"]);
    await same(["pull"]);
    await sameHeads();
    sameFiles();
    await same(["status"]);
    await same(["fetch"]);
  });

  it("🔴 push rejected (fetch first, then non-fast-forward), status diverged, pull merges, push goes", async () => {
    await same(["remote", "add", "origin", "{url}"]);
    await same(["push", "-u", "origin", "main"]);
    await someoneElsePushes({ "otro.txt": "o\n" }, "otro");
    pair.tick();
    pair.write({ "mio.txt": "m\n" });
    await same(["add", "-A"]);
    await same(["commit", "-m", "mío"]);
    await same(["push"]);
    await same(["status"]);
    await same(["fetch"]);
    await same(["status"]);
    await same(["branch", "-vv"]);
    await same(["push"]);
    pair.tick();
    await same(["pull"]);
    await sameHeads();
    sameFiles();
    await same(["log", "-1", "--format=%s%n%P"]);
    await same(["status"]);
    await same(["push"]);
    await same(["status"]);
  });

  it("🔴 pull with a conflict: git's markers (the fetched commit's id), then add, commit and push", async () => {
    await same(["remote", "add", "origin", "{url}"]);
    await same(["push", "-u", "origin", "main"]);
    await someoneElsePushes({ "index.html": "<h1>Hola</h1>\n<p>uno de otra</p>\n<p>dos</p>\n" }, "de otra");
    pair.tick();
    pair.write({ "index.html": "<h1>Hola</h1>\n<p>uno mío</p>\n<p>dos</p>\n" });
    await same(["commit", "-am", "mío"]);
    pair.tick();
    await same(["pull"]);
    sameFiles();
    await same(["status"]);
    pair.write({ "index.html": "<h1>Hola</h1>\n<p>uno de las dos</p>\n<p>dos</p>\n" });
    await same(["add", "index.html"]);
    await same(["commit", "--no-edit"]);
    await sameHeads();
    await same(["push"]);
  });

  it("a branch without upstream: push and pull say so; push -u and pull origin <branch> work", async () => {
    await same(["remote", "add", "origin", "{url}"]);
    await same(["push", "-u", "origin", "main"]);
    await same(["switch", "-c", "nueva"]);
    await same(["push"]);
    await same(["pull"]);
    pair.tick();
    pair.write({ "n.txt": "n\n" });
    await same(["add", "-A"]);
    await same(["commit", "-m", "n"]);
    await same(["push", "-u", "origin", "nueva"]);
    await same(["branch", "-vv"]);
    await someoneElsePushes({ "otro.txt": "o\n" }, "otro");
    pair.tick();
    await same(["pull", "origin", "main"]);
    await sameHeads();
    sameFiles();
    await same(["push", "origin", "--delete", "nueva"]);
    await same(["branch", "-vv"]);
  });

  it("🔴 a remote that wants credentials: without them git's message; with the server's token it works", async () => {
    await same(["remote", "add", "origin", "{url}"]);
    server.requireAuth = "x-access-token:secreto";
    await same(["fetch"]);
    await same(["push", "-u", "origin", "main"]);
    pair.ours.remoteAuth = async () => "x-access-token:secreto";
    const pushed = await pair.ours.git(["push", "-u", "origin", "main"]);
    expect(pushed.exitCode, pushed.stderr).toBe(0);
    // The token is never in what git shows or keeps.
    expect((await pair.ours.git(["remote", "-v"])).stdout).not.toContain("secreto");
    expect(JSON.stringify(await pair.ours.store.readRepo())).not.toContain("secreto");
  });

  it("🔴 remote add refuses what OpenLen's server must not reach or keep", async () => {
    for (const bad of ["http://10.0.0.1/x.git", "https://localhost/x.git", "ssh://git@github.com/a/b.git", "git@github.com:a/b.git", "file:///etc/x.git", "http://github.com/a/b.git", "https://user:pass@github.com/a/b.git"]) {
      const r = await pair.ours.git(["remote", "add", "origin", bad]);
      expect(r.exitCode, bad).toBe(128);
      expect(r.stderr, bad).toMatch(/^fatal: /);
    }
    expect((await pair.ours.git(["remote"])).stdout).toBe("");
  });
});
