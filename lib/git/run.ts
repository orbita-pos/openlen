// `git …` as the binary reads it: global options, the repository created on first use with an
// "Initial commit" of the current files (spec §1), then the subcommand.
import path from "node:path";
import { signatureOf, type CommandContext, type GitIdentity, type GitRunInput, type GitRunResult } from "./command";
import { COMMANDS, NOT_AVAILABLE } from "./commands";
import { GitFatal, notAvailable } from "./errors";
import { blobOf, encodeCommit, makeObject, type GitObject } from "./objects";
import { UnknownOption } from "./options";
import { repoDir } from "./paths";
import { Repository, buildTree } from "./repository";
import type { GitStore, RepoState } from "./store";
import { workingTree, type WorkingTree } from "./worktree";

const VERSION = "git version (OpenLen's own git: the subset its bash tool's description lists)\n";
const HELP =
  "usage: git [-C <path>] [-c <name>=<value>] [--no-pager] <command> [<args>]\n\n" +
  "OpenLen's git has: status, diff, log, show, blame, grep, ls-files, rev-parse, branch, config,\n" +
  "add, reset, restore, checkout, commit, revert, init. One branch, main; no remote yet.\n";
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
    const blob = blobOf(content);
    blobs.push(blob);
    index[p] = blob.oid;
  }
  const { root, objects } = buildTree(index);
  const sig = signatureOf(owner, now);
  const commit = makeObject("commit", encodeCommit({ tree: root, parents: [], author: sig, committer: sig, message: "Initial commit\n" }));
  await store.writeObjects([...blobs, ...objects, commit]);
  return store.createRepo(commit.oid, index);
}

function unknownOption(sub: string, option: string): GitRunResult {
  if (REVISION_COMMANDS.has(sub)) return { stdout: "", stderr: `fatal: unrecognized argument: ${option}\n`, exitCode: 128 };
  const first = option.startsWith("--") ? `error: unknown option \`${option.slice(2)}'` : `error: unknown switch \`${option.slice(1)}'`;
  return { stdout: "", stderr: `${first}\nusage: git ${sub} [<options>]\n`, exitCode: 129 };
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
    save: async (head, index) => (await input.store.updateRepo(state.version, head, index)) !== null,
  };
  try {
    return await command(ctx, args);
  } catch (e) {
    if (e instanceof GitFatal) return { stdout: e.stdout, stderr: e.stderr, exitCode: e.exitCode };
    if (e instanceof UnknownOption) return unknownOption(sub, e.option);
    throw e;
  }
}
