// The sides a diff compares (a commit's tree, the index, the working tree) and how a list of
// changed files is printed, the same for diff, log, show and commit.
import { sizeOf } from "@/lib/files/blob-pointer";
import { oidOfContent } from "./content";
import type { CommandContext } from "./command";
import { fileDiff, formatStat, summaryLine, type DiffSide } from "./diff";
import { compareNames } from "./objects";
import type { Options } from "./options";
import { matchesPathspec, quotePath } from "./paths";

export interface Source {
  /** Repository path → blob oid. */
  readonly files: ReadonlyMap<string, string>;
  text(path: string, oid: string): Promise<string>;
}

export async function commitSource(ctx: CommandContext, commitOid: string | null): Promise<Source> {
  const files = commitOid ? await ctx.repo.filesOfCommit(commitOid) : new Map<string, string>();
  return { files, text: (_p, oid) => ctx.repo.text(oid) };
}

export function indexSource(ctx: CommandContext): Source {
  return { files: new Map(Object.entries(ctx.state.index)), text: (_p, oid) => ctx.repo.text(oid) };
}

/** The working tree, for the paths git compares there (the tracked ones). */
export function workSource(ctx: CommandContext, paths: Iterable<string>): Source {
  const files = new Map<string, string>();
  for (const p of paths) {
    const content = ctx.tree.files.get(p);
    if (content !== undefined) files.set(p, oidOfContent(content));
  }
  return { files, text: async (p) => ctx.tree.files.get(p) ?? "" };
}

export interface ChangedFile {
  readonly path: string;
  readonly from: DiffSide;
  readonly to: DiffSide;
}

export async function changedFiles(from: Source, to: Source, specs: readonly string[] = []): Promise<ChangedFile[]> {
  const paths = [...new Set([...from.files.keys(), ...to.files.keys()])]
    .filter((p) => specs.length === 0 || specs.some((s) => matchesPathspec(s, p)))
    .sort(compareNames);
  const out: ChangedFile[] = [];
  for (const p of paths) {
    const a = from.files.get(p) ?? null;
    const b = to.files.get(p) ?? null;
    if (a === b) continue;
    out.push({
      path: p,
      from: { path: p, oid: a, text: a === null ? null : await from.text(p, a) },
      to: { path: p, oid: b, text: b === null ? null : await to.text(p, b) },
    });
  }
  return out;
}

export interface DiffOutput {
  readonly patch: boolean;
  readonly stat: boolean;
  readonly numstat: boolean;
  readonly shortstat: boolean;
  readonly nameOnly: boolean;
  readonly nameStatus: boolean;
  readonly context: number;
}

export const DIFF_FLAGS = ["--stat", "--numstat", "--shortstat", "--name-only", "--name-status", "-p", "-u", "--patch", "--no-patch", "--no-color", "--no-ext-diff", "--no-renames"];
export const DIFF_VALUES = ["-U", "--unified", "--color"];

export function diffOutputOf(o: Options, patchByDefault: boolean): DiffOutput {
  const stat = o.has("--stat");
  const numstat = o.has("--numstat");
  const shortstat = o.has("--shortstat");
  const nameOnly = o.has("--name-only");
  const nameStatus = o.has("--name-status");
  const explicitPatch = o.has("-p") || o.has("-u") || o.has("--patch");
  const otherOutput = stat || numstat || shortstat || nameOnly || nameStatus;
  const patch = !o.has("--no-patch") && (explicitPatch || (patchByDefault && !otherOutput));
  return { patch, stat, numstat, shortstat, nameOnly, nameStatus, context: Number(o.value("-U") ?? o.value("--unified") ?? 3) };
}

export function renderChanges(files: readonly ChangedFile[], o: DiffOutput): string {
  if (o.nameOnly) return files.map((f) => `${quotePath(f.path)}\n`).join("");
  if (o.nameStatus) return files.map((f) => `${f.from.oid === null ? "A" : f.to.oid === null ? "D" : "M"}\t${quotePath(f.path)}\n`).join("");
  const diffs = files.map((f) => ({ f, d: fileDiff(f.from, f.to, o.context) }));
  const size = (text: string | null) => (text === null ? 0 : sizeOf(text));
  const entries = diffs.map(({ f, d }) => ({
    path: f.path,
    added: d.added,
    deleted: d.deleted,
    ...(d.binary ? { binary: { from: size(f.from.text), to: size(f.to.text) } } : {}),
  }));
  let out = "";
  if (o.numstat) out += entries.map((e) => (e.binary ? `-\t-\t${quotePath(e.path)}\n` : `${e.added}\t${e.deleted}\t${quotePath(e.path)}\n`)).join("");
  if (o.stat) out += formatStat(entries);
  else if (o.shortstat && entries.length > 0) out += `${summaryLine(entries)}\n`;
  if (o.patch && diffs.length > 0) out += `${out ? "\n" : ""}${diffs.map(({ d }) => d.text).join("")}`;
  return out;
}
