/**
 * An image made in the box, as Len sees it (spec local 2026-10-27-len-pdf-skill, §4.7): `Read` shows
 * images like Claude Code's Read. Shrunk to the size of a PDF's pages (`pdf-pages.ts`: 1000 px wide,
 * at most 3000 tall) and encoded as `view_page`'s screenshots are (jpeg, 80); never enlarged.
 *
 * With a `region` (Kimi Code's `ReadMediaFile`, spec local 2026-11-05-ojos-que-ven-el-movimiento,
 * §8.1) the rectangle is cut from the original first, then held to the same caps. The original size
 * and whether it shrank go back, for the note `Read` adds.
 */
import type { InlineImage } from "@/lib/ai-gateway";
import { processImage } from "@/lib/images";

import type { ImageRegion } from "./image-region";
import { PDF_PAGE_WIDTH } from "./pdf-pages";

const MAX_IMAGE_HEIGHT = 3000;

export interface ImageForModel {
  readonly image: InlineImage;
  readonly width: number;
  readonly height: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  /** It was made smaller than the original (or than the region) to fit. */
  readonly reduced: boolean;
}

export async function imageForModel(bytes: Uint8Array, opts: { readonly region?: ImageRegion } = {}): Promise<ImageForModel> {
  const { variants, sourceWidth, sourceHeight } = await processImage({
    input: Buffer.from(bytes),
    variants: [{ width: PDF_PAGE_WIDTH, maxHeight: MAX_IMAGE_HEIGHT, format: "jpeg", quality: 80 }],
    withoutEnlargement: true,
    ...(opts.region ? { crop: { ...opts.region } } : {}),
  });
  const v = variants[0]!;
  const asked = opts.region ? { width: opts.region.width, height: opts.region.height } : { width: sourceWidth, height: sourceHeight };
  return {
    image: { mimeType: "image/jpeg", dataBase64: v.bytes.toString("base64") },
    width: v.width,
    height: v.height,
    originalWidth: sourceWidth,
    originalHeight: sourceHeight,
    reduced: v.width < asked.width || v.height < asked.height,
  };
}
