// A WORKTREE'S REPOSITORY (spec local 2026-10-30-len-watch, §5.5): what `git worktree add` gives — the main
// repository's objects, branches, remotes and upstreams, with the worktree's own HEAD, index and merge in progress
// (git keeps those under .git/worktrees/<name>/). Len Watch fixes a crash in one, on its branch `len-watch/<incident>`.
import type { GitStore, RepoChanges, RepoState } from "./store";

/** How many times a branch move is retried when the parent was written meanwhile. */
const PARENT_RETRIES = 5;

export function worktreeStore(parent: GitStore, own: GitStore): GitStore {
  // The branches the last read showed: a write's `refs` is the whole set, so what changed is told against it.
  let seenRefs: Readonly<Record<string, string>> = {};

  async function moveParentRefs(branch: string, head: string, changes: RepoChanges | undefined): Promise<void> {
    const delta: Record<string, string | undefined> = {};
    if (changes?.refs) {
      for (const name of new Set([...Object.keys(seenRefs), ...Object.keys(changes.refs)])) {
        if (changes.refs[name] !== seenRefs[name]) delta[name] = changes.refs[name];
      }
    }
    delta[branch] = head;
    for (let i = 0; i < PARENT_RETRIES; i++) {
      const p = await parent.readRepo();
      if (!p) return;
      const refs: Record<string, string> = { ...p.refs };
      for (const [name, oid] of Object.entries(delta)) {
        if (oid === undefined) delete refs[name];
        else refs[name] = oid;
      }
      const written = await parent.updateRepo(p.version, p.head, p.index, {
        refs,
        ...(changes?.remotes ? { remotes: changes.remotes } : {}),
        ...(changes?.upstreams ? { upstreams: changes.upstreams } : {}),
      });
      if (written) return;
    }
    console.warn(`[git] the worktree's branch ${branch} could not be moved in the parent repository`);
  }

  return {
    async readRepo(): Promise<RepoState | null> {
      const mine = await own.readRepo();
      if (!mine) return null;
      const p = await parent.readRepo();
      const view: RepoState = {
        ...mine,
        refs: { ...(p?.refs ?? {}), [mine.branch]: mine.head },
        remotes: p?.remotes ?? {},
        upstreams: p?.upstreams ?? {},
      };
      seenRefs = view.refs;
      return view;
    },
    async createRepo(): Promise<RepoState> {
      throw new Error("a worktree is born with its branch (lib/len-watch/worktree.ts), never by git");
    },
    readObjects: (oids) => parent.readObjects(oids),
    writeObjects: (objects) => parent.writeObjects(objects),
    findByPrefix: (prefix) => parent.findByPrefix(prefix),
    async updateRepo(expectedVersion, head, index, changes) {
      const written = await own.updateRepo(expectedVersion, head, index, {
        ...(changes?.branch !== undefined ? { branch: changes.branch } : {}),
        ...(changes?.merge !== undefined ? { merge: changes.merge } : {}),
      });
      if (!written) return null;
      await moveParentRefs(written.branch, head, changes);
      return this.readRepo();
    },
  };
}
