// `git grep`: tracked files (working tree, --cached, or a commit), the current folder by default,
// git's pattern flavours, and its output (path:line, -n, -l, -c, -q). Exit 1 when nothing matches.
import type { Command } from "../command";
import { GitFatal } from "../errors";
import { compareNames } from "../objects";
import { parseOptions } from "../options";
import { matchesPathspec, quotePath, relativeToCwd, resolveFromCwd } from "../paths";
import { grepRegExp } from "../regex";
import { resolveRevision } from "../revisions";

export const grep: Command = async (ctx, args) => {
  const o = parseOptions(args, {
    flags: ["-n", "--line-number", "-i", "--ignore-case", "-l", "--files-with-matches", "--name-only", "-L", "--files-without-match", "-w", "--word-regexp", "-E", "--extended-regexp", "-F", "--fixed-strings", "-G", "--basic-regexp", "-P", "--perl-regexp", "-c", "--count", "-v", "--invert-match", "-h", "-H", "-q", "--quiet", "--cached", "--no-color", "-I"],
    values: ["-e"],
    repeated: ["-e"],
  });
  const rest = [...o.positional];
  const patterns = [...o.all("-e")];
  if (patterns.length === 0) {
    const p = rest.shift();
    if (p === undefined) throw new GitFatal("fatal: no pattern given\n");
    patterns.push(p);
  }
  const revs: { spec: string; oid: string }[] = [];
  while (rest.length > 0) {
    const oid = await resolveRevision(ctx, rest[0]!);
    if (!oid) break;
    revs.push({ spec: rest.shift()!, oid });
  }
  const typed = [...rest, ...(o.afterDashDash ?? [])];
  const scope = typed.length > 0 ? typed.map((a) => resolveFromCwd(ctx.cwd, a)) : [ctx.cwd];
  const re = grepRegExp(patterns, {
    fixed: o.has("-F") || o.has("--fixed-strings"),
    extended: o.has("-E") || o.has("--extended-regexp"),
    perl: o.has("-P") || o.has("--perl-regexp"),
    ignoreCase: o.has("-i") || o.has("--ignore-case"),
    word: o.has("-w") || o.has("--word-regexp"),
  });
  const invert = o.has("-v") || o.has("--invert-match");
  const sources: { prefix: string; files: [string, () => Promise<string>][] }[] = [];
  if (revs.length > 0) {
    for (const r of revs) {
      const files = await ctx.repo.filesOfCommit(r.oid);
      sources.push({ prefix: `${r.spec}:`, files: [...files].map(([p, oid]) => [p, () => ctx.repo.text(oid)]) });
    }
  } else if (o.has("--cached")) {
    sources.push({ prefix: "", files: Object.entries(ctx.state.index).map(([p, oid]) => [p, () => ctx.repo.text(oid)]) });
  } else {
    const tracked = Object.keys(ctx.state.index).filter((p) => ctx.tree.files.has(p));
    sources.push({ prefix: "", files: tracked.map((p) => [p, async () => ctx.tree.files.get(p)!]) });
  }
  const lineNumbers = o.has("-n") || o.has("--line-number");
  const names = !o.has("-h");
  let out = "";
  let any = false;
  for (const source of sources) {
    for (const [p, read] of source.files.filter(([p]) => scope.some((s) => matchesPathspec(s, p))).sort((a, b) => compareNames(a[0], b[0]))) {
      const text = await read();
      const shownName = `${source.prefix}${quotePath(relativeToCwd(ctx.cwd, p))}`;
      const lines = text.replace(/\n$/, "").split("\n");
      const hits = lines.map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => re.test(line) !== invert);
      if (o.has("-L") || o.has("--files-without-match")) {
        if (hits.length === 0) out += `${shownName}\n`;
        continue;
      }
      if (hits.length === 0) continue;
      any = true;
      if (text.includes("\0")) out += `Binary file ${shownName} matches\n`;
      else if (o.has("-l") || o.has("--files-with-matches") || o.has("--name-only")) out += `${shownName}\n`;
      else if (o.has("-c") || o.has("--count")) out += `${shownName}:${hits.length}\n`;
      else for (const h of hits) out += `${names ? `${shownName}:` : ""}${lineNumbers ? `${h.n}:` : ""}${h.line}\n`;
    }
  }
  if (o.has("-q") || o.has("--quiet")) return { stdout: "", stderr: "", exitCode: any ? 0 : 1 };
  return { stdout: out, stderr: "", exitCode: any || ((o.has("-L") || o.has("--files-without-match")) && out !== "") ? 0 : 1 };
};
