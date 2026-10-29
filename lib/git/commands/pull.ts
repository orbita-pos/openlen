// `git pull [<remote> [<branch>]]` (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8): fetch, then merge the
// fetched branch — as git does with pull.rebase=false, which is how OpenLen's git is configured. Like git, the markers
// name the fetched commit by its id and the merge commit says "Merge branch 'x' of <url>".
import type { Command } from "../command";
import { GitFatal, INDEX_LOCKED, notAvailable } from "../errors";
import { parseOptions } from "../options";
import { displayUrl, fetchRemote } from "../remotes";
import { mergeCommit, unmergedFiles } from "./merge";

export const pull: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["--no-rebase", "--ff", "--no-ff", "--ff-only", "-q", "--quiet", "-v", "--verbose", "--no-edit", "--edit", "--stat", "-n", "--no-stat", "--rebase", "-r", "--autostash", "--no-autostash"] });
  if (o.has("--rebase") || o.has("-r")) return notAvailable("pull --rebase", "pull merges here (pull.rebase=false); the history is never rewritten.");
  if (o.has("--autostash")) return notAvailable("pull --autostash", "commit your changes first, then pull.");
  if (ctx.state.merge) {
    if (Object.keys(ctx.state.merge.conflicts).length > 0) throw new GitFatal(unmergedFiles("Merging").replace("Merging is", "Pulling is"));
    throw new GitFatal("fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.\n");
  }
  const branch = ctx.state.branch;
  const upstream = ctx.state.upstreams[branch];
  const remoteName = o.positional[0] ?? upstream?.remote;
  const remoteBranch = o.positional[1] ?? (o.positional[0] === undefined || o.positional[0] === upstream?.remote ? upstream?.branch : undefined);
  if (remoteName === undefined || remoteBranch === undefined) {
    if (remoteName !== undefined && o.positional.length === 1 && !upstream) {
      return { stdout: "", stderr: `You asked to pull from the remote '${remoteName}', but did not specify\na branch. Because this is not the default configured remote\nfor your current branch, you must specify a branch on the command line.\n`, exitCode: 1 };
    }
    return {
      stdout: "",
      stderr:
        "There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n\n" +
        `If you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=${Object.keys(ctx.state.remotes)[0] ?? "<remote>"}/<branch> ${branch}\n\n`,
      exitCode: 1,
    };
  }
  const fetched = await fetchRemote(ctx, remoteName, o.positional[1]);
  const quiet = o.has("-q") || o.has("--quiet");
  const theirs = fetched.remotes[remoteName]!.refs[remoteBranch];
  if (theirs === undefined) throw new GitFatal(`fatal: couldn't find remote ref ${remoteBranch}\n`);
  const into = branch === "main" || branch === "master" ? "" : ` into ${branch}`;
  let merged: Awaited<ReturnType<typeof mergeCommit>>;
  try {
    merged = await mergeCommit(ctx, theirs, {
      name: theirs,
      message: `Merge branch '${remoteBranch}' of ${displayUrl(fetched.remotes[remoteName]!.url)}${into}\n`,
      noFf: o.has("--no-ff"),
      ffOnly: o.has("--ff-only"),
      quiet,
      showStat: !(o.has("-n") || o.has("--no-stat")),
      changes: { remotes: fetched.remotes },
    });
  } catch (e) {
    // The merge refused (--ff-only, unrelated histories): what was fetched stays fetched, as in git.
    if (!(e instanceof GitFatal)) throw e;
    if (!(await ctx.save(ctx.state.head, ctx.state.index, { remotes: fetched.remotes }))) throw new GitFatal(INDEX_LOCKED);
    throw new GitFatal(`${quiet ? "" : fetched.stderr}${e.stderr}`, e.exitCode, e.stdout);
  }
  if (!merged.saved && !(await ctx.save(ctx.state.head, ctx.state.index, { remotes: fetched.remotes }))) throw new GitFatal(INDEX_LOCKED);
  return { ...merged.result, stderr: `${quiet ? "" : fetched.stderr}${merged.result.stderr}` };
};
