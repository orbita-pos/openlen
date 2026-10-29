// `git status`: long, short (-s, -b) and porcelain v1, as git prints them.
import type { Command, CommandContext } from "../command";
import { GitFatal } from "../errors";
import { parseOptions } from "../options";
import { matchesPathspec, quotePath, relativeToCwd, resolveFromCwd } from "../paths";
import { collapseUntracked, computeStatus, type Status } from "../worktree";

const LABELS: Readonly<Record<string, string>> = { M: "modified:   ", A: "new file:   ", D: "deleted:    " };

type Untracked = "no" | "normal" | "all";

export async function readStatus(ctx: CommandContext, specs: readonly string[] = []): Promise<Status> {
  const head = await ctx.repo.filesOfCommit(ctx.state.head);
  const all = computeStatus(head, ctx.state.index, ctx.tree);
  if (specs.length === 0) return all;
  const keep = (p: string) => specs.some((s) => matchesPathspec(s, p));
  return { tracked: all.tracked.filter((t) => keep(t.path)), untracked: all.untracked.filter(keep) };
}

function untrackedShown(ctx: CommandContext, s: Status, mode: Untracked): string[] {
  if (mode === "no") return [];
  return mode === "all" ? [...s.untracked] : collapseUntracked(s.untracked, ctx.state.index);
}

export function longStatus(ctx: CommandContext, s: Status, mode: Untracked = "normal"): string {
  const show = (p: string) => quotePath(relativeToCwd(ctx.cwd, p));
  const staged = s.tracked.filter((t) => t.staged !== " ");
  const unstaged = s.tracked.filter((t) => t.unstaged !== " ");
  const untracked = untrackedShown(ctx, s, mode);
  let out = `On branch ${ctx.state.branch}\n`;
  if (staged.length > 0) {
    out += 'Changes to be committed:\n  (use "git restore --staged <file>..." to unstage)\n';
    for (const t of staged) out += `\t${LABELS[t.staged]}${show(t.path)}\n`;
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
    if (unstaged.length > 0) out += 'no changes added to commit (use "git add" and/or "git commit -a")\n';
    else if (untracked.length > 0) out += 'nothing added to commit but untracked files present (use "git add" to track)\n';
    else if (mode === "no" && s.untracked.length > 0) out += "nothing to commit (use -u to show untracked files)\n";
    else out += "nothing to commit, working tree clean\n";
  }
  return out;
}

export function shortStatus(ctx: CommandContext, s: Status, o: { readonly porcelain: boolean; readonly branch: boolean; readonly untracked: Untracked }): string {
  const show = (p: string) => quotePath(o.porcelain ? p : relativeToCwd(ctx.cwd, p), true);
  let out = o.branch ? `## ${ctx.state.branch}\n` : "";
  for (const t of s.tracked) out += `${t.staged}${t.unstaged} ${show(t.path)}\n`;
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
