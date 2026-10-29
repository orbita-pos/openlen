// `git merge` (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8), as git 2.45 with the ort strategy: a fast-
// forward when it can, else a three-way merge — a two-parent commit, or the conflicts left in the tree with git's
// markers until `git add` and `git commit` conclude it (or `git merge --abort` undoes it).
import { oidOfContent } from "../content";
import { signatureOf, type Command, type CommandContext, type GitRunResult } from "../command";
import { abbrev } from "../diff";
import { GitFatal, INDEX_LOCKED, notAvailable } from "../errors";
import { cleanupMessage } from "../format";
import { mergeTrees } from "../merge";
import { compareNames, encodeCommit, makeObject } from "../objects";
import { parseOptions } from "../options";
import { toAbsolute } from "../paths";
import { buildTree } from "../repository";
import { remoteBranchOf, resolveRevision } from "../revisions";
import { changedFiles, renderChanges } from "../sources";
import type { Index, RepoChanges } from "../store";
import { twoWay, wouldOverwrite } from "./switch";
import { onlyChanged } from "./writes";

const UNMERGED_HINT = "hint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.\n";

/** git's refusal to commit or merge with unmerged paths: `error: <doing> is not possible because you have unmerged files.` */
export function unmergedFiles(doing: "Committing" | "Merging"): string {
  return `error: ${doing} is not possible because you have unmerged files.\n${UNMERGED_HINT}`;
}

/** fmt-merge-msg: "Merge branch 'x'", plus " into <branch>" unless that is main or master. */
function mergeMessage(ctx: CommandContext, name: string): string {
  const what = Object.hasOwn(ctx.state.refs, name) ? `branch '${name}'` : remoteBranchOf(ctx.state, name) ? `remote-tracking branch '${name}'` : `commit '${name}'`;
  const into = ctx.state.branch === "main" || ctx.state.branch === "master" ? "" : ` into ${ctx.state.branch}`;
  return `Merge ${what}${into}\n`;
}

/** The diffstat git prints after a merge (HEAD → the result), with its create/delete mode lines. */
async function mergeStat(ctx: CommandContext, after: Index): Promise<string> {
  const text = (_p: string, oid: string) => ctx.repo.text(oid);
  const files = await changedFiles({ files: await ctx.repo.filesOfCommit(ctx.state.head), text }, { files: new Map(Object.entries(after)), text });
  let out = renderChanges(files, { patch: false, stat: true, numstat: false, shortstat: false, nameOnly: false, nameStatus: false, context: 3 });
  for (const f of files) {
    if (f.from.oid === null) out += ` create mode 100644 ${f.path}\n`;
    else if (f.to.oid === null) out += ` delete mode 100644 ${f.path}\n`;
  }
  return out;
}

/** `git merge --abort` (git reset --merge): the index and every file the merge touched back to HEAD; other local
 *  changes stay. */
async function abort(ctx: CommandContext) {
  if (!ctx.state.merge) throw new GitFatal("fatal: There is no merge to abort (MERGE_HEAD missing).\n");
  const head = await ctx.repo.filesOfCommit(ctx.state.head);
  const index: Record<string, string> = Object.fromEntries(head);
  const write: Record<string, string | null> = {};
  for (const p of [...new Set([...head.keys(), ...Object.keys(ctx.state.index), ...Object.keys(ctx.state.merge.conflicts)])].sort(compareNames)) {
    if (ctx.state.index[p] === head.get(p) && !Object.hasOwn(ctx.state.merge.conflicts, p)) continue;
    const oid = head.get(p);
    write[toAbsolute(p)] = oid === undefined ? null : await ctx.repo.text(oid);
  }
  if (!(await ctx.save(ctx.state.head, index, { merge: null }))) throw new GitFatal(INDEX_LOCKED);
  const changed = onlyChanged(ctx, write);
  return { stdout: "", stderr: "", exitCode: 0, ...(changed ? { write: changed } : {}) };
}

export const merge: Command = async (ctx, args) => {
  const o = parseOptions(args, {
    flags: ["--abort", "--continue", "--quit", "--ff", "--no-ff", "--ff-only", "--no-edit", "-e", "--edit", "--commit", "--no-commit", "-q", "--quiet", "-v", "--verbose", "--stat", "-n", "--no-stat", "--squash", "--no-squash", "--log", "--no-log", "--no-verify", "--allow-unrelated-histories", "--no-progress", "--progress"],
    values: ["-m", "--message", "-s", "--strategy", "-X", "--strategy-option"],
  });
  if (o.has("--abort")) return abort(ctx);
  if (o.has("--continue")) return notAvailable("merge --continue", "conclude the merge with git commit --no-edit (or git commit -m \"<message>\").");
  if (o.has("--quit")) return notAvailable("merge --quit", "conclude the merge with git commit, or undo it with git merge --abort.");
  if (o.has("--squash")) return notAvailable("merge --squash", "merge the branch with git merge <branch>.");
  for (const f of ["-s", "--strategy", "-X", "--strategy-option"]) if (o.has(f)) return notAvailable(`merge ${f}`, "the strategy here is git's default, ort.");
  if (ctx.state.merge) {
    if (Object.keys(ctx.state.merge.conflicts).length > 0) throw new GitFatal(unmergedFiles("Merging"));
    throw new GitFatal("fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.\n");
  }
  const name = o.positional[0];
  if (name === undefined) throw new GitFatal("fatal: No remote for the current branch.\n");
  if (o.positional.length > 1) return notAvailable("merge with several branches (an octopus)", "merge them one at a time.");
  const theirs = await resolveRevision(ctx, name);
  if (!theirs) return { stdout: "", stderr: `merge: ${name} - not something we can merge\n`, exitCode: 1 };
  const typed = [...o.all("-m"), ...o.all("--message")];
  const r = await mergeCommit(ctx, theirs, {
    name,
    message: typed.length > 0 ? cleanupMessage(typed.join("\n\n")) : mergeMessage(ctx, name),
    noFf: o.has("--no-ff"),
    ffOnly: o.has("--ff-only"),
    noCommit: o.has("--no-commit"),
    quiet: o.has("-q") || o.has("--quiet"),
    showStat: !(o.has("-n") || o.has("--no-stat")),
    allowUnrelated: o.has("--allow-unrelated-histories"),
  });
  return r.result;
};

export interface MergeOptions {
  /** What the markers and ort's messages call the other side: the branch as typed, or (for pull) the commit's id. */
  readonly name: string;
  /** The merge commit's message (and MERGE_MSG's first line). */
  readonly message: string;
  readonly noFf?: boolean;
  readonly ffOnly?: boolean;
  readonly noCommit?: boolean;
  readonly quiet?: boolean;
  readonly showStat?: boolean;
  readonly allowUnrelated?: boolean;
  /** More to save in the same write (pull's remote-tracking branches): a command writes the repository once. */
  readonly changes?: RepoChanges;
}

/** git merge of `theirs` into the current branch. `saved`: whether it wrote the repository (if not, a caller with
 *  `changes` still has to). */
export async function mergeCommit(ctx: CommandContext, theirs: string, m: MergeOptions): Promise<{ result: GitRunResult; saved: boolean }> {
  const quiet = m.quiet ?? false;
  const showStat = (m.showStat ?? true) && !quiet;
  const extra = m.changes ?? {};
  if (await ctx.repo.isAncestor(theirs, ctx.state.head)) return { result: { stdout: quiet ? "" : "Already up to date.\n", stderr: "", exitCode: 0 }, saved: false };

  const head = ctx.state.head;
  const theirsFiles = await ctx.repo.filesOfCommit(theirs);
  if (!m.noFf && (await ctx.repo.isAncestor(head, theirs))) {
    const updating = quiet ? "" : `Updating ${abbrev(head)}..${abbrev(theirs)}\n`;
    const moved = await twoWay(ctx, theirsFiles);
    if (!moved.ok) return { result: { stdout: updating, stderr: wouldOverwrite(moved, "merge"), exitCode: 1 }, saved: false };
    const stat = showStat ? await mergeStat(ctx, Object.fromEntries(theirsFiles)) : "";
    if (!(await ctx.save(theirs, moved.index, extra))) throw new GitFatal(INDEX_LOCKED);
    const changed = onlyChanged(ctx, moved.write);
    return { result: { stdout: `${updating}${quiet ? "" : "Fast-forward\n"}${stat}`, stderr: "", exitCode: 0, ...(changed ? { write: changed } : {}) }, saved: true };
  }
  if (m.ffOnly) throw new GitFatal("fatal: Not possible to fast-forward, aborting.\n");

  // ort refuses with anything staged.
  const ours = await ctx.repo.filesOfCommit(head);
  const staged = [...new Set([...ours.keys(), ...Object.keys(ctx.state.index)])].filter((p) => ours.get(p) !== ctx.state.index[p]).sort(compareNames);
  if (staged.length > 0) {
    return {
      result: { stdout: "", stderr: `error: Your local changes to the following files would be overwritten by merge:\n${staged.map((p) => `  ${p}\n`).join("")}Merge with strategy ort failed.\n`, exitCode: 2 },
      saved: false,
    };
  }
  const base = await ctx.repo.mergeBase(head, theirs);
  if (base === null && !m.allowUnrelated) throw new GitFatal("fatal: refusing to merge unrelated histories\n");
  const baseFiles = base === null ? new Map<string, string>() : await ctx.repo.filesOfCommit(base);
  const result = await mergeTrees(baseFiles, ours, theirsFiles, (oid) => ctx.repo.text(oid), m.name);

  // Then ort checks the working tree out from HEAD to the result: a file it would write must have no local change.
  const overwritten: string[] = [];
  const untracked: string[] = [];
  for (const p of result.write.keys()) {
    const content = ctx.tree.files.get(p);
    if (content === undefined) continue;
    const was = ours.get(p);
    if (was === undefined) {
      if (!ctx.tree.isIgnored(p) && content !== result.write.get(p)) untracked.push(p);
    } else if (oidOfContent(content) !== was) overwritten.push(p);
  }
  if (overwritten.length > 0 || untracked.length > 0) {
    return { result: { stdout: "", stderr: `${wouldOverwrite({ overwritten, untracked }, "merge")}Merge with strategy ort failed.\n`, exitCode: 2 }, saved: false };
  }

  await ctx.repo.store.writeObjects(result.blobs);
  const write = onlyChanged(ctx, Object.fromEntries([...result.write].map(([p, c]) => [toAbsolute(p), c])));
  const conflicted = Object.keys(result.conflicts).sort(compareNames);
  if (conflicted.length > 0 || m.noCommit) {
    const merging = {
      theirs,
      message: conflicted.length > 0 ? `${m.message}\n# Conflicts:\n${conflicted.map((p) => `#\t${p}\n`).join("")}` : m.message,
      conflicts: result.conflicts,
    };
    if (!(await ctx.save(head, result.index, { ...extra, merge: merging }))) throw new GitFatal(INDEX_LOCKED);
    const ending = conflicted.length > 0 ? "Automatic merge failed; fix conflicts and then commit the result.\n" : "Automatic merge went well; stopped before committing as requested\n";
    return { result: { stdout: `${result.messages}${ending}`, stderr: "", exitCode: conflicted.length > 0 ? 1 : 0, ...(write ? { write } : {}) }, saved: true };
  }

  const { root, objects } = buildTree(result.index);
  const sig = signatureOf(ctx.identity, ctx.now);
  const created = makeObject("commit", encodeCommit({ tree: root, parents: [head, theirs], author: sig, committer: sig, message: m.message }));
  await ctx.repo.store.writeObjects([...objects, created]);
  const stat = showStat ? await mergeStat(ctx, result.index) : "";
  if (!(await ctx.save(created.oid, result.index, { ...extra, merge: null }))) throw new GitFatal(INDEX_LOCKED);
  return {
    result: { stdout: quiet ? "" : `${result.messages}Merge made by the 'ort' strategy.\n${stat}`, stderr: "", exitCode: 0, ...(write ? { write } : {}) },
    saved: true,
  };
}
