// The working tree as git sees it (spec §3): which of the terminal's files are versioned, which
// untracked ones a .gitignore hides, and the status against HEAD and the index.
import ignore, { type Ignore } from "ignore";
import { blobOf, compareNames } from "./objects";
import { toRepoPath } from "./paths";
import type { Index } from "./store";

/** Never seen by git, as if in .git/info/exclude: the terminal's scratch and system folders, the
 *  read-only /.openlen and /node_modules, and ~ (/home/user: the PERSON's memory, not the
 *  project's — as ~/.claude never goes in a repository). */
const EXCLUDED = /^\/(?:tmp|bin|usr|dev|proc|\.openlen|node_modules|home\/user|\.len\/artifacts)(?:\/|$)/;
/** The platform manual (`RUTA_MANUAL` in lib/agent/ficheros/manual.ts). */
const PLATFORM_MANUAL = "/AGENTS.md";

export function isVersionable(absolutePath: string): boolean {
  return !EXCLUDED.test(absolutePath) && absolutePath !== PLATFORM_MANUAL;
}

export interface WorkingTree {
  /** Repository path → content, every versionable file (ignored ones too: a tracked file stays tracked). */
  readonly files: ReadonlyMap<string, string>;
  /** Does a .gitignore hide this path (when untracked)? */
  isIgnored(repoPath: string): boolean;
}

export function workingTree(absoluteFiles: Readonly<Record<string, string>>): WorkingTree {
  const files = new Map<string, string>();
  for (const [p, content] of Object.entries(absoluteFiles)) if (isVersionable(p)) files.set(toRepoPath(p), content);
  const rules: { dir: string; matcher: Ignore }[] = [];
  for (const [p, content] of files) {
    if (p === ".gitignore" || p.endsWith("/.gitignore")) rules.push({ dir: p.slice(0, -".gitignore".length), matcher: ignore().add(content) });
  }
  return {
    files,
    isIgnored: (repoPath) => rules.some(({ dir, matcher }) => repoPath.startsWith(dir) && matcher.ignores(repoPath.slice(dir.length))),
  };
}

export type IndexState = " " | "M" | "A" | "D";
export type WorkState = " " | "M" | "D";

export interface TrackedChange {
  readonly path: string;
  /** Index against HEAD (the X of `git status --short`). */
  readonly staged: IndexState;
  /** Working tree against the index (the Y). */
  readonly unstaged: WorkState;
}

export interface Status {
  readonly tracked: readonly TrackedChange[];
  /** Untracked, not ignored, one entry per file. */
  readonly untracked: readonly string[];
}

export function computeStatus(head: ReadonlyMap<string, string>, index: Index, tree: WorkingTree): Status {
  const tracked: TrackedChange[] = [];
  for (const p of [...new Set([...head.keys(), ...Object.keys(index)])].sort(compareNames)) {
    const h = head.get(p);
    const i = index[p];
    const content = tree.files.get(p);
    const staged: IndexState = h === undefined ? (i === undefined ? " " : "A") : i === undefined ? "D" : h !== i ? "M" : " ";
    const unstaged: WorkState = i === undefined ? " " : content === undefined ? "D" : blobOf(content).oid !== i ? "M" : " ";
    if (staged !== " " || unstaged !== " ") tracked.push({ path: p, staged, unstaged });
  }
  const untracked = [...tree.files.keys()].filter((p) => index[p] === undefined && !tree.isIgnored(p)).sort(compareNames);
  return { tracked, untracked };
}

/** status.showUntrackedFiles=normal: a folder with nothing tracked in it shows once, as "folder/". */
export function collapseUntracked(untracked: readonly string[], index: Index): string[] {
  const trackedDirs = new Set<string>();
  for (const p of Object.keys(index)) {
    const parts = p.split("/");
    for (let k = 1; k < parts.length; k++) trackedDirs.add(parts.slice(0, k).join("/"));
  }
  const out = new Set<string>();
  for (const p of untracked) {
    const parts = p.split("/");
    let shown = p;
    for (let k = 1; k < parts.length; k++) {
      const dir = parts.slice(0, k).join("/");
      if (!trackedDirs.has(dir)) {
        shown = `${dir}/`;
        break;
      }
    }
    out.add(shown);
  }
  return [...out].sort(compareNames);
}
