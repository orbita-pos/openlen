// `git log`: the history from HEAD (or a commit, or a range), filtered by path, author or
// message, in git's formats, with -p / --stat / --name-only / --name-status.
import type { Command, CommandContext } from "../command";
import { commitHeader, normalizeLogArgs, parseDateMode, parsePretty, type Display, decorationsOf } from "../format";
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
    decorations: decorationsOf(ctx.state),
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

export async function changesText(ctx: CommandContext, c: Commit, wanted: DiffOutput, specs: readonly string[], isShow = false): Promise<string> {
  let out = wanted;
  // A merge: git log shows no diff for it; git show its combined diff (--cc), whose stats are against the first parent
  // and whose patch and names are empty when each file came whole from one side. A merge that resolved a conflict by
  // hand would show a --cc hunk in git: not here.
  if (c.parents.length > 1) {
    if (!isShow) return "";
    out = { ...out, patch: false, nameOnly: false, nameStatus: false };
  }
  if (!(out.patch || out.stat || out.numstat || out.shortstat || out.nameOnly || out.nameStatus)) return "";
  const files = await changedFiles(await commitSource(ctx, c.parents[0] ?? null), { files: await ctx.repo.files(c.tree), text: (_p, oid) => ctx.repo.text(oid) }, specs);
  return renderChanges(files, out);
}

/** One entry per commit, joined the way git joins each format. */
export async function renderEntries(ctx: CommandContext, entries: readonly { oid: string; commit: Commit }[], d: Display, out: DiffOutput, specs: readonly string[], graph: boolean, isShow = false): Promise<string> {
  const texts: string[] = [];
  for (const { oid, commit } of entries) {
    const header = commitHeader(oid, commit, d);
    const changes = await changesText(ctx, commit, out, specs, isShow);
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
      default: {
        // git show of a merge keeps the blank line before its (empty) combined diff.
        const emptyCombined = isShow && commit.parents.length > 1 && !changes && (out.patch || out.nameOnly || out.nameStatus);
        texts.push(`${header}${changes ? `\n${changes}` : emptyCombined ? "\n" : ""}`);
      }
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
  const starts: string[] = [];
  const exclude = new Set<string>();
  for (const r of revisions) {
    if (r.kind === "single") starts.push(r.oid);
    else {
      starts.push(r.to);
      if (!r.symmetric) for await (const { oid } of ctx.repo.walk([r.from])) exclude.add(oid);
    }
  }
  // --all: every branch, as git starts from every ref.
  if (o.has("--all")) starts.push(ctx.state.head, ...Object.values(ctx.state.refs));
  if (starts.length === 0) starts.push(ctx.state.head);
  const author = o.value("--author");
  const grep = o.value("--grep");
  const authorRe = author !== undefined ? grepRegExp([author], {}) : null;
  const grepRe = grep !== undefined ? grepRegExp([grep], {}) : null;
  let entries: { oid: string; commit: Commit }[] = [];
  for await (const entry of ctx.repo.walk(starts, exclude)) {
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
