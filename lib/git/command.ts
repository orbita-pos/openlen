// What a git subcommand gets and gives back.
import type { Signature } from "./objects";
import type { Repository } from "./repository";
import type { Branching, GitStore, Index, MergeState, RepoState } from "./store";
import type { WorkingTree } from "./worktree";

export interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

/** Who signs, and when: OpenLen always writes UTC. */
export function signatureOf(who: GitIdentity, now: Date): Signature {
  return { name: who.name, email: who.email, timestamp: Math.floor(now.getTime() / 1000), timezone: "+0000" };
}

export interface GitRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** Files the command changes in the working tree, by absolute path; `null` deletes. The
   *  terminal saves them through Write's checks, like anything a command writes. */
  readonly write?: Readonly<Record<string, string | null>>;
}

export interface GitRunInput {
  readonly store: GitStore;
  /** The terminal's files, absolute paths, as they are now. */
  readonly files: Readonly<Record<string, string>>;
  /** The terminal's working directory ("/", "/src"). */
  readonly cwd: string;
  /** Who runs the command: the author of what it commits. */
  readonly identity: GitIdentity;
  /** The project's owner: the author of the "Initial commit". */
  readonly owner: GitIdentity;
  readonly now: () => Date;
  /** Why the terminal won't delete a file (absolute path), or null if it can. A revert that would
   *  delete such a file is refused whole: the history must not say a page is gone while it stays. */
  readonly undeletable?: (absolutePath: string) => string | null;
}

export interface CommandContext {
  readonly repo: Repository;
  readonly state: RepoState;
  readonly tree: WorkingTree;
  /** The terminal's files as they came, /tmp included (`commit -F /tmp/msg.txt`). */
  readonly absoluteFiles: Readonly<Record<string, string>>;
  /** The cwd as a repository folder: "" is the root. */
  readonly cwd: string;
  readonly identity: GitIdentity;
  readonly now: Date;
  /** See GitRunInput.undeletable. */
  readonly undeletable?: (absolutePath: string) => string | null;
  /** Compare-and-swap of the current branch's commit and the index (and with `branching`, the branches): false if
   *  someone wrote the repository first. `merge`: undefined keeps the merge in progress, null ends it. */
  save(head: string, index: Index, branching?: Branching, merge?: MergeState | null): Promise<boolean>;
}

export type Command = (ctx: CommandContext, args: readonly string[]) => Promise<GitRunResult>;
