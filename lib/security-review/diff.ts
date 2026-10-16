// lib/security-review/diff.ts — what changed since the published version, as the
// diff a pull request shows (lib/git/diff.ts writes it the way git does). The
// published version is the base: everything serious in it was fixed or accepted
// before it could be published, so the next review looks at what is new, as
// Claude Code's /security-review looks at a branch against its base.

import { createHash } from "node:crypto";

import { fileDiff } from "@/lib/git/diff";

/** Past this, the diff is left out of the prompt and only the files are listed to read (as Claude Code does). */
export const MAX_DIFF_CHARS = 60_000;

const oid = (text: string): string => createHash("sha1").update(text).digest("hex");

export function changesSince(
  base: Readonly<Record<string, string>>,
  now: Readonly<Record<string, string>>,
  maxChars: number = MAX_DIFF_CHARS,
): { readonly changed: string[]; readonly diff: string | null } {
  const changed = [...new Set([...Object.keys(base), ...Object.keys(now)])].filter((p) => base[p] !== now[p]).sort();
  let diff = "";
  for (const path of changed) {
    const before = base[path];
    const after = now[path];
    const rel = path.replace(/^\//, "");
    diff += fileDiff(
      { path: rel, oid: before === undefined ? null : oid(before), text: before ?? null },
      { path: rel, oid: after === undefined ? null : oid(after), text: after ?? null },
    ).text;
    if (diff.length > maxChars) return { changed, diff: null };
  }
  return { changed, diff };
}
