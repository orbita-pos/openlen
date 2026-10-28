/**
 * FILES DROPPED OR PASTED ON THE CHAT (spec local 2026-10-27-chat-drop-and-images, Part A): each
 * one goes where the `+` would put it — a photo Len sees, a file he reads, or a video he puts on
 * the page — and what the chat doesn't take, or doesn't fit in the message, is named with its
 * reason. Pure: the chat and the start screen use it, and it is tested without React.
 */
import { MAX_PDF_BYTES, MAX_VIDEO_BYTES, kindFromName, videoKindFromMime, videoKindFromName } from "@/lib/projects/chat-files";

export type DropRejectReason = "not_supported" | "too_big" | "limit";

export interface ClassifiedDrop {
  readonly photos: File[];
  /** Documents and videos, in drop order: both count against the message's files. */
  readonly files: File[];
  readonly rejected: { readonly name: string; readonly reason: DropRejectReason }[];
}

/** The photos the chat takes: what `/api/upload` decodes. */
export const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
/** A GIF is uploaded as it is (re-encoding would lose its animation), so `/api/upload`'s cap
 *  applies; any other photo is reduced in the browser first. */
export const MAX_GIF_BYTES = 5 * 1024 * 1024;

export function classifyDroppedFiles(dropped: readonly File[], room: { readonly photos: number; readonly files: number }): ClassifiedDrop {
  const out: ClassifiedDrop = { photos: [], files: [], rejected: [] };
  for (const f of dropped) {
    const reject = (reason: DropRejectReason) => out.rejected.push({ name: f.name, reason });
    if ((PHOTO_MIMES as readonly string[]).includes(f.type)) {
      if (f.type === "image/gif" && f.size > MAX_GIF_BYTES) reject("too_big");
      else if (out.photos.length >= room.photos) reject("limit");
      else out.photos.push(f);
      continue;
    }
    const video = videoKindFromMime(f.type) ?? videoKindFromName(f.name);
    const document = f.type === "application/pdf" || kindFromName(f.name) !== null;
    if (!video && !document) reject("not_supported");
    else if (f.size > (video ? MAX_VIDEO_BYTES : MAX_PDF_BYTES)) reject("too_big");
    else if (out.files.length >= room.files) reject("limit");
    else out.files.push(f);
  }
  return out;
}

/** What a paste attaches. Copying from Excel, Word or a web page puts the text AND a picture of it
 *  on the clipboard: then the text is what was meant, and only real files (not images) attach. A
 *  screenshot or a copied photo, with no text, attaches. */
export function pastedFiles(clipboard: Pick<DataTransfer, "files" | "getData"> | null): { files: File[]; text: string } {
  const files = Array.from(clipboard?.files ?? []);
  const text = clipboard?.getData("text/plain") ?? "";
  return { files: text ? files.filter((f) => !f.type.startsWith("image/")) : files, text };
}
