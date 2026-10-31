// A worktree's repository (spec local 2026-10-30-len-watch, §5.5): the parent's objects and branches, its own HEAD
// and index — what `git worktree add` gives, run through the real git commands.
import { describe, expect, it } from "vitest";

import { memoryStore } from "./memory-store";
import { ensureRepository, runGit } from "./run";
import type { GitStore } from "./store";
import { workingTree } from "./worktree";
import { worktreeStore } from "./worktree-store";

const ANA = { name: "Ana", email: "ana@users.noreply.openlen.app" };
const NOW = new Date("2026-10-30T12:00:00Z");
const BRANCH = "len-watch/i1";

/** A parent at its Initial commit with BRANCH pointing at it, and a worktree checked out on BRANCH. */
async function setup(files: Record<string, string>) {
  const parent = memoryStore();
  const repo = await ensureRepository(parent, workingTree(files), ANA, NOW);
  await parent.updateRepo(repo.version, repo.head, repo.index, { refs: { ...repo.refs, [BRANCH]: repo.head } });
  const own = memoryStore();
  const born = await own.createRepo(repo.head, repo.index);
  await own.updateRepo(born.version, born.head, born.index, { branch: BRANCH });
  return { parent, own, wt: worktreeStore(parent, own, "p-parent"), base: repo.head };
}

const git = (store: GitStore, files: Record<string, string>, args: string[]) =>
  runGit({ store, files, cwd: "/", identity: ANA, owner: ANA, now: () => NOW }, args);

describe("worktreeStore", () => {
  it("a commit in the worktree moves its branch in the parent and nothing else of the parent", async () => {
    const { parent, wt } = await setup({ "/index.html": "v1" });
    const before = (await parent.readRepo())!;
    const fixed = { "/index.html": "v2" };
    expect((await git(wt, fixed, ["add", "-A"])).exitCode).toBe(0);
    expect((await git(wt, fixed, ["commit", "-m", "Fix"])).exitCode).toBe(0);
    const tip = (await wt.readRepo())!.head;
    const after = (await parent.readRepo())!;
    expect(tip).not.toBe(before.head);
    expect(after.refs[BRANCH]).toBe(tip);
    expect([after.head, after.branch, after.index, after.refs.main]).toEqual([before.head, before.branch, before.index, before.refs.main]);
  });

  it("objects written in the worktree are read from the parent", async () => {
    const { parent, wt } = await setup({ "/index.html": "v1" });
    const fixed = { "/index.html": "v2" };
    await git(wt, fixed, ["add", "-A"]);
    await git(wt, fixed, ["commit", "-m", "Fix"]);
    const tip = (await wt.readRepo())!.head;
    expect((await parent.readObjects([tip])).has(tip)).toBe(true);
  });

  // Real git 2.45.2, a linked worktree switching to the main worktree's branch (both commands, exit 128).
  it("🔴 the branch the owner's working copy has checked out is refused, as git does", async () => {
    const { wt } = await setup({ "/index.html": "v1" });
    for (const args of [["switch", "main"], ["checkout", "main"]]) {
      expect(await git(wt, { "/index.html": "v1" }, args)).toMatchObject({ stdout: "", stderr: "fatal: 'main' is already used by worktree at 'p-parent'\n", exitCode: 128 });
    }
    expect((await wt.readRepo())!.branch).toBe(BRANCH);
  });

  it("git branch in the worktree lists the parent's branches and marks its own", async () => {
    const { wt } = await setup({ "/index.html": "v1" });
    expect((await git(wt, { "/index.html": "v1" }, ["branch"])).stdout).toBe(`* ${BRANCH}\n  main\n`);
  });

  it("a branch the parent made while the worktree worked survives the worktree's commit", async () => {
    const { parent, wt } = await setup({ "/index.html": "v1" });
    const p = (await parent.readRepo())!;
    await parent.updateRepo(p.version, p.head, p.index, { refs: { ...p.refs, other: p.head } });
    const fixed = { "/index.html": "v2" };
    await git(wt, fixed, ["add", "-A"]);
    await git(wt, fixed, ["commit", "-m", "Fix"]);
    expect((await parent.readRepo())!.refs.other).toBe(p.head);
  });
});
