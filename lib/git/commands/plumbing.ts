// The small ones: ls-files, rev-parse, branch, config, init, remote, and push/pull/fetch with no remote.
import { oidOfContent } from "../content";
import type { Command } from "../command";
import { abbrev } from "../diff";
import { GitFatal, INDEX_LOCKED, notAvailable, unknownRevision } from "../errors";
import { subjectOf } from "../format";
import { compareNames } from "../objects";
import { parseOptions } from "../options";
import { matchesPathspec, quotePath, relativeToCwd, resolveFromCwd } from "../paths";
import { resolveCommit, resolveRevision } from "../revisions";
import { validBranchName } from "./switch";

const NO_REMOTE = "GitHub isn't connected yet: this repository has no remote.";

export const lsFiles: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["-c", "--cached", "-m", "--modified", "-d", "--deleted", "-o", "--others", "--exclude-standard"] });
  const typed = [...o.positional, ...(o.afterDashDash ?? [])];
  const scope = typed.length > 0 ? typed.map((a) => resolveFromCwd(ctx.cwd, a)) : [ctx.cwd];
  const tracked = Object.keys(ctx.state.index);
  let paths: string[];
  if (o.has("-o") || o.has("--others")) {
    paths = [...ctx.tree.files.keys()].filter((p) => ctx.state.index[p] === undefined && !(o.has("--exclude-standard") && ctx.tree.isIgnored(p)));
  } else if (o.has("-m") || o.has("--modified")) {
    paths = tracked.filter((p) => {
      const c = ctx.tree.files.get(p);
      return c === undefined || oidOfContent(c) !== ctx.state.index[p];
    });
  } else if (o.has("-d") || o.has("--deleted")) {
    paths = tracked.filter((p) => !ctx.tree.files.has(p));
  } else paths = tracked;
  const shown = paths.filter((p) => scope.some((s) => matchesPathspec(s, p))).sort(compareNames);
  return { stdout: shown.map((p) => `${quotePath(relativeToCwd(ctx.cwd, p))}\n`).join(""), stderr: "", exitCode: 0 };
};

export const revParse: Command = async (ctx, args) => {
  const out: string[] = [];
  let short = false;
  let abbrevRef = false;
  let verify = false;
  for (const a of args) {
    if (a === "--show-toplevel") out.push("/");
    else if (a === "--git-dir") out.push(ctx.cwd === "" ? ".git" : "/.git");
    else if (a === "--is-inside-work-tree") out.push("true");
    else if (a === "--is-inside-git-dir" || a === "--is-bare-repository") out.push("false");
    else if (a === "--show-prefix") out.push(ctx.cwd ? `${ctx.cwd}/` : "");
    else if (a === "--short") short = true;
    else if (a === "--abbrev-ref") abbrevRef = true;
    else if (a === "--verify" || a === "-q" || a === "--quiet") verify = true;
    else if (a.startsWith("-")) out.push(a);
    else if (abbrevRef && (a === "HEAD" || a === "@")) out.push(ctx.state.branch);
    else if (abbrevRef && Object.hasOwn(ctx.state.refs, a)) out.push(a);
    else {
      const oid = await resolveRevision(ctx, a);
      if (!oid) {
        if (verify) return { stdout: "", stderr: "fatal: Needed a single revision\n", exitCode: 128 };
        return { stdout: out.map((l) => `${l}\n`).join("") + `${a}\n`, stderr: unknownRevision(a).stderr, exitCode: 128 };
      }
      out.push(short ? abbrev(oid) : oid);
    }
  }
  return { stdout: out.map((l) => `${l}\n`).join(""), stderr: "", exitCode: 0 };
};

/** A `branch --list` pattern: git's fnmatch, * and ? included. */
function matchesBranchPattern(pattern: string, name: string): boolean {
  const re = pattern.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(name);
}

export const branch: Command = async (ctx, args) => {
  const o = parseOptions(args, {
    flags: ["-a", "--all", "-l", "--list", "-v", "-vv", "--verbose", "--show-current", "-r", "--remotes", "--no-color", "-d", "-D", "--delete", "-f", "--force", "-m", "-M", "-c", "-C", "--move", "--copy"],
    values: ["-u", "--set-upstream-to"],
  });
  for (const f of ["-m", "-M", "-c", "-C", "--move", "--copy"]) {
    if (o.has(f)) {
      return notAvailable(`branch ${f}`, "renaming or copying a branch isn't available here yet: create the new one with git branch <new> <old>, then delete the old one with git branch -d <old>.");
    }
  }
  if (o.has("-u") || o.has("--set-upstream-to")) return notAvailable("branch --set-upstream-to", NO_REMOTE);
  if (o.has("--show-current")) return { stdout: `${ctx.state.branch}\n`, stderr: "", exitCode: 0 };
  if (o.has("-r") || o.has("--remotes")) return { stdout: "", stderr: "", exitCode: 0 };

  if (o.has("-d") || o.has("-D") || o.has("--delete")) {
    const force = o.has("-D") || o.has("-f") || o.has("--force");
    if (o.positional.length === 0) throw new GitFatal("fatal: branch name required\n");
    const refs: Record<string, string> = { ...ctx.state.refs };
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    for (const name of o.positional) {
      const oid = Object.hasOwn(refs, name) ? refs[name] : undefined;
      if (oid === undefined) {
        stderr += `error: branch '${name}' not found.\n`;
        exitCode = 1;
      } else if (name === ctx.state.branch) {
        stderr += `error: cannot delete branch '${name}' used by worktree at '/'\n`;
        exitCode = 1;
      } else if (!force && !(await ctx.repo.isAncestor(oid, ctx.state.head))) {
        stderr +=
          `error: the branch '${name}' is not fully merged\n` +
          `hint: If you are sure you want to delete it, run 'git branch -D ${name}'\n` +
          'hint: Disable this message with "git config advice.forceDeleteBranch false"\n';
        exitCode = 1;
      } else {
        delete refs[name];
        stdout += `Deleted branch ${name} (was ${abbrev(oid)}).\n`;
      }
    }
    if (stdout && !(await ctx.save(ctx.state.head, ctx.state.index, { branch: ctx.state.branch, refs }))) throw new GitFatal(INDEX_LOCKED);
    return { stdout, stderr, exitCode };
  }

  const listing = ["-l", "--list", "-a", "--all", "-v", "-vv", "--verbose"].some((f) => o.has(f));
  if (o.positional.length > 0 && !listing) {
    const name = o.positional[0]!;
    const start = o.positional[1];
    if (!validBranchName(name)) throw new GitFatal(`fatal: '${name}' is not a valid branch name\n`);
    const force = o.has("-f") || o.has("--force");
    if (Object.hasOwn(ctx.state.refs, name) && !force) throw new GitFatal(`fatal: a branch named '${name}' already exists\n`);
    if (name === ctx.state.branch) throw new GitFatal(`fatal: cannot force update the branch '${name}' used by worktree at '/'\n`);
    const oid = start === undefined ? ctx.state.head : await resolveCommit(ctx, start);
    const refs = { ...ctx.state.refs, [name]: oid };
    if (!(await ctx.save(ctx.state.head, ctx.state.index, { branch: ctx.state.branch, refs }))) throw new GitFatal(INDEX_LOCKED);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  const names = Object.keys(ctx.state.refs).sort(compareNames);
  const shown = o.positional.length > 0 ? names.filter((n) => o.positional.some((p) => matchesBranchPattern(p, n))) : names;
  const mark = (n: string) => (n === ctx.state.branch ? "* " : "  ");
  if (o.has("-v") || o.has("-vv") || o.has("--verbose")) {
    const width = Math.max(0, ...shown.map((n) => n.length));
    const lines: string[] = [];
    for (const n of shown) {
      const oid = ctx.state.refs[n]!;
      lines.push(`${mark(n)}${n.padEnd(width)} ${abbrev(oid)} ${subjectOf((await ctx.repo.commit(oid)).message)}\n`);
    }
    return { stdout: lines.join(""), stderr: "", exitCode: 0 };
  }
  return { stdout: shown.map((n) => `${mark(n)}${n}\n`).join(""), stderr: "", exitCode: 0 };
};

export const config: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["--get", "-l", "--list", "--global", "--local", "--system", "--unset", "--add", "--replace-all", "--show-origin", "--bool", "--int"] });
  const keys = o.positional[0] === "get" ? o.positional.slice(1) : o.positional;
  if (o.has("--unset") || o.has("--add") || o.has("--replace-all") || keys.length >= 2 || o.positional[0] === "set") {
    return notAvailable("config", "the configuration is fixed here: the author of a commit is the person who asks for it, and there is no remote yet.");
  }
  const values: Readonly<Record<string, string>> = { "user.name": ctx.identity.name, "user.email": ctx.identity.email, "init.defaultbranch": "main", "core.bare": "false" };
  if (o.has("-l") || o.has("--list")) return { stdout: `user.name=${ctx.identity.name}\nuser.email=${ctx.identity.email}\n`, stderr: "", exitCode: 0 };
  const value = keys[0] === undefined ? undefined : values[keys[0].toLowerCase()];
  return value === undefined ? { stdout: "", stderr: "", exitCode: 1 } : { stdout: `${value}\n`, stderr: "", exitCode: 0 };
};

export const init: Command = async () => ({ stdout: "Reinitialized existing Git repository in /.git/\n", stderr: "", exitCode: 0 });

export const remote: Command = async (_ctx, args) => {
  const [sub] = args.filter((a) => !a.startsWith("-"));
  if (sub === undefined) return { stdout: "", stderr: "", exitCode: 0 };
  return notAvailable(`remote ${sub}`, NO_REMOTE);
};

export const push: Command = async () => ({
  stdout: "",
  stderr:
    "fatal: No configured push destination.\n" +
    "Either specify the URL from the command-line or configure a remote repository using\n\n" +
    "    git remote add <name> <url>\n\n" +
    "and then push using the remote name\n\n" +
    "    git push <name>\n\n",
  exitCode: 128,
});

/** With no remote, git fetch has nothing to do and says nothing. */
export const fetch: Command = async () => ({ stdout: "", stderr: "", exitCode: 0 });

export const pull: Command = async () => ({
  stdout: "",
  stderr:
    "There is no tracking information for the current branch.\n" +
    "Please specify which branch you want to merge with.\n" +
    "See git-pull(1) for details.\n\n" +
    "    git pull <remote> <branch>\n\n" +
    "If you wish to set tracking information for this branch you can do so with:\n\n" +
    "    git branch --set-upstream-to=<remote>/<branch> main\n\n",
  exitCode: 1,
});
