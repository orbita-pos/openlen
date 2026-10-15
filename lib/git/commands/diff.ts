// `git diff`: working tree vs index, --cached (index vs HEAD), against a commit, between two, a..b, a...b.
import type { Command } from "../command";
import { GitFatal } from "../errors";
import { parseOptions } from "../options";
import { mergeBase, revisionsAndPaths } from "../revisions";
import { DIFF_FLAGS, DIFF_VALUES, changedFiles, commitSource, diffOutputOf, indexSource, renderChanges, workSource, type Source } from "../sources";

export const diff: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: [...DIFF_FLAGS, "--cached", "--staged", "--exit-code", "--quiet", "-s"], values: DIFF_VALUES });
  const { revisions, paths } = await revisionsAndPaths(ctx, o.positional, o.afterDashDash);
  const cached = o.has("--cached") || o.has("--staged");
  const tracked = Object.keys(ctx.state.index);
  const [first, second, third] = revisions;
  if (third) throw new GitFatal("usage: git diff [<options>] [<commit>] [--] [<path>...]\n", 129);
  let from: Source;
  let to: Source;
  if (!first) {
    from = cached ? await commitSource(ctx, ctx.state.head) : indexSource(ctx);
    to = cached ? indexSource(ctx) : workSource(ctx, tracked);
  } else if (first.kind === "range") {
    from = await commitSource(ctx, first.symmetric ? await mergeBase(ctx, first.from, first.to) : first.from);
    to = await commitSource(ctx, first.to);
  } else if (!second) {
    from = await commitSource(ctx, first.oid);
    to = cached ? indexSource(ctx) : workSource(ctx, new Set([...from.files.keys(), ...tracked]));
  } else {
    if (second.kind !== "single") throw new GitFatal("usage: git diff [<options>] [<commit>] [--] [<path>...]\n", 129);
    from = await commitSource(ctx, first.oid);
    to = await commitSource(ctx, second.oid);
  }
  const files = await changedFiles(from, to, paths);
  const quiet = o.has("--quiet");
  const exitCode = (o.has("--exit-code") || quiet) && files.length > 0 ? 1 : 0;
  const output = diffOutputOf(o, !o.has("-s"));
  return { stdout: quiet ? "" : renderChanges(files, output), stderr: "", exitCode };
};
