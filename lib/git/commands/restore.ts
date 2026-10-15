// `git restore`: files back from the index (default), from HEAD into the index (--staged), or
// from any commit (--source). Without overlay, as git: a tracked file the source lacks is removed.
import type { Command } from "../command";
import { GitFatal, INDEX_LOCKED, notAvailable, pathspecDidNotMatch } from "../errors";
import { parseOptions } from "../options";
import { matchesPathspec, resolveFromCwd, toAbsolute } from "../paths";
import { resolveCommit } from "../revisions";
import { onlyChanged } from "./writes";

export const restore: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["-S", "--staged", "-W", "--worktree", "-q", "--quiet", "--no-overlay", "-p", "--patch"], values: ["-s", "--source"] });
  if (o.has("-p") || o.has("--patch")) return notAvailable("restore --patch", "it is interactive; restore whole files.");
  const typed = [...o.positional, ...(o.afterDashDash ?? [])];
  if (typed.length === 0) throw new GitFatal("fatal: you must specify path(s) to restore\n");
  const staged = o.has("-S") || o.has("--staged");
  const worktree = o.has("-W") || o.has("--worktree") || !staged;
  const sourceSpec = o.value("--source") ?? o.value("-s");
  const source: ReadonlyMap<string, string> =
    sourceSpec !== undefined
      ? await ctx.repo.filesOfCommit(await resolveCommit(ctx, sourceSpec))
      : staged
        ? await ctx.repo.filesOfCommit(ctx.state.head)
        : new Map(Object.entries(ctx.state.index));
  const index: Record<string, string> = { ...ctx.state.index };
  const write: Record<string, string | null> = {};
  for (const arg of typed) {
    const spec = resolveFromCwd(ctx.cwd, arg);
    let matched = false;
    for (const p of new Set([...source.keys(), ...Object.keys(ctx.state.index)])) {
      if (!matchesPathspec(spec, p)) continue;
      matched = true;
      const oid = source.get(p);
      if (staged) {
        if (oid === undefined) delete index[p];
        else index[p] = oid;
      }
      if (worktree) write[toAbsolute(p)] = oid === undefined ? null : await ctx.repo.text(oid);
    }
    if (!matched) throw pathspecDidNotMatch(arg);
  }
  if (staged && !(await ctx.save(ctx.state.head, index))) throw new GitFatal(INDEX_LOCKED);
  const changed = onlyChanged(ctx, write);
  return { stdout: "", stderr: "", exitCode: 0, ...(changed ? { write: changed } : {}) };
};
