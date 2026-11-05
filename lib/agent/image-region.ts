/**
 * Kimi Code's `ReadMediaFile` region, for Len's `Read` (spec local
 * 2026-11-05-ojos-que-ven-el-movimiento, §8.1): a rectangle of the original image, checked before
 * anything is read, and the notes that tell the model what was done to the image — the words of
 * Kimi Code's `buildMediaNote`, with OpenLen's sizes. No `full_resolution`: with `imageForModel`'s
 * 1000 px cap it would either do nothing or send whole images that ride every later round.
 */

export interface ImageRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const FIELDS = ["x", "y", "width", "height"] as const;

/** The region the model sent: `undefined` when it sent none. Whole pixels; x and y from 0, width and height from 1. */
export function parseImageRegion(raw: unknown): { ok: true; region: ImageRegion | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, region: undefined };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "region has to be {x, y, width, height}, in pixels of the original image." };
  }
  const o = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const f of FIELDS) {
    const v = o[f];
    const min = f === "x" || f === "y" ? 0 : 1;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min) {
      return { ok: false, error: `region.${f} has to be a whole number of ${min} or more (pixels of the original image).` };
    }
    out[f] = v;
  }
  return { ok: true, region: { x: out.x!, y: out.y!, width: out.width!, height: out.height! } };
}

export const regionOnlyForImages = (path: string) => `region only applies to images; ${path} isn't one.`;

/** What `Read` says after the image line (empty when nothing was done to it). */
export function readImageNote(r: {
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly width: number;
  readonly height: number;
  readonly reduced: boolean;
  readonly region?: ImageRegion;
}): string {
  if (r.region) {
    const { x, y, width, height } = r.region;
    return (
      `Showing region (x=${x}, y=${y}, width=${width}, height=${height}) of the original ${r.originalWidth}×${r.originalHeight} image, ` +
      `${r.reduced ? `downsampled to ${r.width}×${r.height} pixels` : "at native resolution"}. ` +
      `To give coordinates in the original image, add the region offset (x=${x}, y=${y}).`
    );
  }
  if (r.reduced) {
    return (
      `The image was downsampled from ${r.originalWidth}×${r.originalHeight} to ${r.width}×${r.height} pixels to fit; fine detail may be lost. ` +
      "To inspect fine detail, call Read again with region (original-image pixel coordinates) to view a crop."
    );
  }
  return "";
}

/** Kimi Code says it on every media read; here, on images made in the box, where scripts make them. */
export const READ_BACK_NOTE = "If you generate or edit images via commands or scripts, read the result back before continuing.";

export const VIDEO_FILE = /\.(webm|mp4|mov|mkv|avi|m4v)$/i;

/** Kimi Code reads video; this model doesn't. As Kimi's own training does with media, the way is code that
 *  turns it into images: frames of a page in motion, or frames of the video itself through a <video>. */
export const videoReadError = (path: string) =>
  `This model can't read video: ${path}. Look at it as images instead: a page in motion, by taking screenshots at intervals with Playwright (page.clock steps time); a video file, by opening it in a page as a <video>, setting its currentTime and taking a screenshot of each moment. Join several into one image with the verify skill's scripts/contact_sheet.py, then Read it.`;
