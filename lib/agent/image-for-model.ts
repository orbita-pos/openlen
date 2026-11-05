/**
 * An image as Len sees it through `Read` (spec local 2026-10-27-len-pdf-skill, §4.7): like Claude Code's
 * Read, encoded as `view_page`'s screenshots are (jpeg, 80), never enlarged.
 *
 * Its size is the one DeepSeek V4.1 — Len's model — keeps (spec local 2026-11-05-ojos-que-ven-el-movimiento,
 * §8.1, revised 05/11): the provider's token grid, solved by DeepSeek's own calculator
 * (`deepseek-image-grid.ts`), as DeepSeek's harness sends images. An image that fits goes as it is; a larger
 * one at the grid's long edge (a square at 1302×1302, 16:9 at 1708×961). With a `region` (Kimi Code's
 * `ReadMediaFile`) the rectangle is cut from the original first, and the grid applies to it.
 */
import type { InlineImage } from "@/lib/ai-gateway";
import { processImage } from "@/lib/images";

import { deepSeekRequestImageDimensions } from "./deepseek-image-grid";
import type { ImageRegion } from "./image-region";

export interface ImageForModel {
  readonly image: InlineImage;
  readonly width: number;
  readonly height: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  /** It was made smaller than the original (or than the region) to fit the model's grid. */
  readonly reduced: boolean;
}

export async function imageForModel(bytes: Uint8Array, opts: { readonly region?: ImageRegion } = {}): Promise<ImageForModel> {
  const input = Buffer.from(bytes);
  const crop = opts.region ? { crop: { ...opts.region } } : {};
  // What will be shown — the region or the whole image — sized first: a tiny pass that also checks the region.
  const probe = await processImage({ input, variants: [{ width: 16, format: "jpeg", quality: 50 }], withoutEnlargement: true, ...crop });
  const shown = opts.region ? { width: opts.region.width, height: opts.region.height } : { width: probe.sourceWidth, height: probe.sourceHeight };
  const target = deepSeekRequestImageDimensions(shown.width, shown.height);
  const { variants } = await processImage({
    input,
    variants: [{ width: target.width, maxHeight: target.height, format: "jpeg", quality: 80 }],
    withoutEnlargement: true,
    ...crop,
  });
  const v = variants[0]!;
  return {
    image: { mimeType: "image/jpeg", dataBase64: v.bytes.toString("base64") },
    width: v.width,
    height: v.height,
    originalWidth: probe.sourceWidth,
    originalHeight: probe.sourceHeight,
    reduced: v.width < shown.width || v.height < shown.height,
  };
}
