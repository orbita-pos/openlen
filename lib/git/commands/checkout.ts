// `git checkout [<commit>] -- <paths>`: files back from the index or a commit (overlay: nothing
// is removed). `git checkout [-b] <branch>` moves between branches, through switch's steps. A detached HEAD doesn't
// exist here.
import type { Command, CommandContext } from "../command";
import { abbrev } from "../diff";
import { GitFatal, INDEX_LOCKED, notAvailable, pathspecDidNotMatch } from "../errors";
import { parseOptions } from "../options";
import { matchesPathspec, resolveFromCwd, toAbsolute } from "../paths";
import { resolveCommit, resolveRevision } from "../revisions";
import { switchTo, validBranchName } from "./switch";
import { onlyChanged } from "./writes";

export const NO_DETACHED =
  "a detached HEAD isn't available here: work on a branch (git switch -c <name> <commit>), or bring files back with git checkout <commit> -- <path>.";

function isKnownPath(ctx: CommandContext, arg: string): boolean {
  const p = resolveFromCwd(ctx.cwd, arg);
  return Object.keys(ctx.state.index).some((f) => matchesPathspec(p, f));
}

export const checkout: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["-q", "--quiet", "-f", "--force", "--overlay", "-p", "--patch", "--detach"], values: ["-b", "-B", "--orphan"] });
  for (const f of ["-B", "--orphan", "--detach"]) if (o.has(f)) return notAvailable(`checkout ${f}`, NO_DETACHED);
  const created = o.value("-b");
  if (created !== undefined) {
    if (!validBranchName(created)) throw new GitFatal(`fatal: '${created}' is not a valid branch name\n`);
    if (Object.hasOwn(ctx.state.refs, created)) throw new GitFatal(`fatal: a branch named '${created}' already exists\n`);
    return switchTo(ctx, created, { create: true, ...(o.positional[0] ? { startPoint: o.positional[0] } : {}) });
  }
  if (o.has("-p") || o.has("--patch")) return notAvailable("checkout --patch", "it is interactive; bring whole files back.");
  let rev: string | null = null;
  let typed: string[];
  if (o.afterDashDash !== null) {
    if (o.positional.length > 1) throw new GitFatal(`fatal: only one reference expected, ${o.positional.length} given.\n`);
    if (o.positional.length === 1) rev = await resolveCommit(ctx, o.positional[0]!);
    typed = [...o.afterDashDash];
  } else {
    const first = o.positional[0];
    if (first === undefined) return { stdout: "", stderr: "", exitCode: 0 };
    // A branch wins over a path of the same name, as in git.
    if (o.positional.length === 1 && Object.hasOwn(ctx.state.refs, first)) return switchTo(ctx, first, { create: false });
    const asRevision = await resolveRevision(ctx, first);
    if (asRevision && !isKnownPath(ctx, first)) {
      if (o.positional.length === 1) return notAvailable(`checkout ${first}`, NO_DETACHED);
      rev = asRevision;
      typed = o.positional.slice(1);
    } else typed = [...o.positional];
  }
  const source: ReadonlyMap<string, string> = rev ? await ctx.repo.filesOfCommit(rev) : new Map(Object.entries(ctx.state.index));
  const index: Record<string, string> = { ...ctx.state.index };
  const write: Record<string, string | null> = {};
  for (const arg of typed) {
    const spec = resolveFromCwd(ctx.cwd, arg);
    let matched = false;
    for (const [p, oid] of source) {
      if (!matchesPathspec(spec, p)) continue;
      matched = true;
      if (rev) index[p] = oid;
      write[toAbsolute(p)] = await ctx.repo.text(oid);
    }
    if (!matched) throw pathspecDidNotMatch(arg);
  }
  if (rev && !(await ctx.save(ctx.state.head, index))) throw new GitFatal(INDEX_LOCKED);
  const from = rev ? abbrev((await ctx.repo.commit(rev)).tree) : "the index";
  const changed = onlyChanged(ctx, write);
  // git says what it updated only when the paths came without "--".
  const quiet = o.has("-q") || o.has("--quiet") || o.afterDashDash !== null;
  // git counts the files it actually rewrote.
  const count = changed ? Object.keys(changed).length : 0;
  return { stdout: "", stderr: quiet ? "" : `Updated ${count} path${count === 1 ? "" : "s"} from ${from}\n`, exitCode: 0, ...(changed ? { write: changed } : {}) };
};
