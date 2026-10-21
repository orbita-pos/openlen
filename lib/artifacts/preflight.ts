import { ArtifactError, type Artifact, type ArtifactContext, type ArtifactRevision, type ResolvedAsset, type SealedArtifactInput } from "./types";
import type { ArtifactStore } from "./store";
import { withReferencedDependencies } from "./references";
import { datasetsFromRevision } from "./data";

/**
 * A piece checked before it is queued, as Claude Code runs a tool's validateInput before calling it: everything
 * that does not need the renderer — the manifest, the slide format, compiling and bundling, fonts, a frozen
 * app, datasets — runs now, in the tool call, and a problem comes back at once with what to change. Only what
 * needs Chromium, LibreOffice or ffmpeg is left to the job.
 *
 * Saved images and voices it depends on are named, not read: their bytes are placeholders here (the job reads
 * the real ones). A dependency still rendering is not an error — the job waits for it.
 */
export async function preflightArtifact(ctx: ArtifactContext, store: ArtifactStore, artifact: Artifact, revision: ArtifactRevision): Promise<void> {
  const dependencies = withReferencedDependencies(revision.dependencies, revision.files);
  const assets: ResolvedAsset[] = [];
  for (const dependency of dependencies) {
    let pinned: ArtifactRevision;
    try { pinned = await store.getRevision(ctx, dependency.artifactId, dependency.revision); }
    catch { throw new ArtifactError("invalid_dependency", `the sources name ${dependency.artifactId}@${dependency.revision}, which is not a saved piece here; check the id with list_artifacts`); }
    pinned.outputs.forEach((output, index) => assets.push({ id: `${pinned.artifactId}@${pinned.revision}/${index}`, mime: output.mime, bytes: new Uint8Array([0]) }));
  }
  const input = { artifact, revision: { ...revision, dependencies }, assets, datasets: datasetsFromRevision(revision) } as SealedArtifactInput;
  switch (artifact.kind) {
    case "slides": {
      const { isSlideDeckV3, parseSlideDeckV3, compileSlideDeck } = await import("./adapters/slides/deck");
      if (isSlideDeckV3(input)) compileSlideDeck(parseSlideDeckV3(input), input);
      else (await import("./adapters/slides/manifest")).parseSlideDeck(input);
      break;
    }
    case "dashboard": await (await import("./adapters/dashboard/compile")).buildDashboard(input); break;
    case "motion": {
      // As the job: the app's screens first (which also checks the frozen copy), then the composition that shows
      // them — each capture is a picture the render makes, named asset:capture:<id>.
      const captures = await (await import("./adapters/motion/captures")).buildProjectCaptures(input);
      const withCaptures = { ...input, assets: [...input.assets, ...captures.map((c) => ({ id: `capture:${c.id}`, mime: "image/png", bytes: new Uint8Array([0]) }))] } as SealedArtifactInput;
      await (await import("./adapters/motion/runtime")).buildMotion(withCaptures, { checkOnly: true });
      break;
    }
    case "audio": (await import("./adapters/audio/manifest")).audioManifest(input); break;
    case "image": (await import("./adapters/image/manifest")).imageManifest(input); break;
  }
}
