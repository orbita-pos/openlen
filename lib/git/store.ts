// Where a project's repository lives: its objects, `main` and the index (spec §2).
import type { GitObject } from "./objects";

/** The staging area: repository path (no leading "/") → blob oid. Every file is 100644. */
export type Index = Readonly<Record<string, string>>;

export interface RepoState {
  /** The commit the current branch points at. */
  readonly head: string;
  readonly index: Index;
  /** Bumped on every write: the compare-and-swap token. */
  readonly version: number;
  /** The checked-out branch (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8). */
  readonly branch: string;
  /** Every local branch → its commit, the current one included. */
  readonly refs: Readonly<Record<string, string>>;
}

/** A write that moves between branches or changes them: the branch checked out after it, and every branch. */
export interface Branching {
  readonly branch: string;
  readonly refs: Readonly<Record<string, string>>;
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
  /** Compare-and-swap of the current branch's commit and the index (and, with `branching`, of which branch is
   *  checked out and every branch): `null` if someone wrote first. */
  updateRepo(expectedVersion: number, head: string, index: Index, branching?: Branching): Promise<RepoState | null>;
}
