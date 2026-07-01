import { coerceSceneSpec, SAMPLE_SPEC } from "../three3d/scene-spec";
import { renderScenePoster } from "../publish/scene-poster";
import { pickModelPresentation } from "./presentation";

// Renders a square beauty shot of a GLB using the real runtime (same pipeline
// as publish posters). sceneSpec: optional per-model presentation overrides
// (background/motion/look/camera) — merged in Task 8; ignored keys are safe
// because everything passes coerceSceneSpec.
export async function renderModelThumb(params: { glb: Buffer; sceneSpec?: unknown }): Promise<Buffer> {
  const overrides = pickModelPresentation(params.sceneSpec);
  const spec = coerceSceneSpec({
    ...SAMPLE_SPEC,
    ...overrides,
    preset: "background",
    background: (overrides.background as string) ?? "gradient",
    look: "soft",
    modelUrl: "data:model/gltf-binary;base64," + params.glb.toString("base64"),
  });
  return renderScenePoster(spec, { width: 512, height: 512 });
}
