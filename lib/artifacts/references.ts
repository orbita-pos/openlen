import { ArtifactError, type ArtifactDependency } from "./types";

/** A saved output, as sources name it: `asset:<artifactId>@<revision>/<output>` or, in an audio track, the bare id. */
const OUTPUT_ID = /(?<![0-9a-f-])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@([1-9]\d*)\/\d+/g;

/**
 * The dependencies a revision has: the declared ones plus every saved output its files name. Naming an output is
 * enough — as writing an uploaded blob's url is in Claude — so a correction can add an image or a voice to a piece
 * created without it. Two revisions of one piece cannot both be in a revision; the error says which.
 */
export function withReferencedDependencies(declared: readonly ArtifactDependency[], files: Readonly<Record<string, string>>): ArtifactDependency[] {
  const revisions = new Map<string, Set<number>>();
  const add = (artifactId: string, revision: number) => { if (!revisions.has(artifactId)) revisions.set(artifactId, new Set()); revisions.get(artifactId)!.add(revision); };
  for (const dependency of declared) add(dependency.artifactId, dependency.revision);
  for (const text of Object.values(files)) for (const match of text.matchAll(OUTPUT_ID)) add(match[1]!, Number(match[2]));
  const dependencies: ArtifactDependency[] = [];
  for (const [artifactId, set] of revisions) {
    const [revision, ...others] = [...set].sort((a, b) => a - b);
    if (others.length) throw new ArtifactError("invalid_dependency", `${artifactId}@${revision} and @${others.join(", @")} are two revisions of one piece; name only one`);
    dependencies.push({ artifactId, revision: revision! });
  }
  return dependencies;
}
