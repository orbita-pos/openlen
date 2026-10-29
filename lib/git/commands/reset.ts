// `git reset` that only unstages (all, or some paths, from HEAD or another commit). Moving `main`
// back (--soft, --hard, reset <commit>) rewrites history: not here (spec §4).
import { oidOfContent } from "../content";
import type { Command } from "../command";
import { GitFatal, INDEX_LOCKED, notAvailable } from "../errors";
import { compareNames } from "../objects";
import { parseOptions } from "../options";
import { matchesPathspec, resolveFromCwd } from "../paths";
import { resolveRevision } from "../revisions";

export const REWRITE = "the history is never rewritten here; to undo a commit, git revert <commit>.";

export const reset: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["-q", "--quiet", "--mixed", "--soft", "--hard", "--keep", "--merge", "-p", "--patch"] });
  for (const f of ["--soft", "--hard", "--keep", "--merge"]) if (o.has(f)) return notAvailable(`reset ${f}`, REWRITE);
  if (o.has("-p") || o.has("--patch")) return notAvailable("reset --patch", "it is interactive; unstage whole files with git restore --staged <file>.");
  let positional = [...o.positional];
  let rev = ctx.state.head;
  if (positional.length > 0) {
    const r = await resolveRevision(ctx, positional[0]!);
    if (r) {
      rev = r;
      positional = positional.slice(1);
    }
  }
  const typed = [...positional, ...(o.afterDashDash ?? [])];
  if (typed.length === 0 && rev !== ctx.state.head) return notAvailable("reset <commit>", REWRITE);
  const source = await ctx.repo.filesOfCommit(rev);
  const index: Record<string, string> = { ...ctx.state.index };
  const specs = typed.length > 0 ? typed.map((a) => resolveFromCwd(ctx.cwd, a)) : [""];
  for (const spec of specs) {
    for (const p of new Set([...Object.keys(index), ...source.keys()])) {
      if (!matchesPathspec(spec, p)) continue;
      const oid = source.get(p);
      if (oid === undefined) delete index[p];
      else index[p] = oid;
    }
  }
  // Like git: a reset without paths ends a merge in progress; one with paths resolves the unmerged ones it names.
  const merge = ctx.state.merge;
  let nextMerge: typeof merge | undefined;
  if (merge && typed.length === 0) nextMerge = null;
  else if (merge) nextMerge = { ...merge, conflicts: Object.fromEntries(Object.entries(merge.conflicts).filter(([p]) => !specs.some((spec) => matchesPathspec(spec, p)))) };
  if (!(await ctx.save(ctx.state.head, index, nextMerge === undefined ? {} : { merge: nextMerge }))) throw new GitFatal(INDEX_LOCKED);
  if (o.has("-q") || o.has("--quiet")) return { stdout: "", stderr: "", exitCode: 0 };
  const lines: string[] = [];
  for (const p of Object.keys(index).sort(compareNames)) {
    const content = ctx.tree.files.get(p);
    if (content === undefined) lines.push(`D\t${p}`);
    else if (oidOfContent(content) !== index[p]) lines.push(`M\t${p}`);
  }
  return { stdout: lines.length > 0 ? `Unstaged changes after reset:\n${lines.join("\n")}\n` : "", stderr: "", exitCode: 0 };
};
