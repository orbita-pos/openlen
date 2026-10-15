// `git log`: the history from HEAD (or a commit, or a range), filtered by path, author or
// message, in git's formats, with -p / --stat / --name-only / --name-status.
import type { Command, CommandContext } from "../command";
import { commitHeader, normalizeLogArgs, parseDateMode, parsePretty, type Display } from "../format";
import type { Commit } from "../objects";
import { parseOptions, type Options } from "../options";
import { matchesPathspec } from "../paths";
import { grepRegExp } from "../regex";
import { revisionsAndPaths } from "../revisions";
import { DIFF_FLAGS, DIFF_VALUES, changedFiles, commitSource, diffOutputOf, renderChanges, type DiffOutput } from "../sources";

export const LOG_FLAGS = [...DIFF_FLAGS, "--oneline", "--abbrev-commit", "--no-abbrev-commit", "--decorate", "--no-decorate", "--graph", "--reverse", "--all", "--follow", "--first-parent", "--no-merges", "-s"];
export const LOG_VALUES = [...DIFF_VALUES, "-n", "--max-count", "--skip", "--format", "--pretty", "--author", "--grep", "--date"];

export function displayOf(ctx: CommandContext, o: Options): Display {
  return {
    pretty: parsePretty(o),
    abbrevCommit: (o.has("--oneline") || o.has("--abbrev-commit")) && !o.has("--no-abbrev-commit"),
    date: parseDateMode(o.value("--date")),
    decorate: o.has("--decorate") && !o.has("--no-decorate"),
    now: ctx.now,
    head: ctx.state.head,
  };
}

async function touches(ctx: CommandContext, c: Commit, specs: readonly string[]): Promise<boolean> {
  if (specs.length === 0) return true;
  const now = await ctx.repo.files(c.tree);
  const before = c.parents[0] ? await ctx.repo.filesOfCommit(c.parents[0]) : new Map<string, string>();
  for (const p of new Set([...now.keys(), ...before.keys()])) {
    if (specs.some((s) => matchesPathspec(s, p)) && now.get(p) !== before.get(p)) return true;
  }
  return false;
}

export async function changesText(ctx: CommandContext, c: Commit, out: DiffOutput, specs: readonly string[]): Promise<string> {
  if (!(out.patch || out.stat || out.numstat || out.shortstat || out.nameOnly || out.nameStatus)) return "";
  const files = await changedFiles(await commitSource(ctx, c.parents[0] ?? null), { files: await ctx.repo.files(c.tree), text: (_p, oid) => ctx.repo.text(oid) }, specs);
  return renderChanges(files, out);
}

/** One entry per commit, joined the way git joins each format. */
export async function renderEntries(ctx: CommandContext, entries: readonly { oid: string; commit: Commit }[], d: Display, out: DiffOutput, specs: readonly string[], graph: boolean): Promise<string> {
  const texts: string[] = [];
  for (const { oid, commit } of entries) {
    const header = commitHeader(oid, commit, d);
    const changes = await changesText(ctx, commit, out, specs);
    switch (d.pretty.kind) {
      case "oneline":
        texts.push(`${header}${changes}`);
        break;
      case "tformat":
        texts.push(`${header}\n${changes ? `\n${changes}` : ""}`);
        break;
      case "format":
        texts.push(`${header}${changes ? `\n\n${changes}` : ""}`);
        break;
      default:
        texts.push(`${header}${changes ? `\n${changes}` : ""}`);
    }
  }
  const separator = d.pretty.kind === "format" || (d.pretty.kind !== "oneline" && d.pretty.kind !== "tformat") ? "\n" : "";
  if (!graph) return texts.join(separator);
  // A one-line history, as git draws it: "* " before each commit, "| " before its other lines
  // while it has a parent ("  " under the root commit), and the blank separator line is "| " too.
  return texts
    .map((text, k) => {
      const rest = entries[k]!.commit.parents.length > 0 ? "| " : "  ";
      const lines = text.replace(/\n$/, "").split("\n");
      const body = lines.map((l, i) => `${i === 0 ? "* " : rest}${l}`).join("\n");
      return `${body}\n${separator === "\n" && k < texts.length - 1 ? `${rest}\n` : ""}`;
    })
    .join("");
}

export const log: Command = async (ctx, args) => {
  const o = parseOptions(normalizeLogArgs(args), { flags: LOG_FLAGS, values: LOG_VALUES });
  const display = displayOf(ctx, o);
  const { revisions, paths } = await revisionsAndPaths(ctx, o.positional, o.afterDashDash);
  let start = ctx.state.head;
  const exclude = new Set<string>();
  for (const r of revisions) {
    if (r.kind === "single") start = r.oid;
    else {
      start = r.to;
      if (!r.symmetric) for await (const { oid } of ctx.repo.history(r.from)) exclude.add(oid);
    }
  }
  const author = o.value("--author");
  const grep = o.value("--grep");
  const authorRe = author !== undefined ? grepRegExp([author], {}) : null;
  const grepRe = grep !== undefined ? grepRegExp([grep], {}) : null;
  let entries: { oid: string; commit: Commit }[] = [];
  for await (const entry of ctx.repo.history(start)) {
    if (exclude.has(entry.oid)) break;
    if (authorRe && !authorRe.test(`${entry.commit.author.name} <${entry.commit.author.email}>`)) continue;
    if (grepRe && !grepRe.test(entry.commit.message)) continue;
    if (!(await touches(ctx, entry.commit, paths))) continue;
    entries.push(entry);
  }
  const skip = Number(o.value("--skip") ?? 0);
  const max = Number(o.value("-n") ?? o.value("--max-count") ?? Number.POSITIVE_INFINITY);
  entries = entries.slice(skip, skip + max);
  if (o.has("--reverse")) entries.reverse();
  const output = diffOutputOf(o, false);
  return { stdout: await renderEntries(ctx, entries, display, output, paths, o.has("--graph")), stderr: "", exitCode: 0 };
};
