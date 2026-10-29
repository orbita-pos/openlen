// `git fetch [<remote>] [--all]` (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8): the remote's branches
// into its remote-tracking branches, as git prints them on stderr. Tags aren't fetched (as with --no-tags).
import type { Command } from "../command";
import { GitFatal, INDEX_LOCKED, notAvailable } from "../errors";
import { parseOptions } from "../options";
import { fetchRemote } from "../remotes";
import type { Remote } from "../store";

export const fetch: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["--all", "-q", "--quiet", "-v", "--verbose", "--prune", "-p", "--no-tags", "--tags", "--progress", "--no-progress"] });
  if (o.has("--tags")) return notAvailable("fetch --tags", "tags aren't fetched here; the branches are.");
  if (o.positional.length > 1) return notAvailable("fetch <remote> <refspec>", "fetch the whole remote with git fetch <remote>.");
  const names = o.has("--all") ? Object.keys(ctx.state.remotes).sort() : [o.positional[0] ?? ctx.state.upstreams[ctx.state.branch]?.remote ?? "origin"];
  // With no remote at all, git fetch has nothing to do and says nothing.
  if (!o.has("--all") && o.positional.length === 0 && Object.keys(ctx.state.remotes).length === 0) return { stdout: "", stderr: "", exitCode: 0 };
  let remotes: Readonly<Record<string, Remote>> = ctx.state.remotes;
  let stderr = "";
  for (const name of names) {
    const fetched = await fetchRemote({ ...ctx, state: { ...ctx.state, remotes } }, name);
    remotes = fetched.remotes;
    stderr += fetched.stderr;
  }
  if (remotes !== ctx.state.remotes && !(await ctx.save(ctx.state.head, ctx.state.index, { remotes }))) throw new GitFatal(INDEX_LOCKED);
  return { stdout: "", stderr: o.has("-q") || o.has("--quiet") ? "" : stderr, exitCode: 0 };
};
