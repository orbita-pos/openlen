// Moving between branches (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8): `git switch [-c] <branch>`, and
// `git checkout [-b] <branch>` through the same steps. Like git, it rewrites only the files that differ between the
// two commits, carries local changes to the others along, and refuses —without moving anything— when a local change
// would be overwritten. The files it writes go back through Write's checks, pages included, as any command's.
import { oidOfContent } from "../content";
import type { Command, CommandContext, GitRunResult } from "../command";
import { GitFatal, INDEX_LOCKED } from "../errors";
import { compareNames } from "../objects";
import { parseOptions } from "../options";
import { toAbsolute, toRepoPath } from "../paths";
import { resolveCommit } from "../revisions";
import { onlyChanged } from "./writes";

/** git check-ref-format's rules for a branch name, the ones a person or a model can trip on. */
export function validBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    !name.endsWith(".lock") &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.includes("@{") &&
    name !== "@" &&
    !/[\u0000- \u007f~^:?*[\\]/.test(name) &&
    !name.split("/").some((part) => part.startsWith("."))
  );
}

/** What git lists after a checkout: each tracked file whose working copy differs from the new HEAD. */
export function carriedChanges(head: ReadonlyMap<string, string>, index: Readonly<Record<string, string>>, files: ReadonlyMap<string, string>): string {
  const lines: string[] = [];
  for (const p of [...new Set([...head.keys(), ...Object.keys(index)])].sort(compareNames)) {
    const content = files.get(p);
    const inHead = head.get(p);
    if (inHead === undefined) lines.push(`A\t${p}`);
    else if (content === undefined) lines.push(`D\t${p}`);
    else if (oidOfContent(content) !== inHead) lines.push(`M\t${p}`);
  }
  return lines.map((l) => `${l}\n`).join("");
}

export type TwoWay =
  | { readonly ok: true; readonly index: Record<string, string>; readonly write: Record<string, string | null> }
  | { readonly ok: false; readonly overwritten: readonly string[]; readonly untracked: readonly string[] };

/**
 * git's two-way merge (unpack-trees) from HEAD to `to`: a path the two commits agree on is left alone, local changes
 * and all; one they don't is updated only if its index entry and its file are still HEAD's.
 */
export async function twoWay(ctx: CommandContext, to: ReadonlyMap<string, string>): Promise<TwoWay> {
  const before = await ctx.repo.filesOfCommit(ctx.state.head);
  const index: Record<string, string> = { ...ctx.state.index };
  const write: Record<string, string | null> = {};
  const overwritten: string[] = [];
  const untracked: string[] = [];
  for (const p of [...new Set([...before.keys(), ...to.keys()])].sort(compareNames)) {
    const was = before.get(p);
    const will = to.get(p);
    if (was === will) continue;
    const staged = ctx.state.index[p];
    const content = ctx.tree.files.get(p);
    const inTree = content === undefined ? undefined : oidOfContent(content);
    // Already staged as the new commit has it: kept, file and all.
    if (staged !== undefined && staged === will) continue;
    if (staged !== was) {
      overwritten.push(p);
      continue;
    }
    if (was === undefined) {
      // Not tracked: in the way only if it exists, isn't what the new commit brings and isn't ignored (git treats
      // an ignored file as expendable).
      if (inTree !== undefined && inTree !== will && !ctx.tree.isIgnored(p)) {
        untracked.push(p);
        continue;
      }
    } else if (inTree !== undefined && inTree !== was) {
      overwritten.push(p);
      continue;
    }
    if (will === undefined) {
      delete index[p];
      write[toAbsolute(p)] = null;
    } else {
      index[p] = will;
      write[toAbsolute(p)] = await ctx.repo.text(will);
    }
  }
  return overwritten.length > 0 || untracked.length > 0 ? { ok: false, overwritten, untracked } : { ok: true, index, write };
}

/** unpack-trees' refusal, for a checkout or a merge. */
export function wouldOverwrite(refused: { readonly overwritten: readonly string[]; readonly untracked: readonly string[] }, by: "checkout" | "merge"): string {
  const list = (paths: readonly string[]) => paths.map((p) => `\t${p}\n`).join("");
  const what = by === "checkout" ? "switch branches" : "merge";
  if (refused.overwritten.length > 0) {
    return `error: Your local changes to the following files would be overwritten by ${by}:\n${list(refused.overwritten)}Please commit your changes or stash them before you ${what}.\nAborting\n`;
  }
  return `error: The following untracked working tree files would be overwritten by ${by}:\n${list(refused.untracked)}Please move or remove them before you ${what}.\nAborting\n`;
}

/** The working tree as it will be once `write` is saved. */
export function afterWrite(ctx: CommandContext, write: Readonly<Record<string, string | null>> | undefined): Map<string, string> {
  const files = new Map(ctx.tree.files);
  for (const [abs, c] of Object.entries(write ?? {})) {
    if (c === null) files.delete(toRepoPath(abs));
    else files.set(toRepoPath(abs), c);
  }
  return files;
}

/** git's refusal to move while a merge has unmerged paths. */
export function unmergedIndex(ctx: CommandContext): GitRunResult | null {
  const conflicts = Object.keys(ctx.state.merge?.conflicts ?? {}).sort(compareNames);
  if (conflicts.length === 0) return null;
  return { stdout: conflicts.map((p) => `${p}: needs merge\n`).join(""), stderr: "error: you need to resolve your current index first\n", exitCode: 1 };
}

/**
 * Checks out `target` (a branch that exists, or a new one at `startPoint` when `create`). The caller has already said
 * which; this does git's work: the overwrite check, the files, the index and the branch.
 */
export async function switchTo(ctx: CommandContext, target: string, o: { readonly create: boolean; readonly startPoint?: string }): Promise<GitRunResult> {
  const refused = unmergedIndex(ctx);
  if (refused) return refused;
  if (!o.create && target === ctx.state.branch) {
    const head = await ctx.repo.filesOfCommit(ctx.state.head);
    return { stdout: carriedChanges(head, ctx.state.index, ctx.tree.files), stderr: `Already on '${target}'\n`, exitCode: 0 };
  }
  const targetOid = o.create ? (o.startPoint ? await resolveCommit(ctx, o.startPoint) : ctx.state.head) : ctx.state.refs[target]!;
  const after = await ctx.repo.filesOfCommit(targetOid);
  const moved = await twoWay(ctx, after);
  if (!moved.ok) return { stdout: "", stderr: wouldOverwrite(moved, "checkout"), exitCode: 1 };
  const refs = { ...ctx.state.refs, [target]: targetOid };
  if (!(await ctx.save(targetOid, moved.index, { branch: target, refs }))) throw new GitFatal(INDEX_LOCKED);
  const changed = onlyChanged(ctx, moved.write);
  return {
    stdout: carriedChanges(after, moved.index, afterWrite(ctx, changed)),
    stderr: o.create ? `Switched to a new branch '${target}'\n` : `Switched to branch '${target}'\n`,
    exitCode: 0,
    ...(changed ? { write: changed } : {}),
  };
}

/** `git switch <branch>`, `git switch -c <new> [<start>]`. */
export const switchCommand: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["-q", "--quiet", "--no-guess", "--guess"], values: ["-c", "--create", "-C", "--force-create"] });
  // switch, unlike checkout, refuses during any merge, even one whose conflicts are all resolved.
  if (ctx.state.merge) throw new GitFatal('fatal: cannot switch branch while merging\nConsider "git merge --quit" or "git worktree add".\n');
  const created = o.value("-c") ?? o.value("--create");
  if (created !== undefined) {
    if (!validBranchName(created)) throw new GitFatal(`fatal: '${created}' is not a valid branch name\n`);
    if (Object.hasOwn(ctx.state.refs, created)) throw new GitFatal(`fatal: a branch named '${created}' already exists\n`);
    return switchTo(ctx, created, { create: true, ...(o.positional[0] ? { startPoint: o.positional[0] } : {}) });
  }
  const name = o.positional[0];
  if (name === undefined) throw new GitFatal("fatal: missing branch or commit argument\n");
  if (!Object.hasOwn(ctx.state.refs, name)) throw new GitFatal(`fatal: invalid reference: ${name}\n`);
  return switchTo(ctx, name, { create: false });
};
