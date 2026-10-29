// `git status`: long, short (-s, -b) and porcelain v1, as git prints them.
import type { Command, CommandContext } from "../command";
import { GitFatal } from "../errors";
import { compareNames } from "../objects";
import { parseOptions } from "../options";
import { matchesPathspec, quotePath, relativeToCwd, resolveFromCwd } from "../paths";
import { tracking } from "../remotes";
import type { ConflictKind } from "../store";
import { collapseUntracked, computeStatus, type Status } from "../worktree";

const LABELS: Readonly<Record<string, string>> = { M: "modified:   ", A: "new file:   ", D: "deleted:    " };
/** wt-status's labels for an unmerged path, padded like git's. */
const UNMERGED: Readonly<Record<ConflictKind, string>> = { UU: "both modified:   ", AA: "both added:      ", UD: "deleted by them: ", DU: "deleted by us:   " };

type Untracked = "no" | "normal" | "all";

/** The status, and where the branch stands against its upstream (null without one). */
export interface FullStatus extends Status {
  readonly tracking: Awaited<ReturnType<typeof tracking>>;
}

export async function readStatus(ctx: CommandContext, specs: readonly string[] = []): Promise<FullStatus> {
  const head = await ctx.repo.filesOfCommit(ctx.state.head);
  const computed = computeStatus(head, ctx.state.index, ctx.tree);
  // An unmerged path is neither staged nor changed: status lists it apart.
  const conflicts = ctx.state.merge?.conflicts ?? {};
  const all = { ...computed, tracked: computed.tracked.filter((c) => !Object.hasOwn(conflicts, c.path)), tracking: await tracking(ctx, ctx.state.branch) };
  if (specs.length === 0) return all;
  const keep = (p: string) => specs.some((s) => matchesPathspec(s, p));
  return { tracked: all.tracked.filter((t) => keep(t.path)), untracked: all.untracked.filter(keep), tracking: all.tracking };
}

function untrackedShown(ctx: CommandContext, s: Status, mode: Untracked): string[] {
  if (mode === "no") return [];
  return mode === "all" ? [...s.untracked] : collapseUntracked(s.untracked, ctx.state.index);
}

/** wt-status's lines on how the branch compares with its upstream. */
function trackingText(t: FullStatus["tracking"]): string {
  if (!t) return "";
  const commits = (n: number) => `${n} commit${n === 1 ? "" : "s"}`;
  if (t.gone) return `Your branch is based on '${t.upstream}', but the upstream is gone.\n  (use "git branch --unset-upstream" to fixup)\n\n`;
  if (t.ahead && t.behind) {
    return `Your branch and '${t.upstream}' have diverged,\nand have ${t.ahead} and ${t.behind} different commits each, respectively.\n  (use "git pull" if you want to integrate the remote branch with yours)\n\n`;
  }
  if (t.ahead) return `Your branch is ahead of '${t.upstream}' by ${commits(t.ahead)}.\n  (use "git push" to publish your local commits)\n\n`;
  if (t.behind) return `Your branch is behind '${t.upstream}' by ${commits(t.behind)}, and can be fast-forwarded.\n  (use "git pull" to update your local branch)\n\n`;
  return `Your branch is up to date with '${t.upstream}'.\n\n`;
}

export function longStatus(ctx: CommandContext, s: FullStatus, mode: Untracked = "normal"): string {
  const show = (p: string) => quotePath(relativeToCwd(ctx.cwd, p));
  const staged = s.tracked.filter((t) => t.staged !== " ");
  const unstaged = s.tracked.filter((t) => t.unstaged !== " ");
  const untracked = untrackedShown(ctx, s, mode);
  let out = `On branch ${ctx.state.branch}\n${trackingText(s.tracking)}`;
  const merge = ctx.state.merge;
  const unmerged = Object.entries(merge?.conflicts ?? {}).sort(([a], [b]) => compareNames(a, b));
  if (merge && unmerged.length > 0) out += 'You have unmerged paths.\n  (fix conflicts and run "git commit")\n  (use "git merge --abort" to abort the merge)\n\n';
  else if (merge) out += 'All conflicts fixed but you are still merging.\n  (use "git commit" to conclude merge)\n\n';
  if (staged.length > 0) {
    // During a merge git leaves the hint out.
    out += merge ? "Changes to be committed:\n" : 'Changes to be committed:\n  (use "git restore --staged <file>..." to unstage)\n';
    for (const t of staged) out += `\t${LABELS[t.staged]}${show(t.path)}\n`;
    out += "\n";
  }
  if (unmerged.length > 0) {
    const verb = unmerged.some(([, k]) => k === "UD" || k === "DU") ? 'git add/rm <file>..." as appropriate' : 'git add <file>..."';
    out += `Unmerged paths:\n  (use "${verb} to mark resolution)\n`;
    for (const [p, k] of unmerged) out += `\t${UNMERGED[k]}${show(p)}\n`;
    out += "\n";
  }
  if (unstaged.length > 0) {
    const verb = unstaged.some((t) => t.unstaged === "D") ? "git add/rm" : "git add";
    out += `Changes not staged for commit:\n  (use "${verb} <file>..." to update what will be committed)\n  (use "git restore <file>..." to discard changes in working directory)\n`;
    for (const t of unstaged) out += `\t${LABELS[t.unstaged]}${show(t.path)}\n`;
    out += "\n";
  }
  if (untracked.length > 0) {
    out += 'Untracked files:\n  (use "git add <file>..." to include in what will be committed)\n';
    for (const p of untracked) out += `\t${show(p)}\n`;
    out += "\n";
  }
  if (staged.length === 0) {
    if (unstaged.length > 0 || unmerged.length > 0) out += 'no changes added to commit (use "git add" and/or "git commit -a")\n';
    else if (untracked.length > 0) out += 'nothing added to commit but untracked files present (use "git add" to track)\n';
    else if (mode === "no" && s.untracked.length > 0) out += "nothing to commit (use -u to show untracked files)\n";
    else out += "nothing to commit, working tree clean\n";
  }
  return out;
}

export function shortStatus(ctx: CommandContext, s: FullStatus, o: { readonly porcelain: boolean; readonly branch: boolean; readonly untracked: Untracked }): string {
  const show = (p: string) => quotePath(o.porcelain ? p : relativeToCwd(ctx.cwd, p), true);
  const t = s.tracking;
  const where = t ? (t.gone ? " [gone]" : [t.ahead ? `ahead ${t.ahead}` : "", t.behind ? `behind ${t.behind}` : ""].filter(Boolean).join(", ").replace(/^(.+)$/, " [$1]")) : "";
  let out = o.branch ? `## ${ctx.state.branch}${t ? `...${t.upstream}${where}` : ""}\n` : "";
  const lines = s.tracked.map((t) => ({ path: t.path, code: `${t.staged}${t.unstaged}` }));
  for (const [path, code] of Object.entries(ctx.state.merge?.conflicts ?? {})) lines.push({ path, code });
  for (const l of lines.sort((a, b) => compareNames(a.path, b.path))) out += `${l.code} ${show(l.path)}\n`;
  for (const p of untrackedShown(ctx, s, o.untracked)) out += `?? ${show(p)}\n`;
  return out;
}

export const status: Command = async (ctx, args) => {
  // -u takes its mode glued (-uno), so it's read before the general parser.
  let untracked: Untracked = "normal";
  const rest: string[] = [];
  for (const a of args) {
    const m = /^(?:-u|--untracked-files)(?:=?(no|normal|all))?$/.exec(a);
    if (m) untracked = (m[1] as Untracked | undefined) ?? "all";
    else rest.push(a);
  }
  if (rest.includes("--porcelain=v2")) throw new GitFatal("git status --porcelain=v2: not available here: use --porcelain or --short.\n", 1);
  const o = parseOptions(rest, { flags: ["-s", "--short", "--porcelain", "--porcelain=v1", "--long", "-b", "--branch", "--no-renames"] });
  const specs = [...o.positional, ...(o.afterDashDash ?? [])].map((a) => resolveFromCwd(ctx.cwd, a));
  const s = await readStatus(ctx, specs);
  const porcelain = o.has("--porcelain") || o.has("--porcelain=v1");
  const short = !o.has("--long") && (porcelain || o.has("-s") || o.has("--short"));
  return {
    stdout: short ? shortStatus(ctx, s, { porcelain, branch: o.has("-b") || o.has("--branch"), untracked }) : longStatus(ctx, s, untracked),
    stderr: "",
    exitCode: 0,
  };
};
