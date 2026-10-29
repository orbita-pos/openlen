// `git add`: stage new, changed and deleted files by pathspec; -A, -u, -n, -v; an ignored file needs -f.
import { blobForContent } from "../content";
import type { Command } from "../command";
import { GitFatal, INDEX_LOCKED } from "../errors";
import { type GitObject } from "../objects";
import { parseOptions } from "../options";
import { matchesPathspec, relativeToCwd, resolveFromCwd } from "../paths";

export const add: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["-A", "--all", "-u", "--update", "-f", "--force", "-v", "--verbose", "-n", "--dry-run", "--no-ignore-removal"] });
  const all = o.has("-A") || o.has("--all");
  const update = o.has("-u") || o.has("--update");
  const force = o.has("-f") || o.has("--force");
  const dryRun = o.has("-n") || o.has("--dry-run");
  const verbose = dryRun || o.has("-v") || o.has("--verbose");
  const typed = [...o.positional, ...(o.afterDashDash ?? [])];
  if (typed.length === 0 && !all && !update) {
    return {
      stdout: "",
      stderr: "Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?\nhint: Disable this message with \"git config advice.addEmptyPathspec false\"\n",
      exitCode: 0,
    };
  }
  const specs = typed.length === 0 ? [""] : typed.map((a) => resolveFromCwd(ctx.cwd, a));
  const index: Record<string, string> = { ...ctx.state.index };
  const blobs: GitObject[] = [];
  const lines: string[] = [];
  const ignored: string[] = [];
  specs.forEach((spec, k) => {
    let matched = false;
    let onlyIgnored = false;
    for (const [p, content] of ctx.tree.files) {
      if (!matchesPathspec(spec, p)) continue;
      if (index[p] === undefined) {
        if (update) continue;
        if (ctx.tree.isIgnored(p) && !force) {
          onlyIgnored = true;
          continue;
        }
      }
      matched = true;
      const blob = blobForContent(content);
      if (index[p] !== blob.oid) {
        index[p] = blob.oid;
        blobs.push(blob);
        lines.push(`add '${p}'`);
      }
    }
    for (const p of Object.keys(index)) {
      if (!matchesPathspec(spec, p) || ctx.tree.files.has(p)) continue;
      matched = true;
      delete index[p];
      lines.push(`remove '${p}'`);
    }
    if (matched) return;
    // A file or folder (not a glob) that only matches ignored files: git lists it as ignored.
    if (onlyIgnored && !/[*?[]/.test(spec)) {
      ignored.push(relativeToCwd(ctx.cwd, spec) || ".");
      return;
    }
    throw new GitFatal(`fatal: pathspec '${typed[k] ?? ""}' did not match any files\n`);
  });
  const stdout = verbose && lines.length > 0 ? `${lines.join("\n")}\n` : "";
  // In a merge, adding an unmerged path marks it resolved, whatever its content.
  const merge = ctx.state.merge;
  const resolved = Object.keys(merge?.conflicts ?? {}).filter((p) => specs.some((s) => matchesPathspec(s, p)));
  const nextMerge = merge && resolved.length > 0 ? { ...merge, conflicts: Object.fromEntries(Object.entries(merge.conflicts).filter(([p]) => !resolved.includes(p))) } : undefined;
  if (!dryRun && (blobs.length > 0 || lines.length > 0 || nextMerge)) {
    await ctx.repo.store.writeObjects(blobs);
    if (!(await ctx.save(ctx.state.head, index, undefined, nextMerge))) throw new GitFatal(INDEX_LOCKED);
  }
  if (ignored.length > 0) {
    return {
      stdout,
      stderr: `The following paths are ignored by one of your .gitignore files:\n${ignored.join("\n")}\nhint: Use -f if you really want to add them.\nhint: Disable this message with "git config advice.addIgnoredFile false"\n`,
      exitCode: 1,
    };
  }
  return { stdout, stderr: "", exitCode: 0 };
};
