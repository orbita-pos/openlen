// Where a project's repository lives: its objects, its branches, the index and its remotes (spec §2; spec local
// 2026-10-28-ficheros-al-nivel-de-claude-code, §8).
import type { GitObject } from "./objects";

/** The staging area: repository path (no leading "/") → blob oid. Every file is 100644. */
export type Index = Readonly<Record<string, string>>;

export interface RepoState {
  /** The commit the current branch points at. */
  readonly head: string;
  readonly index: Index;
  /** Bumped on every write: the compare-and-swap token. */
  readonly version: number;
  /** The checked-out branch. */
  readonly branch: string;
  /** Every local branch → its commit, the current one included. */
  readonly refs: Readonly<Record<string, string>>;
  /** A merge in progress (git's MERGE_HEAD and MERGE_MSG), or null. */
  readonly merge: MergeState | null;
  /** Branches checked out in ANOTHER worktree → where (lib/git/worktree-store.ts): git won't switch to them. */
  readonly elsewhere?: Readonly<Record<string, string>>;
  /** The remotes by name (`origin`), each with its remote-tracking branches (`refs/remotes/origin/*`). */
  readonly remotes: Readonly<Record<string, Remote>>;
  /** Each local branch's upstream (git's branch.<name>.remote and .merge). */
  readonly upstreams: Readonly<Record<string, Upstream>>;
}

/** How a path stayed unmerged, as `git status --short` writes it: both modified, both added, deleted by them, deleted
 *  by us. */
export type ConflictKind = "UU" | "AA" | "UD" | "DU";

export interface MergeState {
  /** The commit being merged in: the merge commit's second parent. */
  readonly theirs: string;
  /** What `git commit --no-edit` writes. */
  readonly message: string;
  /** The paths still unmerged; `git add` marks one resolved. */
  readonly conflicts: Readonly<Record<string, ConflictKind>>;
}

export interface Remote {
  /** Never with credentials: a token is the server's, given per request. */
  readonly url: string;
  /** The remote's branches as last fetched or pushed: name → commit. */
  readonly refs: Readonly<Record<string, string>>;
}

export interface Upstream {
  readonly remote: string;
  /** The branch on the remote ("main", not "refs/heads/main"). */
  readonly branch: string;
}

/** What a write changes besides the current branch's commit and the index; what it leaves out stays as it is. */
export interface RepoChanges {
  /** The branch checked out after the write. */
  readonly branch?: string;
  /** Every local branch (the current one is set to the new head anyway). */
  readonly refs?: Readonly<Record<string, string>>;
  /** The merge in progress; null ends it. */
  readonly merge?: MergeState | null;
  readonly remotes?: Readonly<Record<string, Remote>>;
  readonly upstreams?: Readonly<Record<string, Upstream>>;
}

/** A write's state from the one before it and its changes. */
export function applyChanges(before: RepoState, head: string, index: Index, version: number, c: RepoChanges = {}): RepoState {
  const branch = c.branch ?? before.branch;
  return {
    head,
    index,
    version,
    branch,
    refs: { ...(c.refs ?? before.refs), [branch]: head },
    merge: c.merge === undefined ? before.merge : c.merge,
    remotes: c.remotes ?? before.remotes,
    upstreams: c.upstreams ?? before.upstreams,
  };
}

export interface GitStore {
  readRepo(): Promise<RepoState | null>;
  /** Creates the repository; if another call created it first, returns that one. */
  createRepo(head: string, index: Index): Promise<RepoState>;
  /** The objects that exist, by oid. Missing ones are simply absent from the map. */
  readObjects(oids: readonly string[]): Promise<ReadonlyMap<string, GitObject>>;
  /** Objects are immutable: writing one that already exists does nothing. */
  writeObjects(objects: readonly GitObject[]): Promise<void>;
  /** Up to two oids starting with `prefix`: two is enough to call it ambiguous. */
  findByPrefix(prefix: string): Promise<readonly string[]>;
  /** Compare-and-swap of the current branch's commit, the index and `changes`: `null` if someone wrote first. */
  updateRepo(expectedVersion: number, head: string, index: Index, changes?: RepoChanges): Promise<RepoState | null>;
}
