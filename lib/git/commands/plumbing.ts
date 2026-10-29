// The small ones: ls-files, rev-parse, branch, config, init, remote, and push/pull/fetch with no remote.
import { oidOfContent } from "../content";
import type { Command } from "../command";
import { abbrev } from "../diff";
import { notAvailable, unknownRevision } from "../errors";
import { subjectOf } from "../format";
import { compareNames } from "../objects";
import { parseOptions } from "../options";
import { matchesPathspec, quotePath, relativeToCwd, resolveFromCwd } from "../paths";
import { resolveRevision } from "../revisions";
import { ONE_BRANCH } from "./checkout";

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
    else if (abbrevRef && (a === "HEAD" || a === "@" || a === "main")) out.push("main");
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

export const branch: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["-a", "--all", "-l", "--list", "-v", "--verbose", "--show-current", "-r", "--remotes", "--no-color", "-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy", "-u", "--set-upstream-to"] });
  for (const f of ["-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy", "-u", "--set-upstream-to"]) if (o.has(f)) return notAvailable(`branch ${f}`, ONE_BRANCH);
  if (o.positional.length > 0 && !o.has("-l") && !o.has("--list")) return notAvailable(`branch ${o.positional[0]}`, ONE_BRANCH);
  if (o.has("--show-current")) return { stdout: "main\n", stderr: "", exitCode: 0 };
  if (o.has("-r") || o.has("--remotes")) return { stdout: "", stderr: "", exitCode: 0 };
  if (o.has("-v") || o.has("--verbose")) {
    const subject = subjectOf((await ctx.repo.commit(ctx.state.head)).message);
    return { stdout: `* main ${abbrev(ctx.state.head)} ${subject}\n`, stderr: "", exitCode: 0 };
  }
  return { stdout: "* main\n", stderr: "", exitCode: 0 };
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
