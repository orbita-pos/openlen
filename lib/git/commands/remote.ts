// `git remote` (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8): list (-v), add, remove, get-url, set-url.
// A remote's URL is https, without credentials, and never a private address: the server talks to it, not the sandbox.
import type { Command } from "../command";
import { GitFatal, INDEX_LOCKED, notAvailable } from "../errors";
import { refusedRemoteUrl } from "../remotes";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const remote: Command = async (ctx, args) => {
  const verbose = args.includes("-v") || args.includes("--verbose");
  const rest = args.filter((a) => a !== "-v" && a !== "--verbose");
  const [sub, ...params] = rest;
  const remotes = ctx.state.remotes;
  const names = Object.keys(remotes).sort();
  if (sub === undefined) {
    const lines = verbose ? names.flatMap((n) => [`${n}\t${remotes[n]!.url} (fetch)`, `${n}\t${remotes[n]!.url} (push)`]) : names;
    return { stdout: lines.map((l) => `${l}\n`).join(""), stderr: "", exitCode: 0 };
  }
  switch (sub) {
    case "add": {
      const flags = params.filter((p) => p.startsWith("-"));
      if (flags.length > 0) return notAvailable(`remote add ${flags[0]}`, "add it with git remote add <name> <url>.");
      const [name, url] = params;
      if (name === undefined || url === undefined) throw new GitFatal("usage: git remote add [<options>] <name> <url>\n", 129);
      if (!NAME.test(name)) throw new GitFatal(`fatal: '${name}' is not a valid remote name\n`);
      if (Object.hasOwn(remotes, name)) throw new GitFatal(`error: remote ${name} already exists.\n`, 3);
      const refused = await refusedRemoteUrl(url);
      if (refused) throw new GitFatal(refused);
      if (!(await ctx.save(ctx.state.head, ctx.state.index, { remotes: { ...remotes, [name]: { url, refs: {} } } }))) throw new GitFatal(INDEX_LOCKED);
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    case "remove":
    case "rm": {
      const [name] = params;
      if (name === undefined) throw new GitFatal("usage: git remote remove <name>\n", 129);
      if (!Object.hasOwn(remotes, name)) throw new GitFatal(`error: No such remote: '${name}'\n`, 2);
      const { [name]: _gone, ...kept } = remotes;
      const upstreams = Object.fromEntries(Object.entries(ctx.state.upstreams).filter(([, u]) => u.remote !== name));
      if (!(await ctx.save(ctx.state.head, ctx.state.index, { remotes: kept, upstreams }))) throw new GitFatal(INDEX_LOCKED);
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    case "get-url": {
      const name = params.find((p) => !p.startsWith("-"));
      if (name === undefined || !Object.hasOwn(remotes, name)) throw new GitFatal(`error: No such remote '${name ?? ""}'\n`, 2);
      return { stdout: `${remotes[name]!.url}\n`, stderr: "", exitCode: 0 };
    }
    case "set-url": {
      const [name, url] = params.filter((p) => !p.startsWith("-"));
      if (name === undefined || url === undefined) throw new GitFatal("usage: git remote set-url [--push] <name> <newurl> [<oldurl>]\n", 129);
      if (!Object.hasOwn(remotes, name)) throw new GitFatal(`error: No such remote '${name}'\n`, 2);
      const refused = await refusedRemoteUrl(url);
      if (refused) throw new GitFatal(refused);
      if (!(await ctx.save(ctx.state.head, ctx.state.index, { remotes: { ...remotes, [name]: { ...remotes[name]!, url } } }))) throw new GitFatal(INDEX_LOCKED);
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    default:
      return notAvailable(`remote ${sub}`, "the remote commands here are add, remove, get-url, set-url and -v.");
  }
};
