// The small ones: ls-files, rev-parse, branch, config, init.
import { oidOfContent } from "../content";
import type { Command } from "../command";
import { abbrev } from "../diff";
import { GitFatal, INDEX_LOCKED, notAvailable, unknownRevision } from "../errors";
import { subjectOf } from "../format";
import { compareNames } from "../objects";
import { parseOptions } from "../options";
import { matchesPathspec, quotePath, relativeToCwd, resolveFromCwd } from "../paths";
import { tracking } from "../remotes";
import { resolveCommit, resolveRevision } from "../revisions";
import { validBranchName } from "./switch";

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
    flags: ["-a", "--all", "-l", "--list", "-v", "-vv", "--verbose", "--show-current", "-r", "--remotes", "--no-color", "-d", "-D", "--delete", "-f", "--force", "-m", "-M", "-c", "-C", "--move", "--copy", "--unset-upstream"],
    values: ["-u", "--set-upstream-to"],
  });
  for (const f of ["-m", "-M", "-c", "-C", "--move", "--copy"]) {
    if (o.has(f)) {
      return notAvailable(`branch ${f}`, "renaming or copying a branch isn't available here yet: create the new one with git branch <new> <old>, then delete the old one with git branch -d <old>.");
    }
  }
  const upstreamTo = o.value("-u") ?? o.value("--set-upstream-to");
  if (upstreamTo !== undefined || o.has("--unset-upstream")) {
    const local = o.positional[0] ?? ctx.state.branch;
    if (!Object.hasOwn(ctx.state.refs, local)) throw new GitFatal(`fatal: branch '${local}' does not exist\n`);
    const upstreams = { ...ctx.state.upstreams };
    let stdout = "";
    if (upstreamTo === undefined) {
      if (!upstreams[local]) throw new GitFatal(`fatal: branch '${local}' has no upstream information\n`);
      delete upstreams[local];
    } else {
      const slash = upstreamTo.indexOf("/");
      const remoteName = upstreamTo.slice(0, slash);
      const theirs = upstreamTo.slice(slash + 1);
      if (slash < 0 || !ctx.state.remotes[remoteName]?.refs[theirs]) {
        throw new GitFatal(`fatal: the requested upstream branch '${upstreamTo}' does not exist\nhint: \nhint: If you are planning on basing your work on an upstream\nhint: branch that already exists at the remote, you may need to\nhint: run "git fetch" to retrieve it.\nhint: \nhint: If you are planning to push out a new local branch that\nhint: will track its remote counterpart, you may want to use\nhint: "git push -u" to set the upstream config as you push.\nhint: Disable this message with "git config advice.setUpstreamFailure false"\n`);
      }
      upstreams[local] = { remote: remoteName, branch: theirs };
      stdout = `branch '${local}' set up to track '${upstreamTo}'.\n`;
    }
    if (!(await ctx.save(ctx.state.head, ctx.state.index, { upstreams }))) throw new GitFatal(INDEX_LOCKED);
    return { stdout, stderr: "", exitCode: 0 };
  }
  if (o.has("--show-current")) return { stdout: `${ctx.state.branch}\n`, stderr: "", exitCode: 0 };
  const remoteBranches = Object.entries(ctx.state.remotes)
    .flatMap(([r, rem]) => Object.keys(rem.refs).map((b) => ({ name: `${r}/${b}`, oid: rem.refs[b]! })))
    .sort((a, b) => compareNames(a.name, b.name));
  if (o.has("-r") || o.has("--remotes")) return { stdout: remoteBranches.map((r) => `  ${r.name}\n`).join(""), stderr: "", exitCode: 0 };

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
    // Like git, deleting a branch deletes its configuration: its upstream goes with it.
    const upstreams = Object.fromEntries(Object.entries(ctx.state.upstreams).filter(([b]) => Object.hasOwn(refs, b)));
    if (stdout && !(await ctx.save(ctx.state.head, ctx.state.index, { branch: ctx.state.branch, refs, upstreams }))) throw new GitFatal(INDEX_LOCKED);
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
  const all = o.has("-a") || o.has("--all");
  const remoteShown = all ? remoteBranches.map((r) => ({ ...r, name: `remotes/${r.name}` })) : [];
  const verbose = o.has("-v") || o.has("-vv") || o.has("--verbose");
  if (verbose) {
    const veryVerbose = args.some((a) => /^-vv+$/.test(a)) || args.filter((a) => a === "-v" || a === "--verbose").length > 1;
    const width = Math.max(0, ...shown.map((n) => n.length), ...remoteShown.map((r) => r.name.length));
    const lines: string[] = [];
    for (const n of shown) {
      const oid = ctx.state.refs[n]!;
      let up = "";
      const t = veryVerbose ? await tracking(ctx, n) : null;
      if (t) {
        const where = t.gone ? "gone" : [t.ahead ? `ahead ${t.ahead}` : "", t.behind ? `behind ${t.behind}` : ""].filter(Boolean).join(", ");
        up = `[${t.upstream}${where ? `: ${where}` : ""}] `;
      }
      lines.push(`${mark(n)}${n.padEnd(width)} ${abbrev(oid)} ${up}${subjectOf((await ctx.repo.commit(oid)).message)}\n`);
    }
    for (const r of remoteShown) lines.push(`  ${r.name.padEnd(width)} ${abbrev(r.oid)} ${subjectOf((await ctx.repo.commit(r.oid)).message)}\n`);
    return { stdout: lines.join(""), stderr: "", exitCode: 0 };
  }
  return { stdout: [...shown.map((n) => `${mark(n)}${n}\n`), ...remoteShown.map((r) => `  ${r.name}\n`)].join(""), stderr: "", exitCode: 0 };
};

export const config: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["--get", "-l", "--list", "--global", "--local", "--system", "--unset", "--add", "--replace-all", "--show-origin", "--bool", "--int"] });
  const keys = o.positional[0] === "get" ? o.positional.slice(1) : o.positional;
  if (o.has("--unset") || o.has("--add") || o.has("--replace-all") || keys.length >= 2 || o.positional[0] === "set") {
    return notAvailable("config", "the configuration is fixed here: the author of a commit is the person who asks for it; add remotes with git remote add.");
  }
  // Fixed, as if set: pull merges (pull.rebase=false), push.default=simple; each remote and upstream as git keeps them.
  const values: Record<string, string> = { "user.name": ctx.identity.name, "user.email": ctx.identity.email, "init.defaultbranch": "main", "core.bare": "false", "pull.rebase": "false", "push.default": "simple" };
  for (const [name, rem] of Object.entries(ctx.state.remotes)) {
    values[`remote.${name}.url`.toLowerCase()] = rem.url;
    values[`remote.${name}.fetch`.toLowerCase()] = `+refs/heads/*:refs/remotes/${name}/*`;
  }
  for (const [b, up] of Object.entries(ctx.state.upstreams)) {
    values[`branch.${b}.remote`.toLowerCase()] = up.remote;
    values[`branch.${b}.merge`.toLowerCase()] = `refs/heads/${up.branch}`;
  }
  if (o.has("-l") || o.has("--list")) return { stdout: `user.name=${ctx.identity.name}\nuser.email=${ctx.identity.email}\n`, stderr: "", exitCode: 0 };
  const value = keys[0] === undefined ? undefined : values[keys[0].toLowerCase()];
  return value === undefined ? { stdout: "", stderr: "", exitCode: 1 } : { stdout: `${value}\n`, stderr: "", exitCode: 0 };
};

export const init: Command = async () => ({ stdout: "Reinitialized existing Git repository in /.git/\n", stderr: "", exitCode: 0 });
