/**
 * An image made in the box, as Len sees it (spec local 2026-10-27-len-pdf-skill, §4.7): `Read` shows
 * images like Claude Code's Read. Shrunk to the size of a PDF's pages (`pdf-pages.ts`: 1000 px wide,
 * at most 3000 tall) and encoded as `view_page`'s screenshots are (jpeg, 80); never enlarged.
 */
import type { InlineImage } from "@/lib/ai-gateway";
import { processImage } from "@/lib/images";

import { PDF_PAGE_WIDTH } from "./pdf-pages";

const MAX_IMAGE_HEIGHT = 3000;

export async function imageForModel(bytes: Uint8Array): Promise<{ image: InlineImage; width: number; height: number }> {
  const { variants } = await processImage({
    input: Buffer.from(bytes),
    variants: [{ width: PDF_PAGE_WIDTH, maxHeight: MAX_IMAGE_HEIGHT, format: "jpeg", quality: 80 }],
    withoutEnlargement: true,
  });
  const v = variants[0]!;
  return { image: { mimeType: "image/jpeg", dataBase64: v.bytes.toString("base64") }, width: v.width, height: v.height };
}
