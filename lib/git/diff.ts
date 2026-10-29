// Git's unified diff, byte for byte: Myers (the `diff` package), then xdiff's slider compaction
// with the indent heuristic, hunks with their context, and the default funcname after "@@".
// The compaction and the hunk emission are ported from git's xdiff/xdiffi.c and xdiff/xemit.c,
// which are LGPL-2.1-or-later (compatible with this repository's AGPL-3.0).
import { isBlobPointer } from "@/lib/files/blob-pointer";
import { diffArrays } from "diff";
import { NULL_OID } from "./objects";
import { quotePath } from "./paths";

/** Above this many edits the diff isn't computed (spec §4: "too large to show"). */
const MAX_EDIT_LENGTH = 20_000;

/** A file as xdiff splits it: each line keeps its "\n"; the last one may lack it. */
export function records(text: string): string[] {
  return text === "" ? [] : text.split(/(?<=\n)/);
}

export interface ChangedLines {
  readonly a: readonly boolean[];
  readonly b: readonly boolean[];
}

/** One side's changed-line flags with xdiff's sentinels: get(-1) and get(nrec) are false. */
class Side {
  readonly nrec: number;
  private readonly rchg: boolean[];
  constructor(readonly recs: readonly string[], changed: readonly boolean[]) {
    this.nrec = recs.length;
    this.rchg = [false, ...changed, false];
  }
  get(i: number): boolean {
    return this.rchg[i + 1]!;
  }
  set(i: number, v: boolean): void {
    this.rchg[i + 1] = v;
  }
  changed(): boolean[] {
    return this.rchg.slice(1, -1);
  }
}

interface Group {
  start: number;
  end: number;
}

function groupInit(f: Side): Group {
  const g = { start: 0, end: 0 };
  while (f.get(g.end)) g.end++;
  return g;
}
function groupNext(f: Side, g: Group): boolean {
  if (g.end === f.nrec) return false;
  g.start = g.end + 1;
  for (g.end = g.start; f.get(g.end); g.end++);
  return true;
}
function groupPrevious(f: Side, g: Group): boolean {
  if (g.start === 0) return false;
  g.end = g.start - 1;
  for (g.start = g.end; f.get(g.start - 1); g.start--);
  return true;
}
function slideDown(f: Side, g: Group): boolean {
  if (g.end < f.nrec && f.recs[g.start] === f.recs[g.end]) {
    f.set(g.start++, false);
    f.set(g.end++, true);
    while (f.get(g.end)) g.end++;
    return true;
  }
  return false;
}
function slideUp(f: Side, g: Group): boolean {
  if (g.start > 0 && f.recs[g.start - 1] === f.recs[g.end - 1]) {
    f.set(--g.start, true);
    f.set(--g.end, false);
    while (f.get(g.start - 1)) g.start--;
    return true;
  }
  return false;
}

// The indent heuristic's constants, as in xdiffi.c.
const MAX_INDENT = 200;
const MAX_BLANKS = 20;
const START_OF_FILE_PENALTY = 1;
const END_OF_FILE_PENALTY = 21;
const TOTAL_BLANK_WEIGHT = -30;
const POST_BLANK_WEIGHT = 6;
const RELATIVE_INDENT_PENALTY = -4;
const RELATIVE_INDENT_WITH_BLANK_PENALTY = 10;
const RELATIVE_OUTDENT_PENALTY = 24;
const RELATIVE_OUTDENT_WITH_BLANK_PENALTY = 17;
const RELATIVE_DEDENT_PENALTY = 23;
const RELATIVE_DEDENT_WITH_BLANK_PENALTY = 17;
const INDENT_WEIGHT = 60;
const INDENT_HEURISTIC_MAX_SLIDING = 100;

/** Columns of leading whitespace (a tab to the next multiple of 8); -1 for a blank line. */
function getIndent(rec: string): number {
  let ret = 0;
  for (const c of rec) {
    if (!/[ \t\n\r\v\f]/.test(c)) return ret;
    if (c === " ") ret += 1;
    else if (c === "\t") ret += 8 - (ret % 8);
    if (ret >= MAX_INDENT) return MAX_INDENT;
  }
  return -1;
}

interface Split {
  endOfFile: boolean;
  indent: number;
  preBlank: number;
  preIndent: number;
  postBlank: number;
  postIndent: number;
}

function measureSplit(f: Side, split: number): Split {
  const m: Split = { endOfFile: split >= f.nrec, indent: split >= f.nrec ? -1 : getIndent(f.recs[split]!), preBlank: 0, preIndent: -1, postBlank: 0, postIndent: -1 };
  for (let i = split - 1; i >= 0; i--) {
    m.preIndent = getIndent(f.recs[i]!);
    if (m.preIndent !== -1) break;
    m.preBlank += 1;
    if (m.preBlank === MAX_BLANKS) {
      m.preIndent = 0;
      break;
    }
  }
  for (let i = split + 1; i < f.nrec; i++) {
    m.postIndent = getIndent(f.recs[i]!);
    if (m.postIndent !== -1) break;
    m.postBlank += 1;
    if (m.postBlank === MAX_BLANKS) {
      m.postIndent = 0;
      break;
    }
  }
  return m;
}

interface Score {
  effectiveIndent: number;
  penalty: number;
}

function scoreAddSplit(m: Split, s: Score): void {
  if (m.preIndent === -1 && m.preBlank === 0) s.penalty += START_OF_FILE_PENALTY;
  if (m.endOfFile) s.penalty += END_OF_FILE_PENALTY;
  const postBlank = m.indent === -1 ? 1 + m.postBlank : 0;
  const totalBlank = m.preBlank + postBlank;
  s.penalty += TOTAL_BLANK_WEIGHT * totalBlank;
  s.penalty += POST_BLANK_WEIGHT * postBlank;
  const indent = m.indent !== -1 ? m.indent : m.postIndent;
  const anyBlanks = totalBlank !== 0;
  s.effectiveIndent += indent;
  if (indent === -1 || m.preIndent === -1) return;
  if (indent > m.preIndent) s.penalty += anyBlanks ? RELATIVE_INDENT_WITH_BLANK_PENALTY : RELATIVE_INDENT_PENALTY;
  else if (indent === m.preIndent) return;
  else if (m.postIndent !== -1 && m.postIndent > indent) s.penalty += anyBlanks ? RELATIVE_OUTDENT_WITH_BLANK_PENALTY : RELATIVE_OUTDENT_PENALTY;
  else s.penalty += anyBlanks ? RELATIVE_DEDENT_WITH_BLANK_PENALTY : RELATIVE_DEDENT_PENALTY;
}

function scoreCmp(s1: Score, s2: Score): number {
  const cmpIndents = Number(s1.effectiveIndent > s2.effectiveIndent) - Number(s1.effectiveIndent < s2.effectiveIndent);
  return INDENT_WEIGHT * cmpIndents + (s1.penalty - s2.penalty);
}

/** xdl_change_compact: slide each group of changes to where git puts it (the indent heuristic is XDF_INDENT_HEURISTIC:
 *  on for diffs, off for merges). */
function compact(f: Side, o: Side, indentHeuristic: boolean): void {
  const g = groupInit(f);
  const go = groupInit(o);
  for (;;) {
    if (g.end !== g.start) {
      let groupsize: number;
      let earliestEnd: number;
      let endMatchingOther: number;
      do {
        groupsize = g.end - g.start;
        endMatchingOther = -1;
        while (slideUp(f, g)) if (!groupPrevious(o, go)) throw new Error("group sync broken sliding up");
        earliestEnd = g.end;
        if (go.end > go.start) endMatchingOther = g.end;
        for (;;) {
          if (!slideDown(f, g)) break;
          if (!groupNext(o, go)) throw new Error("group sync broken sliding down");
          if (go.end > go.start) endMatchingOther = g.end;
        }
      } while (groupsize !== g.end - g.start);
      if (g.end === earliestEnd) {
        // No shifting was possible.
      } else if (endMatchingOther !== -1) {
        while (go.end === go.start) {
          if (!slideUp(f, g)) throw new Error("match disappeared");
          if (!groupPrevious(o, go)) throw new Error("group sync broken sliding to match");
        }
      } else if (indentHeuristic) {
        let shift = earliestEnd;
        if (g.end - groupsize - 1 > shift) shift = g.end - groupsize - 1;
        if (g.end - INDENT_HEURISTIC_MAX_SLIDING > shift) shift = g.end - INDENT_HEURISTIC_MAX_SLIDING;
        let bestShift = -1;
        let best: Score = { effectiveIndent: 0, penalty: 0 };
        for (; shift <= g.end; shift++) {
          const score: Score = { effectiveIndent: 0, penalty: 0 };
          scoreAddSplit(measureSplit(f, shift), score);
          scoreAddSplit(measureSplit(f, shift - groupsize), score);
          if (bestShift === -1 || scoreCmp(score, best) <= 0) {
            best = score;
            bestShift = shift;
          }
        }
        while (g.end > bestShift) {
          if (!slideUp(f, g)) throw new Error("best shift unreached");
          if (!groupPrevious(o, go)) throw new Error("group sync broken sliding to blank line");
        }
      }
    }
    if (!groupNext(f, g)) break;
    if (!groupNext(o, go)) throw new Error("group sync broken moving to next group");
  }
}

/** Which lines changed on each side, placed where git places them; null if too large to diff. */
export function changedLines(a: readonly string[], b: readonly string[], o: { readonly indentHeuristic?: boolean } = {}): ChangedLines | null {
  const parts = diffArrays([...a], [...b], { maxEditLength: MAX_EDIT_LENGTH });
  if (!parts) return null;
  const ca: boolean[] = [];
  const cb: boolean[] = [];
  for (const part of parts) {
    for (let k = 0; k < part.value.length; k++) {
      if (part.added) cb.push(true);
      else if (part.removed) ca.push(true);
      else {
        ca.push(false);
        cb.push(false);
      }
    }
  }
  const fa = new Side(a, ca);
  const fb = new Side(b, cb);
  const heuristic = o.indentHeuristic ?? true;
  compact(fa, fb, heuristic);
  compact(fb, fa, heuristic);
  return { a: fa.changed(), b: fb.changed() };
}

export interface Block {
  readonly i1: number;
  readonly n1: number;
  readonly i2: number;
  readonly n2: number;
}

/** The changes as xdiff's script: each run of changed lines, at i1 (n1 lines) in a and i2 (n2 lines) in b. */
export function blocks(ch: ChangedLines): Block[] {
  const out: Block[] = [];
  let i = 0;
  let j = 0;
  while (i < ch.a.length || j < ch.b.length) {
    if ((i < ch.a.length && ch.a[i]) || (j < ch.b.length && ch.b[j])) {
      const i0 = i;
      const j0 = j;
      while (i < ch.a.length && ch.a[i]) i++;
      while (j < ch.b.length && ch.b[j]) j++;
      out.push({ i1: i0, n1: i - i0, i2: j0, n2: j - j0 });
    } else {
      i++;
      j++;
    }
  }
  return out;
}

/** Git's default funcname: a line starting with a letter, "_" or "$", cut to 80 bytes, trailing space trimmed. */
function funcName(rec: string): string | null {
  if (!/^[A-Za-z_$]/.test(rec)) return null;
  return Buffer.from(rec).subarray(0, 80).toString("utf8").replace(/\s+$/, "");
}

function lineOut(prefix: string, rec: string): string {
  return rec.endsWith("\n") ? `${prefix}${rec}` : `${prefix}${rec}\n\\ No newline at end of file\n`;
}

function range(start: number, count: number): string {
  return `${count === 0 ? start - 1 : start}${count === 1 ? "" : `,${count}`}`;
}

/** The "@@" hunks of a diff, as xdl_emit_diff writes them. */
export function unifiedHunks(a: readonly string[], b: readonly string[], ch: ChangedLines, context: number): string {
  const bs = blocks(ch);
  let out = "";
  let funcLine = "";
  let funcPrev = -1;
  for (let k = 0; k < bs.length; ) {
    let last = k;
    while (last + 1 < bs.length && bs[last + 1]!.i1 - (bs[last]!.i1 + bs[last]!.n1) <= 2 * context) last++;
    const first = bs[k]!;
    const end = bs[last]!;
    const s1 = Math.max(first.i1 - context, 0);
    const s2 = Math.max(first.i2 - context, 0);
    const lctx = Math.min(context, a.length - (end.i1 + end.n1), b.length - (end.i2 + end.n2));
    const e1 = end.i1 + end.n1 + lctx;
    const e2 = end.i2 + end.n2 + lctx;
    for (let l = s1 - 1; l !== funcPrev && l >= 0; l--) {
      const f = funcName(a[l]!);
      if (f !== null) {
        funcLine = f;
        break;
      }
    }
    funcPrev = s1 - 1;
    out += `@@ -${range(s1 + 1, e1 - s1)} +${range(s2 + 1, e2 - s2)} @@${funcLine ? ` ${funcLine}` : ""}\n`;
    let i = s1;
    for (let m = k; m <= last; m++) {
      const blk = bs[m]!;
      for (; i < blk.i1; i++) out += lineOut(" ", a[i]!);
      for (let x = blk.i1; x < blk.i1 + blk.n1; x++) out += lineOut("-", a[x]!);
      for (let y = blk.i2; y < blk.i2 + blk.n2; y++) out += lineOut("+", b[y]!);
      i = blk.i1 + blk.n1;
    }
    for (; i < e1; i++) out += lineOut(" ", a[i]!);
    k = last + 1;
  }
  return out;
}

export interface DiffSide {
  readonly path: string;
  /** `null`: the file doesn't exist on this side. */
  readonly oid: string | null;
  readonly text: string | null;
}

export const abbrev = (oid: string): string => oid.slice(0, 7);

export function fileDiff(from: DiffSide, to: DiffSide, context = 3): { text: string; added: number; deleted: number; binary: boolean } {
  const pa = `a/${from.path}`;
  const pb = `b/${to.path}`;
  let text = `diff --git ${quotePath(pa)} ${quotePath(pb)}\n`;
  if (from.oid === null) text += "new file mode 100644\n";
  if (to.oid === null) text += "deleted file mode 100644\n";
  text += `index ${abbrev(from.oid ?? NULL_OID)}..${abbrev(to.oid ?? NULL_OID)}${from.oid !== null && to.oid !== null ? " 100644" : ""}\n`;
  const oldText = from.text ?? "";
  const newText = to.text ?? "";
  if (oldText.includes("\0") || newText.includes("\0") || isBlobPointer(oldText) || isBlobPointer(newText)) {
    text += `Binary files ${from.oid === null ? "/dev/null" : quotePath(pa)} and ${to.oid === null ? "/dev/null" : quotePath(pb)} differ\n`;
    return { text, added: 0, deleted: 0, binary: true };
  }
  const a = records(oldText);
  const b = records(newText);
  if (a.length === 0 && b.length === 0) return { text, added: 0, deleted: 0, binary: false };
  const ch = changedLines(a, b);
  if (!ch) return { text: `${text}(diff too large to show; use git show <commit>:${to.path})\n`, added: 0, deleted: 0, binary: false };
  text += `--- ${from.oid === null ? "/dev/null" : quotePath(pa)}\n+++ ${to.oid === null ? "/dev/null" : quotePath(pb)}\n`;
  text += unifiedHunks(a, b, ch, context);
  return { text, added: ch.b.filter(Boolean).length, deleted: ch.a.filter(Boolean).length, binary: false };
}

export interface StatEntry {
  readonly path: string;
  readonly added: number;
  readonly deleted: number;
  /** A binary file: its size before and after, as git prints it (`Bin 19 -> 21 bytes`). */
  readonly binary?: { readonly from: number; readonly to: number };
}

export function summaryLine(entries: readonly StatEntry[]): string {
  const files = entries.length;
  const ins = entries.reduce((n, e) => n + e.added, 0);
  const del = entries.reduce((n, e) => n + e.deleted, 0);
  let s = ` ${files} file${files === 1 ? "" : "s"} changed`;
  if (ins || !del) s += `, ${ins} insertion${ins === 1 ? "" : "s"}(+)`;
  if (del || !ins) s += `, ${del} deletion${del === 1 ? "" : "s"}(-)`;
  return s;
}

/** `--stat`, as git prints it when stdout is not a terminal (80 columns). */
export function formatStat(entries: readonly StatEntry[], width = 80): string {
  if (entries.length === 0) return "";
  const names = entries.map((e) => quotePath(e.path));
  const maxChange = Math.max(...entries.map((e) => e.added + e.deleted));
  // Like git's diffstat: a binary's "Bin" takes the number's column.
  const numberWidth = Math.max(String(maxChange).length, entries.some((e) => e.binary) ? 3 : 0);
  let nameWidth = Math.max(...names.map((n) => n.length));
  let graphWidth = maxChange;
  if (nameWidth + numberWidth + 6 + graphWidth > width) {
    if (graphWidth > Math.floor((width * 3) / 8) - numberWidth - 6) {
      graphWidth = Math.max(Math.floor((width * 3) / 8) - numberWidth - 6, 6);
    }
    if (nameWidth > width - numberWidth - 6 - graphWidth) nameWidth = width - numberWidth - 6 - graphWidth;
    else graphWidth = width - numberWidth - 6 - nameWidth;
  }
  const scale = (n: number) => (n === 0 ? 0 : 1 + Math.floor((n * (graphWidth - 1)) / maxChange));
  let out = "";
  entries.forEach((e, k) => {
    let name = names[k]!;
    if (name.length > nameWidth) {
      let tail = name.slice(name.length - (nameWidth - 3));
      const slash = tail.indexOf("/");
      if (slash >= 0) tail = tail.slice(slash);
      name = `...${tail}`;
    }
    if (e.binary) {
      out += ` ${name.padEnd(nameWidth)} | ${"Bin".padStart(numberWidth)} ${e.binary.from} -> ${e.binary.to} bytes\n`;
      return;
    }
    const total = e.added + e.deleted;
    const add = graphWidth < maxChange ? scale(e.added) : e.added;
    const del = graphWidth < maxChange ? scale(e.deleted) : e.deleted;
    out += ` ${name.padEnd(nameWidth)} | ${String(total).padStart(numberWidth)}${total ? " " : ""}${"+".repeat(add)}${"-".repeat(del)}\n`;
  });
  return `${out}${summaryLine(entries)}\n`;
}
