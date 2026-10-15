// `git checkout [<commit>] -- <paths>`: files back from the index or a commit (overlay: nothing
// is removed). Switching branches or commits doesn't exist here: one branch, main (spec §4).
import type { Command, CommandContext } from "../command";
import { abbrev } from "../diff";
import { blobOf, compareNames } from "../objects";
import { GitFatal, INDEX_LOCKED, notAvailable, pathspecDidNotMatch } from "../errors";
import { parseOptions } from "../options";
import { matchesPathspec, resolveFromCwd, toAbsolute } from "../paths";
import { resolveCommit, resolveRevision } from "../revisions";
import { onlyChanged } from "./writes";

export const ONE_BRANCH = "this project's repository has one branch, main. To bring files back from a commit: git checkout <commit> -- <path>.";

/** What `git checkout <current branch>` lists: HEAD against the working tree (M, D, A). */
async function localChanges(ctx: CommandContext): Promise<string> {
  const head = await ctx.repo.filesOfCommit(ctx.state.head);
  const lines: string[] = [];
  for (const p of [...new Set([...head.keys(), ...Object.keys(ctx.state.index)])].sort(compareNames)) {
    const content = ctx.tree.files.get(p);
    const inHead = head.get(p);
    if (inHead === undefined) lines.push(`A\t${p}`);
    else if (content === undefined) lines.push(`D\t${p}`);
    else if (blobOf(content).oid !== inHead) lines.push(`M\t${p}`);
  }
  return lines.map((l) => `${l}\n`).join("");
}

function isKnownPath(ctx: CommandContext, arg: string): boolean {
  const p = resolveFromCwd(ctx.cwd, arg);
  return Object.keys(ctx.state.index).some((f) => matchesPathspec(p, f));
}

export const checkout: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["-q", "--quiet", "-f", "--force", "--overlay", "-p", "--patch", "--detach"], values: ["-b", "-B", "--orphan"] });
  if (o.has("-b") || o.has("-B") || o.has("--orphan") || o.has("--detach")) return notAvailable("checkout -b", ONE_BRANCH);
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
    if (first === "main" && o.positional.length === 1) return { stdout: await localChanges(ctx), stderr: "Already on 'main'\n", exitCode: 0 };
    const asRevision = await resolveRevision(ctx, first);
    if (asRevision && !isKnownPath(ctx, first)) {
      if (o.positional.length === 1) return notAvailable(`checkout ${first}`, ONE_BRANCH);
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
