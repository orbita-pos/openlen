// `git show`: a commit with its diff (the root one against the empty tree), or a file at a commit
// (`HEAD:path`, `HEAD:./path` from the cwd, `:path` from the index).
import type { Command, CommandContext } from "../command";
import { GitFatal } from "../errors";
import { normalizeLogArgs } from "../format";
import { parseOptions } from "../options";
import { resolveFromCwd } from "../paths";
import { resolveCommit, resolveRevision } from "../revisions";
import { diffOutputOf } from "../sources";
import { LOG_FLAGS, LOG_VALUES, displayOf, renderEntries } from "./log";

async function showFile(ctx: CommandContext, rev: string, rawPath: string): Promise<string> {
  const p = rawPath.startsWith("./") || rawPath.startsWith("../") ? resolveFromCwd(ctx.cwd, rawPath) : rawPath.replace(/^\/+|\/+$/g, "");
  let files: ReadonlyMap<string, string>;
  if (rev === "") files = new Map(Object.entries(ctx.state.index));
  else {
    const oid = await resolveRevision(ctx, rev);
    if (!oid) throw new GitFatal(`fatal: invalid object name '${rev}'.\n`);
    files = await ctx.repo.filesOfCommit(oid);
  }
  const blob = files.get(p);
  if (blob) return ctx.repo.text(blob);
  const under = [...files.keys()].filter((f) => p === "" || f.startsWith(`${p}/`));
  if (under.length > 0) {
    const names = [...new Set(under.map((f) => {
      const rest = p === "" ? f : f.slice(p.length + 1);
      const slash = rest.indexOf("/");
      return slash < 0 ? rest : `${rest.slice(0, slash)}/`;
    }))];
    return `tree ${rev}:${rawPath}\n\n${names.join("\n")}\n`;
  }
  const where = rev === "" ? "the index" : `'${rev}'`;
  if (ctx.tree.files.has(p)) throw new GitFatal(`fatal: path '${p}' exists on disk, but not in ${where}\n`);
  throw new GitFatal(`fatal: path '${p}' does not exist in ${where}\n`);
}

export const show: Command = async (ctx, args) => {
  const o = parseOptions(normalizeLogArgs(args), { flags: LOG_FLAGS, values: LOG_VALUES });
  const display = displayOf(ctx, o);
  const output = diffOutputOf(o, !o.has("-s"));
  const targets = o.positional.length > 0 ? o.positional : ["HEAD"];
  let out = "";
  for (const target of targets) {
    const colon = target.indexOf(":");
    if (colon >= 0) {
      out += await showFile(ctx, target.slice(0, colon), target.slice(colon + 1));
      continue;
    }
    const oid = await resolveCommit(ctx, target);
    const entry = { oid, commit: await ctx.repo.commit(oid) };
    out += await renderEntries(ctx, [entry], display, output, o.afterDashDash?.map((a) => resolveFromCwd(ctx.cwd, a)) ?? [], false, true);
  }
  return { stdout: out, stderr: "", exitCode: 0 };
};
