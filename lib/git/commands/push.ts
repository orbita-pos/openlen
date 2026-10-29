// `git push [-u] [-f | --force-with-lease] [<remote> [<branch>... | --delete <branch>]]` (spec local
// 2026-10-28-ficheros-al-nivel-de-claude-code, §8), as git 2.45 with push.default=simple: the checks git makes before
// sending (fetch first, non-fast-forward, stale info), then receive-pack from the server, and git's lines on stderr.
// Never forcing the main branch is Claude Code's protocol, in the prompt, not a rule of this command — as in git.
import type { Command, CommandContext } from "../command";
import { abbrev } from "../diff";
import { GitFatal, INDEX_LOCKED } from "../errors";
import { NULL_OID } from "../objects";
import { parseOptions } from "../options";
import { credentials, noSuchRemote, objectsToPush, present, remoteFatal, remoteRefs } from "../remotes";
import { receivePack, type RefUpdate } from "../remote/smart-http";
import type { Remote, Upstream } from "../store";

const NO_DESTINATION =
  "fatal: No configured push destination.\n" +
  "Either specify the URL from the command-line or configure a remote repository using\n\n" +
  "    git remote add <name> <url>\n\n" +
  "and then push using the remote name\n\n" +
  "    git push <name>\n\n";

const HINT_FETCH_FIRST =
  "hint: Updates were rejected because the remote contains work that you do not\n" +
  "hint: have locally. This is usually caused by another repository pushing to\n" +
  "hint: the same ref. If you want to integrate the remote changes, use\n" +
  "hint: 'git pull' before pushing again.\n" +
  "hint: See the 'Note about fast-forwards' in 'git push --help' for details.\n";
const HINT_NON_FF_CURRENT =
  "hint: Updates were rejected because the tip of your current branch is behind\n" +
  "hint: its remote counterpart. If you want to integrate the remote changes,\n" +
  "hint: use 'git pull' before pushing again.\n" +
  "hint: See the 'Note about fast-forwards' in 'git push --help' for details.\n";
const HINT_NON_FF_OTHER =
  "hint: Updates were rejected because a pushed branch tip is behind its remote\n" +
  "hint: counterpart. If you want to integrate the remote changes, use 'git pull'\n" +
  "hint: before pushing again.\n" +
  "hint: See the 'Note about fast-forwards' in 'git push --help' for details.\n";

function noUpstream(branch: string, remote: string): GitFatal {
  return new GitFatal(
    `fatal: The current branch ${branch} has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream ${remote} ${branch}\n\n` +
      "To have this happen automatically for branches without a tracking\nupstream, see 'push.autoSetupRemote' in 'git help config'.\n\n",
  );
}

const line = (flag: string, summary: string, refs: string, suffix = "") => ` ${flag} ${summary.padEnd(17)} ${refs}${suffix}\n`;

interface Planned {
  /** As written: a branch, or HEAD. */
  readonly src: string | null;
  readonly dst: string;
  readonly local: string;
  /** The local branch it pushes (HEAD is the current one): the one -u sets up. */
  readonly branch: string | null;
}

async function plan(ctx: CommandContext, remoteName: string, specs: readonly string[], del: boolean): Promise<Planned[]> {
  const out: Planned[] = [];
  for (const spec of specs) {
    if (del || spec.startsWith(":")) {
      out.push({ src: null, dst: spec.replace(/^:/, ""), local: NULL_OID, branch: null });
      continue;
    }
    const [src, given] = spec.replace(/^\+/, "").split(":") as [string, string?];
    // HEAD is the current branch, and lands on a branch of its name: git push -u origin HEAD.
    const branch = src === "HEAD" ? ctx.state.branch : src;
    const dst = given ?? branch;
    const local = src === "HEAD" ? ctx.state.head : ctx.state.refs[src];
    if (local === undefined) throw new GitFatal(`error: src refspec ${src} does not match any\nerror: failed to push some refs to '${ctx.state.remotes[remoteName]!.url}'\n`, 1);
    out.push({ src, dst, local, branch });
  }
  return out;
}

export const push: Command = async (ctx, args) => {
  const o = parseOptions(args, {
    flags: ["-u", "--set-upstream", "-f", "--force", "--force-with-lease", "-d", "--delete", "-q", "--quiet", "-v", "--verbose", "--no-verify", "--porcelain", "--dry-run", "-n", "--tags", "--follow-tags", "--all", "--progress", "--no-progress"],
  });
  for (const f of ["--tags", "--follow-tags", "--all", "--porcelain"]) {
    if (o.has(f)) return { stdout: "", stderr: `git push ${f}: not available here: push branches by name (git push <remote> <branch>).\n`, exitCode: 1 };
  }
  const remotes = ctx.state.remotes;
  if (Object.keys(remotes).length === 0 && o.positional.length === 0) return { stdout: "", stderr: NO_DESTINATION, exitCode: 128 };
  const branch = ctx.state.branch;
  const upstream = ctx.state.upstreams[branch];
  const remoteName = o.positional[0] ?? upstream?.remote ?? (Object.hasOwn(remotes, "origin") ? "origin" : Object.keys(remotes)[0]!);
  const remote = remotes[remoteName];
  if (!remote) throw noSuchRemote(remoteName);
  const setUpstream = o.has("-u") || o.has("--set-upstream");
  const del = o.has("-d") || o.has("--delete");
  let specs = o.positional.slice(1);
  if (specs.length === 0) {
    if (del) throw new GitFatal("fatal: --delete doesn't make sense without any refs\n");
    // push.default=simple: the current branch to its upstream (or, with -u, to the same name).
    if (!setUpstream && (!upstream || upstream.remote !== remoteName)) throw noUpstream(branch, remoteName);
    specs = [`${branch}:${setUpstream || !upstream ? branch : upstream.branch}`];
  }
  const planned = await plan(ctx, remoteName, specs, del);

  const theirs = await remoteRefs(ctx, remote.url);
  const remoteHeads = new Map(theirs.filter((r) => r.name.startsWith("refs/heads/")).map((r) => [r.name.slice("refs/heads/".length), r.oid]));
  const force = o.has("-f") || o.has("--force");
  const lease = o.has("--force-with-lease");
  const have = await present(ctx, [...remoteHeads.values()]);
  let out = "";
  let rejected: "fetch first" | "non-fast-forward" | "stale info" | null = null;
  let rejectedCurrent = false;
  const updates: (RefUpdate & { src: string | null; branch: string | null; dst: string; text: string })[] = [];
  for (const p of planned) {
    const old = remoteHeads.get(p.dst) ?? NULL_OID;
    const refs = p.src === null ? p.dst : `${p.src} -> ${p.dst}`;
    if (p.src === null) {
      if (old === NULL_OID) {
        out += line("!", "[rejected]", p.dst, " (remote ref does not exist)");
        rejected ??= "stale info";
        continue;
      }
      updates.push({ ref: `refs/heads/${p.dst}`, old, new: NULL_OID, src: null, branch: null, dst: p.dst, text: line("-", "[deleted]", p.dst) });
      continue;
    }
    if (old === p.local) continue;
    if (old === NULL_OID) {
      updates.push({ ref: `refs/heads/${p.dst}`, old, new: p.local, src: p.src, branch: p.branch, dst: p.dst, text: line("*", "[new branch]", refs) });
      continue;
    }
    const known = remote.refs[p.dst];
    if (lease && known !== old) {
      out += line("!", "[rejected]", refs, " (stale info)");
      rejected ??= "stale info";
      continue;
    }
    const fastForward = have.has(old) && (await ctx.repo.isAncestor(old, p.local));
    if (!fastForward && !force && !lease) {
      const why = have.has(old) ? "non-fast-forward" : "fetch first";
      out += line("!", "[rejected]", refs, ` (${why})`);
      rejected ??= why;
      if (p.branch === branch) rejectedCurrent = true;
      continue;
    }
    const text = fastForward ? line(" ", `${abbrev(old)}..${abbrev(p.local)}`, refs) : line("+", `${abbrev(old)}...${abbrev(p.local)}`, refs, " (forced update)");
    updates.push({ ref: `refs/heads/${p.dst}`, old, new: p.local, src: p.src, branch: p.branch, dst: p.dst, text });
  }

  if (updates.length === 0 && rejected === null) return { stdout: "", stderr: "Everything up-to-date\n", exitCode: 0 };
  let tracked: Record<string, string> = { ...remote.refs };
  const upstreams: Record<string, Upstream> = { ...ctx.state.upstreams };
  let stdout = "";
  if (updates.length > 0 && !(o.has("--dry-run") || o.has("-n"))) {
    const objects: Parameters<typeof receivePack>[2]["objects"][number][] = [];
    const known = [...remoteHeads.values()];
    for (const u of updates) if (u.new !== NULL_OID) objects.push(...(await objectsToPush(ctx, u.new, known)));
    const auth = await credentials(ctx, remote.url);
    let answer: Awaited<ReturnType<typeof receivePack>>;
    try {
      answer = await receivePack(remote.url, auth, { updates, objects });
    } catch (e) {
      throw remoteFatal(e, remote.url, auth !== null);
    }
    for (const u of updates) {
      const status = answer.refs.find((r) => r.ref === u.ref)?.status ?? "no report";
      if (status !== "ok") {
        out += line("!", "[remote rejected]", u.src === null ? u.dst : `${u.src} -> ${u.dst}`, ` (${status})`);
        rejected ??= "stale info";
        continue;
      }
      out += u.text;
      if (u.new === NULL_OID) {
        const { [u.dst]: _gone, ...rest } = tracked;
        tracked = rest;
      } else {
        tracked[u.dst] = u.new;
        if (setUpstream && u.branch !== null) {
          upstreams[u.branch] = { remote: remoteName, branch: u.dst };
          stdout += `branch '${u.branch}' set up to track '${remoteName}/${u.dst}'.\n`;
        }
      }
    }
    const next: Record<string, Remote> = { ...remotes, [remoteName]: { url: remote.url, refs: tracked } };
    if (!(await ctx.save(ctx.state.head, ctx.state.index, { remotes: next, upstreams }))) throw new GitFatal(INDEX_LOCKED);
  } else out += updates.map((u) => u.text).join("");

  let stderr = `To ${remote.url}\n${out}`;
  if (rejected !== null) {
    stderr += `error: failed to push some refs to '${remote.url}'\n`;
    if (rejected === "fetch first") stderr += HINT_FETCH_FIRST;
    else if (rejected === "non-fast-forward") stderr += rejectedCurrent ? HINT_NON_FF_CURRENT : HINT_NON_FF_OTHER;
  }
  const quiet = o.has("-q") || o.has("--quiet");
  return { stdout: quiet ? "" : stdout, stderr: quiet && rejected === null ? "" : stderr, exitCode: rejected === null ? 0 : 1 };
};
