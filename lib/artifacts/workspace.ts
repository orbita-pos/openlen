import { ArtifactError, type ArtifactContext } from "./types";
import type { ArtifactStore } from "./store";
import { ARTIFACT_WORKSPACE, parseArtifactPath } from "./paths";
export { ARTIFACT_WORKSPACE, parseArtifactPath } from "./paths";
export function createArtifactWorkspace(store: ArtifactStore, ctx: ArtifactContext) {
  const known = new Map<string, Record<string, string>>();
  async function read(path: string): Promise<string | null> {
    const parsed = parseArtifactPath(path);
    if (!parsed) throw new ArtifactError("invalid_source_path");
    const artifact = await store.getArtifact(ctx, parsed.artifactId);
    const revision = await store.getRevision(ctx, artifact.id, artifact.currentRevision);
    known.set(artifact.id, { ...revision.files });
    return revision.files[parsed.path] ?? null;
  }
  async function write(path: string, content: string, expectedContent: string | null) {
    const parsed = parseArtifactPath(path);
    if (!parsed) throw new ArtifactError("invalid_source_path");
    const artifact = await store.getArtifact(ctx, parsed.artifactId);
    const before = await store.getRevision(ctx, artifact.id, artifact.currentRevision);
    if ((before.files[parsed.path] ?? null) !== expectedContent) throw new ArtifactError("revision_conflict");
    const result = await store.writeArtifactFiles(ctx, artifact.id, artifact.currentRevision, { [parsed.path]: content });
    known.set(artifact.id, { ...result.files });
    return result;
  }
  async function files(): Promise<Record<string, string>> {
    const result: Record<string, string> = Object.create(null);
    for (const id of known.keys()) {
      const artifact = await store.getArtifact(ctx, id);
      const revision = await store.getRevision(ctx, id, artifact.currentRevision);
      for (const [path, content] of Object.entries(revision.files)) result[`${ARTIFACT_WORKSPACE}${id}/${path}`] = content;
    }
    return result;
  }
  async function remove(path: string, expectedContent: string | null) {
    const parsed = parseArtifactPath(path);
    if (!parsed) throw new ArtifactError("invalid_source_path");
    const artifact = await store.getArtifact(ctx, parsed.artifactId);
    const before = await store.getRevision(ctx, artifact.id, artifact.currentRevision);
    if ((before.files[parsed.path] ?? null) !== expectedContent) throw new ArtifactError("revision_conflict");
    const result = await store.writeArtifactFiles(ctx, artifact.id, artifact.currentRevision, {}, { removePaths: [parsed.path] });
    known.set(artifact.id, { ...result.files });
    return result;
  }
  return { read, write, remove, files };
}
export type ArtifactWorkspace = ReturnType<typeof createArtifactWorkspace>;
