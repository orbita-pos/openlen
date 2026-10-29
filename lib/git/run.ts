// `git …` as the binary reads it: global options, the repository created on first use with an
// "Initial commit" of the current files (spec §1), then the subcommand.
import { blobForContent } from "./content";
import path from "node:path";
import { signatureOf, type CommandContext, type GitIdentity, type GitRunInput, type GitRunResult } from "./command";
import { COMMANDS, NOT_AVAILABLE } from "./commands";
import { GitFatal, notAvailable } from "./errors";
import { encodeCommit, makeObject, type GitObject } from "./objects";
import { UnknownOption } from "./options";
import { repoDir } from "./paths";
import { Repository, buildTree } from "./repository";
import type { GitStore, RepoState } from "./store";
import { workingTree, type WorkingTree } from "./worktree";

const VERSION = "git version (OpenLen's own git: the subset its bash tool's description lists)\n";
const HELP =
  "usage: git [-C <path>] [-c <name>=<value>] [--no-pager] <command> [<args>]\n\n" +
  "OpenLen's git has: status, diff, log, show, blame, grep, ls-files, rev-parse, branch, config,\n" +
  "add, reset, restore, checkout, switch, commit, revert, init. Branches; no remote yet.\n";
/** The commands whose unknown options git reports as "unrecognized argument". */
const REVISION_COMMANDS = new Set(["log", "show", "diff"]);

/** The repository; if it doesn't exist yet, it's created with an "Initial commit" of the current files. */
export async function ensureRepository(store: GitStore, tree: WorkingTree, owner: GitIdentity, now: Date): Promise<RepoState> {
  const existing = await store.readRepo();
  if (existing) return existing;
  const index: Record<string, string> = {};
  const blobs: GitObject[] = [];
  for (const [p, content] of tree.files) {
    if (tree.isIgnored(p)) continue;
    const blob = blobForContent(content);
    blobs.push(blob);
    index[p] = blob.oid;
  }
  const { root, objects } = buildTree(index);
  const sig = signatureOf(owner, now);
  const commit = makeObject("commit", encodeCommit({ tree: root, parents: [], author: sig, committer: sig, message: "Initial commit\n" }));
  await store.writeObjects([...blobs, ...objects, commit]);
  return store.createRepo(commit.oid, index);
}

/** The first "usage:" line git prints for each command (git 2.45.2); the option list after it is
 *  the one deliberate difference (spec §4): it isn't reproduced. */
const USAGE: Readonly<Record<string, string>> = {
  status: "usage: git status [<options>] [--] [<pathspec>...]",
  add: "usage: git add [<options>] [--] <pathspec>...",
  commit: "usage: git commit [-a | --interactive | --patch] [-s] [-v] [-u<mode>] [--amend]",
  reset: "usage: git reset [--mixed | --soft | --hard | --merge | --keep] [-q] [<commit>]",
  restore: "usage: git restore [<options>] [--source=<branch>] <file>...",
  checkout: "usage: git checkout [<options>] <branch>",
  revert: "usage: git revert [--[no-]edit] [-n] [-m <parent-number>] [-s] [-S[<keyid>]] <commit>...",
  grep: "usage: git grep [<options>] [-e] <pattern> [<rev>...] [[--] <path>...]",
  blame: "usage: git blame [<options>] [<rev-opts>] [<rev>] [--] <file>",
  "ls-files": "usage: git ls-files [<options>] [<file>...]",
  branch: "usage: git branch [<options>] [-r | -a] [--merged] [--no-merged]",
  config: "usage: git config [<options>]",
  init: "usage: git init [-q | --quiet] [--bare] [--template=<template-directory>]",
  remote: "usage: git remote [-v | --verbose]",
  push: "usage: git push [<options>] [<repository> [<refspec>...]]",
  fetch: "usage: git fetch [<options>] [<repository> [<refspec>...]]",
  pull: "usage: git pull [<options>] [<repository> [<refspec>...]]",
  diff: "usage: git diff [<options>] [<commit>] [--] [<path>...]",
};

/** What git says for an option it doesn't know: each family has its own words. */
function unknownOption(sub: string, option: string): GitRunResult {
  if (REVISION_COMMANDS.has(sub) && sub !== "diff") return { stdout: "", stderr: `fatal: unrecognized argument: ${option}\n`, exitCode: 128 };
  const usage = USAGE[sub] ?? `usage: git ${sub} [<options>]`;
  if (sub === "diff") return { stdout: "", stderr: `error: invalid option: ${option}\n${usage}\n`, exitCode: 129 };
  if (sub === "revert") return { stdout: "", stderr: `${usage}\n`, exitCode: 129 };
  const name = option.startsWith("--") ? (sub === "blame" ? option : option.slice(2)) : option.slice(1);
  const first = option.startsWith("--") ? `error: unknown option \`${name}'` : `error: unknown switch \`${name}'`;
  return { stdout: "", stderr: `${first}\n${usage}\n`, exitCode: 129 };
}

export async function runGit(input: GitRunInput, argv: readonly string[]): Promise<GitRunResult> {
  const args = [...argv];
  let cwd = input.cwd;
  while (args[0]?.startsWith("-")) {
    const option = args.shift()!;
    if (option === "--no-pager" || option === "--no-optional-locks" || option === "-P" || option === "--literal-pathspecs") continue;
    if (option === "-C") {
      cwd = path.posix.resolve(cwd, args.shift() ?? ".");
      continue;
    }
    if (option === "-c") {
      args.shift();
      continue;
    }
    if (option === "--version" || option === "-v") return { stdout: VERSION, stderr: "", exitCode: 0 };
    if (option === "--help" || option === "-h") return { stdout: HELP, stderr: "", exitCode: 0 };
    return { stdout: "", stderr: `unknown option: ${option}\n${HELP}`, exitCode: 129 };
  }
  const sub = args.shift();
  if (sub === undefined) return { stdout: HELP, stderr: "", exitCode: 1 };
  if (sub === "help") return { stdout: HELP, stderr: "", exitCode: 0 };
  if (sub === "version") return { stdout: VERSION, stderr: "", exitCode: 0 };
  const command = COMMANDS[sub];
  if (!command) {
    const why = NOT_AVAILABLE[sub];
    if (why) return notAvailable(sub, why);
    return { stdout: "", stderr: `git: '${sub}' is not a git command. See 'git --help'.\n`, exitCode: 1 };
  }
  const tree = workingTree(input.files);
  const now = input.now();
  const state = await ensureRepository(input.store, tree, input.owner, now);
  const ctx: CommandContext = {
    repo: new Repository(input.store),
    state,
    tree,
    absoluteFiles: input.files,
    cwd: repoDir(cwd),
    identity: input.identity,
    now,
    ...(input.undeletable ? { undeletable: input.undeletable } : {}),
    save: async (head, index, branching) => (await input.store.updateRepo(state.version, head, index, branching)) !== null,
  };
  try {
    return await command(ctx, args);
  } catch (e) {
    if (e instanceof GitFatal) return { stdout: e.stdout, stderr: e.stderr, exitCode: e.exitCode };
    if (e instanceof UnknownOption) return unknownOption(sub, e.option);
    throw e;
  }
}
