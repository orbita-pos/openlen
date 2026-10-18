import { createHash } from "node:crypto";
import type { ArtifactStorage } from "./private-storage";
import type { ArtifactStore } from "./store";
import { ArtifactError, type ArtifactContext, type ArtifactRevision, type ResolvedAsset } from "./types";

/** Only server-authorized, sealed dependency outputs. Never fetch model URLs. */
export async function resolveArtifactAssets(ctx: ArtifactContext, revision: Pick<ArtifactRevision,"dependencies">, store: ArtifactStore, storage: ArtifactStorage): Promise<ResolvedAsset[]> {
  const assets: ResolvedAsset[] = [];
  let total = 0;
  for (const dependency of revision.dependencies) {
    const pinned = await store.getRevision(ctx, dependency.artifactId, dependency.revision);
    if (!pinned.sealedAt || pinned.evidence?.valid !== true || !pinned.outputs.length) throw new ArtifactError("dependency_not_ready");
    for (const [index, output] of pinned.outputs.entries()) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(output.mime)) continue;
      if (output.bytes > 20 * 1024 * 1024 || (total += output.bytes) > 64 * 1024 * 1024) throw new ArtifactError("assets_too_large");
      const bytes = await storage.get(output.key);
      if (bytes.length !== output.bytes || createHash("sha256").update(bytes).digest("hex") !== output.hash) throw new ArtifactError("asset_corrupt");
      assets.push({ id: `${pinned.artifactId}@${pinned.revision}/${index}`, mime: output.mime, bytes });
    }
  }
  return assets;
}
