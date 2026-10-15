// `git blame <file>`: who last changed each line, walking the one-line history; lines changed in
// the working tree are "Not Committed Yet". The root commit is a boundary ("^").
import type { Command } from "../command";
import { changedLines, records } from "../diff";
import { GitFatal } from "../errors";
import { formatDate } from "../format";
import type { Commit, Signature } from "../objects";
import { parseOptions } from "../options";
import { resolveFromCwd } from "../paths";
import { resolveCommit } from "../revisions";

/** For each line of `b`, its index in `a`; -1 if the line is new in `b`. */
function lineMap(a: readonly string[], b: readonly string[]): number[] {
  const ch = changedLines(a, b) ?? { a: a.map(() => true), b: b.map(() => true) };
  const out: number[] = [];
  let i = 0;
  for (let j = 0; j < b.length; j++) {
    if (ch.b[j]) {
      out.push(-1);
      continue;
    }
    while (ch.a[i]) i++;
    out.push(i++);
  }
  return out;
}

export const blame: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["-s", "-e", "--show-email", "-l"], values: ["-L"] });
  const typed = [...o.positional, ...(o.afterDashDash ?? [])];
  if (typed.length === 0 || typed.length > 2) throw new GitFatal("usage: git blame [<options>] [<rev-opts>] [<rev>] [--] <file>\n", 129);
  const rev = typed.length === 2 ? await resolveCommit(ctx, typed[0]!) : null;
  const path = resolveFromCwd(ctx.cwd, typed.at(-1)!);
  const textAt = async (commitOid: string): Promise<string | null> => {
    const blob = (await ctx.repo.filesOfCommit(commitOid)).get(path);
    return blob === undefined ? null : ctx.repo.text(blob);
  };
  const where = rev ? typed[0]! : "HEAD";
  const headText = await textAt(rev ?? ctx.state.head);
  if (headText === null) throw new GitFatal(`fatal: no such path '${path}' in ${where}\n`);
  const target = rev ? headText : (ctx.tree.files.get(path) ?? headText);
  const lines = records(target);
  const owner: (string | null)[] = new Array<string | null>(lines.length).fill(null);
  let pending = lines.map((_, i) => ({ final: i, at: i }));
  let current = lines;
  const map = (prev: readonly string[], oid: string | null) => {
    const m = lineMap(prev, current);
    pending = pending.filter((p) => {
      const at = m[p.at]!;
      if (at < 0) {
        owner[p.final] = oid;
        return false;
      }
      p.at = at;
      return true;
    });
    current = [...prev];
  };
  if (!rev) map(records(headText), null);
  const commits = new Map<string, Commit>();
  let oid = rev ?? ctx.state.head;
  while (pending.length > 0) {
    const c = await ctx.repo.commit(oid);
    commits.set(oid, c);
    const parent = c.parents[0];
    const prevText = parent ? await textAt(parent) : null;
    if (prevText === null) {
      for (const p of pending) owner[p.final] = oid;
      break;
    }
    map(records(prevText), oid);
    oid = parent!;
  }
  let from = 1;
  let to = lines.length;
  const range = o.value("-L");
  if (range !== undefined) {
    const m = /^(\d+),(\d+)$/.exec(range);
    if (!m) throw new GitFatal(`fatal: invalid -L argument '${range}'\n`, 128);
    from = Number(m[1]);
    to = Number(m[2]);
    if (to > lines.length) throw new GitFatal(`fatal: file ${path} has only ${lines.length} lines\n`);
  }
  const notCommitted: Signature = { name: "Not Committed Yet", email: "not.committed.yet", timestamp: Math.floor(ctx.now.getTime() / 1000), timezone: "+0000" };
  const sigOf = (own: string | null) => (own === null ? notCommitted : commits.get(own)!.author);
  const email = o.has("-e") || o.has("--show-email");
  const who = (own: string | null) => (email ? `<${sigOf(own).email}>` : sigOf(own).name);
  const shown = lines.slice(from - 1, to).map((_, k) => owner[from - 1 + k]!);
  const width = Math.max(...shown.map((own) => who(own).length));
  const digits = String(to).length;
  const long = o.has("-l");
  const hexOf = (own: string | null): string => {
    if (own === null) return "0".repeat(long ? 40 : 8);
    const boundary = commits.get(own)!.parents.length === 0;
    return boundary ? `^${own.slice(0, long ? 39 : 7)}` : own.slice(0, long ? 40 : 8);
  };
  let out = "";
  for (let n = from; n <= to; n++) {
    const own = owner[n - 1]!;
    const body = lines[n - 1]!.replace(/\n$/, "");
    const number = String(n).padStart(digits);
    out += o.has("-s")
      ? `${hexOf(own)} ${number}) ${body}\n`
      : `${hexOf(own)} (${who(own).padEnd(width)} ${formatDate(sigOf(own), "iso", ctx.now)} ${number}) ${body}\n`;
  }
  return { stdout: out, stderr: "", exitCode: 0 };
};
