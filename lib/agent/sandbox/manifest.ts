// A manifest is a path → content hash (sha256, hex) of the project's files: what the box and the
// saved copy compare to know what to move (spec local 2026-10-21-real-terminal-e2b, §5). Changes
// come out in path order, like the terminal's own (`cambiosDeLaTerminal`): two equal runs save in
// the same order.

export type Manifest = Readonly<Record<string, string>>;

export interface ManifestChange {
  readonly path: string;
  readonly kind: "added" | "modified" | "deleted";
}

export function diffManifests(base: Manifest, next: Manifest): ManifestChange[] {
  const changes: ManifestChange[] = [];
  for (const path of new Set([...Object.keys(base), ...Object.keys(next)])) {
    const before = base[path];
    const after = next[path];
    if (before === after) continue;
    changes.push({ path, kind: before === undefined ? "added" : after === undefined ? "deleted" : "modified" });
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
