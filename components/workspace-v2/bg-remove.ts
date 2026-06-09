// Client-side background removal.
//
// Runs entirely in the browser via @huggingface/transformers (Apache-2.0)
// on the Apache-2.0 `onnx-community/ormbg-ONNX` model — WebGPU when the
// device has it, single-threaded WASM otherwise (no COOP/COEP headers, so
// nothing breaks Unsplash/R2 images or the preview iframe). Zero server
// compute, zero per-call cost — fits the single CX22 / no-GPU / no-queue box.
//
// Output is a transparent PNG File that drops straight into the SAME upload
// path as everything else (POST /api/projects/[id]/assets); the Rust image
// pipeline re-encodes to WebP while preserving the alpha channel.
//
// The transformers.js import is dynamic so its (large) bundle + the ~40MB
// model only load when the user actually clicks "Remove background".

// Single source of truth for the model. Apache-2.0, adversarially license-
// verified as commercial-safe. Swap to onnx-community/BiRefNet_lite-ONNX (MIT)
// for stronger general-object cutouts at a heavier first-load.
const BG_MODEL = "onnx-community/ormbg-ONNX";

type Segmenter = (input: string) => Promise<unknown>;

let pipelinePromise: Promise<Segmenter> | null = null;

async function getPipeline(): Promise<Segmenter> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    // Loose typing: the library's task-name unions shift across versions and
    // we don't want tsc coupled to them.
    const tf = (await import("@huggingface/transformers")) as {
      pipeline: (task: string, model: string, opts: unknown) => Promise<Segmenter>;
    };
    // navigator.gpu isn't in the default DOM lib (WebGPU types), so probe it
    // through a narrow local cast rather than pulling in @webgpu/types.
    const nav = navigator as unknown as {
      gpu?: { requestAdapter?: () => Promise<unknown> };
    };
    const hasWebGPU =
      typeof navigator !== "undefined" &&
      !!nav.gpu?.requestAdapter &&
      !!(await nav.gpu.requestAdapter().catch(() => null));
    return tf.pipeline("background-removal", BG_MODEL, {
      device: hasWebGPU ? "webgpu" : "wasm",
      dtype: hasWebGPU ? "fp32" : "q8",
    });
  })().catch((err) => {
    // Reset so a transient failure (e.g. offline first-load) can be retried.
    pipelinePromise = null;
    throw err;
  });
  return pipelinePromise;
}

async function toPngBlob(canvas: {
  toBlob?: (cb: (b: Blob | null) => void, type: string) => void;
  convertToBlob?: (opts: { type: string }) => Promise<Blob>;
}): Promise<Blob> {
  if (typeof canvas.toBlob === "function") {
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob!(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/png",
      ),
    );
  }
  if (typeof canvas.convertToBlob === "function") {
    return await canvas.convertToBlob({ type: "image/png" });
  }
  throw new Error("canvas has no blob export");
}

/** Cut the background out of `file`, returning a transparent PNG File.
 *  Heavy on first call (downloads the library + model, then cached). */
export async function removeBackground(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const segmenter = await getPipeline();
    const output = await segmenter(url);
    // `background-removal` returns an array of RawImage; [0] is RGBA with the
    // background already cut into the alpha channel.
    const raw = (Array.isArray(output) ? output[0] : output) as {
      toCanvas?: () => Parameters<typeof toPngBlob>[0];
    };
    if (!raw?.toCanvas) throw new Error("unexpected model output");
    const blob = await toPngBlob(raw.toCanvas());
    const base = file.name.replace(/\.[^./\\]+$/, "") || "image";
    return new File([blob], `${base}-nobg.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
