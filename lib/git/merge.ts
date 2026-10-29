// The three-way merge (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8), as git's merge-ort does it: the
// trees path by path, and inside a text file git's xdiff merge — xdl_do_merge at XDL_MERGE_ZEALOUS with the "merge"
// conflict style, which is what ll-merge asks for. Ported from git's xdiff/xmerge.c, LGPL-2.1-or-later (compatible
// with this repository's AGPL-3.0). A binary that both sides changed is never merged: ours stays, and it is a conflict.
import { isBlobPointer } from "@/lib/files/blob-pointer";
import { blobForContent } from "./content";
import { blocks, changedLines, records } from "./diff";
import { compareNames, type GitObject } from "./objects";
import type { ConflictKind } from "./store";

interface Change {
  /** Where it starts in a (i1) and in b (i2), and how many lines it covers on each. */
  readonly i1: number;
  readonly chg1: number;
  readonly i2: number;
  readonly chg2: number;
}

/** xdl_do_diff + xdl_change_compact both ways + xdl_build_script, without the indent heuristic (merges don't use it). */
function script(a: readonly string[], b: readonly string[]): Change[] {
  const ch = changedLines(a, b, { indentHeuristic: false });
  // Too large to diff: one change over everything, so the merge still says what git would — a conflict.
  if (!ch) return a.length === 0 && b.length === 0 ? [] : [{ i1: 0, chg1: a.length, i2: 0, chg2: b.length }];
  return blocks(ch).map((k) => ({ i1: k.i1, chg1: k.n1, i2: k.i2, chg2: k.n2 }));
}

/** xdmerge_t. mode: 0 a conflict, 1 only ours changed, 2 only theirs changed, 4 both made the same change. i1/chg1
 *  are in ours, i2/chg2 in theirs, i0/chg0 in the base. */
interface Hunk {
  mode: number;
  i0: number;
  chg0: number;
  i1: number;
  chg1: number;
  i2: number;
  chg2: number;
}

/** xdl_append_merge: a hunk that touches or overlaps the previous one joins it. */
function append(list: Hunk[], mode: number, i0: number, chg0: number, i1: number, chg1: number, i2: number, chg2: number): void {
  const m = list.at(-1);
  if (m && (i1 <= m.i1 + m.chg1 || i2 <= m.i2 + m.chg2)) {
    if (mode !== m.mode) m.mode = 0;
    m.chg0 = i0 + chg0 - m.i0;
    m.chg1 = i1 + chg1 - m.i1;
    m.chg2 = i2 + chg2 - m.i2;
  } else list.push({ mode, i0, chg0, i1, chg1, i2, chg2 });
}

function sameLines(a: readonly string[], i: number, b: readonly string[], j: number, n: number): boolean {
  for (let k = 0; k < n; k++) if (a[i + k] !== b[j + k]) return false;
  return true;
}

/** xdl_recs_copy: `count` lines from `start`; with `addNl`, a last line without its newline gets one. */
function copy(lines: readonly string[], start: number, count: number, addNl: boolean): string {
  if (count <= 0) return "";
  const out = lines.slice(start, start + count).join("");
  return addNl && !out.endsWith("\n") ? `${out}\n` : out;
}

/**
 * Git's merge of one text file: the result, with `<<<<<<< HEAD` / `=======` / `>>>>>>> <theirs>` around each conflict,
 * and how many conflicts it has. Byte for byte what git writes for a file without CRLF.
 */
export function mergeText(baseText: string, oursText: string, theirsText: string, names: { readonly ours: string; readonly theirs: string }): { text: string; conflicts: number } {
  const base = records(baseText);
  const ours = records(oursText);
  const theirs = records(theirsText);
  const s1 = script(base, ours);
  const s2 = script(base, theirs);
  if (s1.length === 0) return { text: theirsText, conflicts: 0 };
  if (s2.length === 0) return { text: oursText, conflicts: 0 };

  const c: Hunk[] = [];
  let a = 0;
  let b = 0;
  while (a < s1.length && b < s2.length) {
    const x1 = s1[a]!;
    const x2 = s2[b]!;
    if (x1.i1 + x1.chg1 < x2.i1) {
      append(c, 1, x1.i1, x1.chg1, x1.i2, x1.chg2, x2.i2 - x2.i1 + x1.i1, x1.chg1);
      a++;
      continue;
    }
    if (x2.i1 + x2.chg1 < x1.i1) {
      append(c, 2, x2.i1, x2.chg1, x1.i2 - x1.i1 + x2.i1, x2.chg1, x2.i2, x2.chg2);
      b++;
      continue;
    }
    if (x1.i1 !== x2.i1 || x1.chg1 !== x2.chg1 || x1.chg2 !== x2.chg2 || !sameLines(ours, x1.i2, theirs, x2.i2, x1.chg2)) {
      const off = x1.i1 - x2.i1;
      const ffo = off + x1.chg1 - x2.chg1;
      let i0 = x1.i1;
      let i1 = x1.i2;
      let i2 = x2.i2;
      if (off > 0) {
        i0 -= off;
        i1 -= off;
      } else i2 += off;
      let chg0 = x1.i1 + x1.chg1 - i0;
      let chg1 = x1.i2 + x1.chg2 - i1;
      let chg2 = x2.i2 + x2.chg2 - i2;
      if (ffo < 0) {
        chg0 -= ffo;
        chg1 -= ffo;
      } else chg2 += ffo;
      append(c, 0, i0, chg0, i1, chg1, i2, chg2);
    }
    const e1 = x1.i1 + x1.chg1;
    const e2 = x2.i1 + x2.chg1;
    if (e1 >= e2) b++;
    if (e2 >= e1) a++;
  }
  for (; a < s1.length; a++) {
    const x1 = s1[a]!;
    append(c, 1, x1.i1, x1.chg1, x1.i2, x1.chg2, x1.i1 + theirs.length - base.length, x1.chg1);
  }
  for (; b < s2.length; b++) {
    const x2 = s2[b]!;
    append(c, 2, x2.i1, x2.chg1, x2.i1 + ours.length - base.length, x2.chg1, x2.i2, x2.chg2);
  }

  // xdl_refine_conflicts: inside each conflict, only what the two sides really disagree on stays a conflict.
  for (let k = 0; k < c.length; k++) {
    const m = c[k]!;
    if (m.mode !== 0 || m.chg1 === 0 || m.chg2 === 0) continue;
    const x = script(ours.slice(m.i1, m.i1 + m.chg1), theirs.slice(m.i2, m.i2 + m.chg2));
    if (x.length === 0) {
      m.mode = 4;
      continue;
    }
    const pieces = x.map((s) => ({ mode: 0, i0: m.i0, chg0: m.chg0, i1: s.i1 + m.i1, chg1: s.chg1, i2: s.i2 + m.i2, chg2: s.chg2 }));
    c.splice(k, 1, ...pieces);
    k += pieces.length - 1;
  }
  // xdl_simplify_non_conflicts: two conflicts three lines apart or closer are one.
  for (let k = 0; k + 1 < c.length; ) {
    const m = c[k]!;
    const next = c[k + 1]!;
    if (m.mode !== 0 || next.mode !== 0 || next.i1 - (m.i1 + m.chg1) > 3) {
      k++;
      continue;
    }
    m.chg1 = next.i1 + next.chg1 - m.i1;
    m.chg2 = next.i2 + next.chg2 - m.i2;
    c.splice(k + 1, 1);
  }

  // xdl_fill_merge_buffer, "merge" style.
  let text = "";
  let i = 0;
  let conflicts = 0;
  for (const m of c) {
    if (m.mode === 0) {
      text += copy(ours, i, m.i1 - i, false);
      text += `<<<<<<< ${names.ours}\n`;
      text += copy(ours, m.i1, m.chg1, true);
      text += "=======\n";
      text += copy(theirs, m.i2, m.chg2, true);
      text += `>>>>>>> ${names.theirs}\n`;
      conflicts++;
    } else if (m.mode & 3) {
      text += copy(ours, i, m.i1 - i, false);
      if (m.mode & 1) text += copy(ours, m.i1, m.chg1, (m.mode & 2) !== 0);
      if (m.mode & 2) text += copy(theirs, m.i2, m.chg2, false);
    } else continue;
    i = m.i1 + m.chg1;
  }
  text += copy(ours, i, ours.length - i, false);
  return { text, conflicts };
}

export interface TreeMerge {
  /** The index after the merge: clean paths at their merged blob, an unmerged one at the version left in the tree. */
  readonly index: Record<string, string>;
  /** Blobs the merge made (texts merged without a conflict). */
  readonly blobs: GitObject[];
  /** What the working tree gets where it changes from ours: the content, or null to delete. */
  readonly write: ReadonlyMap<string, string | null>;
  readonly conflicts: Readonly<Record<string, ConflictKind>>;
  /** What merge-ort prints, path by path: Auto-merging, CONFLICT, the binary warning. */
  readonly messages: string;
}

/** merge-ort over three trees (path → blob oid), with `text` reading a blob. `theirsName` is what the markers and the
 *  messages call the other side (the branch as typed). */
export async function mergeTrees(
  base: ReadonlyMap<string, string>,
  ours: ReadonlyMap<string, string>,
  theirs: ReadonlyMap<string, string>,
  text: (oid: string) => Promise<string>,
  theirsName: string,
): Promise<TreeMerge> {
  const index: Record<string, string> = {};
  const blobs: GitObject[] = [];
  const write = new Map<string, string | null>();
  const conflicts: Record<string, ConflictKind> = {};
  let messages = "";
  for (const p of [...new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])].sort(compareNames)) {
    const b = base.get(p);
    const o = ours.get(p);
    const t = theirs.get(p);
    if (o === t || b === t) {
      if (o !== undefined) index[p] = o;
      continue;
    }
    if (b === o) {
      if (t !== undefined) index[p] = t;
      write.set(p, t === undefined ? null : await text(t));
      continue;
    }
    if (o !== undefined && t !== undefined) {
      const [bText, oText, tText] = [b === undefined ? "" : await text(b), await text(o), await text(t)];
      const kind: ConflictKind = b === undefined ? "AA" : "UU";
      const conflict = `CONFLICT (${b === undefined ? "add/add" : "content"}): Merge conflict in ${p}\n`;
      if (isBlobPointer(oText) || isBlobPointer(tText) || isBlobPointer(bText)) {
        messages += `warning: Cannot merge binary files: ${p} (HEAD vs. ${theirsName})\nAuto-merging ${p}\n${conflict}`;
        index[p] = o;
        conflicts[p] = kind;
        continue;
      }
      messages += `Auto-merging ${p}\n`;
      const merged = mergeText(bText, oText, tText, { ours: "HEAD", theirs: theirsName });
      if (merged.conflicts > 0) {
        messages += conflict;
        index[p] = o;
        conflicts[p] = kind;
      } else {
        const blob = blobForContent(merged.text);
        blobs.push(blob);
        index[p] = blob.oid;
      }
      if (merged.text !== oText) write.set(p, merged.text);
      continue;
    }
    // One side deleted what the other changed: the changed version stays in the tree, unmerged.
    if (o !== undefined) {
      messages += `CONFLICT (modify/delete): ${p} deleted in ${theirsName} and modified in HEAD.  Version HEAD of ${p} left in tree.\n`;
      index[p] = o;
      conflicts[p] = "UD";
    } else {
      messages += `CONFLICT (modify/delete): ${p} deleted in HEAD and modified in ${theirsName}.  Version ${theirsName} of ${p} left in tree.\n`;
      index[p] = t!;
      conflicts[p] = "DU";
      write.set(p, await text(t!));
    }
  }
  return { index, blobs, write, conflicts, messages };
}
