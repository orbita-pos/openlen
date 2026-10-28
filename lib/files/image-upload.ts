// The image modal's optimization (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, Jesús's decision 4): what
// /api/projects/[id]/assets always did —2000 px on the long side, WebP 85, oriented—, now for a file that lands in
// the folder as itself (`img/<name>.webp`). SVG (vector) and GIF (animation) are left as they are, and so is
// anything the pipeline can't read: the page still works, just heavier.

import "server-only";

const OPTIMIZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function optimizeImageForWeb(
  bytes: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; ext: "webp"; width: number; height: number } | null> {
  if (!OPTIMIZABLE.has(mime.toLowerCase())) return null;
  try {
    const { legacyWebp2000Variant, processImage } = await import("@/lib/images");
    const { variants } = await processImage({ input: Buffer.from(bytes), variants: [legacyWebp2000Variant()], autoOrient: true, withoutEnlargement: true });
    const v = variants[0];
    if (!v) return null;
    return { bytes: new Uint8Array(v.bytes), ext: "webp", width: v.width, height: v.height };
  } catch {
    return null;
  }
}
