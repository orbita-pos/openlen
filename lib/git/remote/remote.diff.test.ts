// @vitest-environment node
// git's smart HTTP protocol from OpenLen's server (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8), against
// `git http-backend` 2.45.2: ls-refs gives what `git ls-remote` gives, fetch brings what `git rev-list --objects` lists
// (also from a repacked remote, full of deltas), receive-pack updates a branch and the remote stays clean under
// `git fsck`, a remote that denies non-fast-forwards says so, and a private address or a wrong password is refused.
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encodeCommit, encodeTree, makeObject, utf8, type GitObject } from "../objects";
import { GitHttpServer } from "../test-support/http-backend";

import { RemoteError, fetchPack, lsRefs, receivePack } from "./smart-http";

let server: GitHttpServer;
let work: string;

beforeAll(async () => {
  server = new GitHttpServer();
  await server.start();
  server.bare("site");
  work = path.join(server.root, "work");
  expect((await server.remoteGit(["clone", "-q", server.url("site"), work])).exitCode).toBe(0);
  const lines = Array.from({ length: 120 }, (_, i) => `linea ${i}\n`);
  for (let k = 0; k < 5; k++) {
    lines[k * 20] = `cambio ${k}\n`;
    server.git(["-c", "core.autocrlf=false", "commit", "-q", "--allow-empty", "-m", `vacío ${k}`], work);
    writeFileSync(path.join(work, "f.txt"), lines.join(""));
    server.git(["add", "-A"], work);
    server.git(["commit", "-q", "-m", `c${k}`], work);
  }
  server.git(["branch", "otra", "HEAD~2"], work);
  server.git(["tag", "-a", "v1", "-m", "uno", "HEAD~1"], work);
  expect((await server.remoteGit(["push", "-q", "origin", "main", "otra", "v1"], work)).exitCode).toBe(0);
});
afterAll(() => server.dispose());

async function lsRemote(): Promise<string[]> {
  return (await server.remoteGit(["ls-remote", server.url("site")])).stdout.trim().split("\n");
}
function revListObjects(): string[] {
  return server.git(["rev-list", "--objects", "--all"], path.join(server.root, "site.git")).stdout.trim().split("\n").map((l) => l.split(" ")[0]!).sort();
}

describe("smart HTTP, against git http-backend", () => {
  it("🔴 ls-refs (protocol v2) gives what git ls-remote gives, HEAD's symref and the peeled tag included", async () => {
    const refs = await lsRefs(server.url("site"), null);
    const lines = refs.flatMap((r) => [`${r.oid}\t${r.name}`, ...(r.peeled ? [`${r.peeled}\t${r.name}^{}`] : [])]);
    expect(lines.sort()).toEqual((await lsRemote()).sort());
    expect(refs.find((r) => r.name === "HEAD")?.symref).toBe("refs/heads/main");
  });

  it("🔴 fetch brings every object git rev-list --objects lists, each hashing to its oid", async () => {
    const refs = await lsRefs(server.url("site"), null);
    const objects = await fetchPack(server.url("site"), null, { wants: [...new Set(refs.map((r) => r.oid))], haves: [] });
    expect([...new Set(objects.map((o) => o.oid))].sort()).toEqual(revListObjects());
  });

  it("🔴 from a repacked remote (git repack -adf: deltas everywhere) the same objects", async () => {
    expect(server.git(["repack", "-adf", "-q"], path.join(server.root, "site.git")).exitCode).toBe(0);
    const refs = await lsRefs(server.url("site"), null);
    const objects = await fetchPack(server.url("site"), null, { wants: [...new Set(refs.map((r) => r.oid))], haves: [] });
    expect([...new Set(objects.map((o) => o.oid))].sort()).toEqual(revListObjects());
  });

  it("with haves, only what the remote has beyond them", async () => {
    const refs = await lsRefs(server.url("site"), null);
    const main = refs.find((r) => r.name === "refs/heads/main")!.oid;
    const otra = refs.find((r) => r.name === "refs/heads/otra")!.oid;
    const objects = await fetchPack(server.url("site"), null, { wants: [main], haves: [otra] });
    const expected = server.git(["rev-list", "--objects", main, `^${otra}`], path.join(server.root, "site.git")).stdout.trim().split("\n").map((l) => l.split(" ")[0]!);
    for (const oid of expected) expect(objects.some((o) => o.oid === oid)).toBe(true);
    expect(objects.some((o) => o.oid === otra)).toBe(false);
  });

  it("🔴 receive-pack moves a branch with the objects we send; git fsck of the remote is clean", async () => {
    const refs = await lsRefs(server.url("site"), null);
    const main = refs.find((r) => r.name === "refs/heads/main")!.oid;
    const parentTree = server.git(["rev-parse", `${main}^{tree}`], path.join(server.root, "site.git")).stdout.trim();
    const blob = makeObject("blob", utf8("desde OpenLen\n"));
    // A tree with the new file next to f.txt: read the parent's entries back from the remote.
    const fTxt = server.git(["rev-parse", `${main}:f.txt`], path.join(server.root, "site.git")).stdout.trim();
    const tree = makeObject("tree", encodeTree([{ mode: "100644", name: "f.txt", oid: fTxt }, { mode: "100644", name: "nuevo.txt", oid: blob.oid }]));
    const sig = { name: "Ana", email: "ana@users.noreply.openlen.com", timestamp: 1_760_500_000, timezone: "+0000" };
    const commit = makeObject("commit", encodeCommit({ tree: tree.oid, parents: [main], author: sig, committer: sig, message: "desde OpenLen\n" }));
    expect(parentTree).not.toBe(tree.oid);
    const objects: GitObject[] = [blob, tree, commit];
    const r = await receivePack(server.url("site"), null, { updates: [{ ref: "refs/heads/main", old: main, new: commit.oid }], objects });
    expect(r).toEqual({ ok: true, refs: [{ ref: "refs/heads/main", status: "ok" }] });
    const bare = path.join(server.root, "site.git");
    expect(server.git(["rev-parse", "refs/heads/main"], bare).stdout.trim()).toBe(commit.oid);
    const fsck = server.git(["fsck", "--full", "--strict"], bare);
    expect(fsck.exitCode, fsck.stderr).toBe(0);
    // A new branch, created from nothing.
    const created = await receivePack(server.url("site"), null, { updates: [{ ref: "refs/heads/nueva", old: "0".repeat(40), new: commit.oid }], objects: [] });
    expect(created.ok).toBe(true);
    expect(server.git(["rev-parse", "refs/heads/nueva"], bare).stdout.trim()).toBe(commit.oid);
  });

  it("a remote that denies non-fast-forwards: the ref's status says non-fast-forward, nothing moves", async () => {
    const bare = path.join(server.root, "site.git");
    server.git(["config", "receive.denyNonFastForwards", "true"], bare);
    const main = server.git(["rev-parse", "refs/heads/main"], bare).stdout.trim();
    const otra = server.git(["rev-parse", "refs/heads/otra"], bare).stdout.trim();
    const r = await receivePack(server.url("site"), null, { updates: [{ ref: "refs/heads/main", old: main, new: otra }], objects: [] });
    expect(r).toEqual({ ok: false, refs: [{ ref: "refs/heads/main", status: "non-fast-forward" }] });
    expect(server.git(["rev-parse", "refs/heads/main"], bare).stdout.trim()).toBe(main);
  });

  it("🔴 with Basic auth: the right token passes, none or a wrong one is a 401", async () => {
    server.requireAuth = "x-access-token:secreto";
    try {
      await expect(lsRefs(server.url("site"), null)).rejects.toMatchObject({ kind: "auth" });
      await expect(lsRefs(server.url("site"), "x-access-token:otro")).rejects.toBeInstanceOf(RemoteError);
      expect((await lsRefs(server.url("site"), "x-access-token:secreto")).length).toBeGreaterThan(0);
    } finally {
      server.requireAuth = null;
    }
  });

  it("🔴 a private address is refused before any request; so is a repository that isn't there", async () => {
    await expect(lsRefs("http://10.0.0.1/x.git", null)).rejects.toMatchObject({ kind: "blocked" });
    await expect(lsRefs("http://localhost:1/x.git", null)).rejects.toMatchObject({ kind: "blocked" });
    await expect(lsRefs(server.url("noexiste"), null)).rejects.toMatchObject({ kind: "not-found" });
  });
});
