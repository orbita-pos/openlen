// What Len's eyes captured, stored like any upload (`uploads/<project>/<kind>-<hash>.<ext>`):
// the design mode's captures, so the next turn attaches the same bytes again, and a step's
// screenshots, so the chat shows what Len saw (like Claude Code, where the image is the
// step's result and the screen draws it). All or nothing: if one fails, none is returned.
import { createHash } from "node:crypto";
import type { InlineImage } from "@/lib/ai-gateway";
import { getStorage } from "@/lib/storage";
import type { StorageAdapter } from "@/lib/storage/types";

export type CaptureKind = "design" | "screenshot";

const EXTENSION: Readonly<Record<string, string>> = { "image/jpeg": "jpg", "image/webp": "webp" };

export async function storeCaptures(
  projectId: string,
  captures: readonly InlineImage[],
  kind: CaptureKind,
  storage: StorageAdapter = getStorage(),
): Promise<string[]> {
  const urls = await Promise.all(
    captures.map(async (c) => {
      const body = Buffer.from(c.dataBase64, "base64");
      const hash = createHash("sha256").update(body).digest("hex").slice(0, 32);
      const ext = EXTENSION[c.mimeType] ?? "png";
      try {
        return (await storage.upload({ key: `uploads/${projectId}/${kind}-${hash}.${ext}`, contentType: c.mimeType, body })).url;
      } catch {
        return null;
      }
    }),
  );
  return urls.every((u): u is string => u !== null) ? urls : [];
}

/** The loop waits for this before it sends the step's card, so a hung upload gives up. */
const STEP_SCREENSHOTS_DEADLINE_MS = 10_000;

/** A step's screenshots, for its card in the chat. Nothing on failure or past the deadline. */
export async function storeStepScreenshots(
  projectId: string,
  images: readonly InlineImage[],
  { storage = getStorage(), timeoutMs = STEP_SCREENSHOTS_DEADLINE_MS }: { storage?: StorageAdapter; timeoutMs?: number } = {},
): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<string[]>((resolve) => {
    timer = setTimeout(() => resolve([]), timeoutMs);
  });
  try {
    return await Promise.race([storeCaptures(projectId, images, "screenshot", storage), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
