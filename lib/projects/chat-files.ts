/**
 * FILES ATTACHED TO A CHAT MESSAGE (26/10): a PDF, which Len reads with `Read`
 * when he decides, as in Claude Code — its path goes in the message, nothing
 * of it is read ahead of him. The column `projectChatMessages.attachedFiles`
 * keeps them per turn.
 *
 * Pure, like `chat-photos.ts`: the route, the transcript and the client use it.
 */

export const ATTACHMENTS_DIR = "/.openlen/attachments";

/** Claude Code's numbers: a PDF over 10 pages is read by range, 20 at most. */
export const PDF_PAGES_WITHOUT_RANGE = 10;
export const MAX_PDF_PAGES_PER_READ = 20;
/** The largest PDF the chat takes. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** Files per message, as many as photos. */
export const MAX_FILES_PER_MESSAGE = 4;
/** The largest office file or CSV the chat takes, as a PDF (spec local 2026-10-26-len-skills). */
export const MAX_OFFICE_BYTES = MAX_PDF_BYTES;

/** What a file attached to a message can be: a PDF, which Read draws as images, and, for the office
 *  skills (spec local 2026-10-26-len-skills, §4.8), DeepSeek's office formats and a CSV. */
export const ATTACHMENT_KINDS = {
  pdf: { mime: "application/pdf" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  xlsm: { mime: "application/vnd.ms-excel.sheet.macroEnabled.12" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  csv: { mime: "text/csv" },
} as const;
export type AttachedKind = keyof typeof ATTACHMENT_KINDS;

/** A video attached to a message (spec local 2026-10-27-chat-drop-and-images, Part A): Len can't
 *  watch it, so it travels by URL for him to put on the page, never to `Read` or the box. */
export const VIDEO_KINDS = {
  mp4: { mime: "video/mp4" },
  webm: { mime: "video/webm" },
  mov: { mime: "video/quicktime" },
} as const;
export type VideoKind = keyof typeof VIDEO_KINDS;
/** The largest video the chat takes: `/api/upload`'s cap. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** A file attached to a message, as the chat row keeps it. */
export interface AttachedFile {
  readonly url: string;
  readonly name: string;
  readonly size: number;
  /** Absent in the rows from before office files: those are PDFs. */
  readonly kind?: AttachedKind | VideoKind;
}

/** The kind of a file by its name's extension, or null if the chat doesn't take it. */
export function kindFromName(name: string): AttachedKind | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  return Object.hasOwn(ATTACHMENT_KINDS, ext) ? (ext as AttachedKind) : null;
}

export function kindOf(file: Pick<AttachedFile, "kind">): AttachedKind | VideoKind {
  return file.kind ?? "pdf";
}

/** The video kind of a file by its name's extension, or null. */
export function videoKindFromName(name: string): VideoKind | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  return Object.hasOwn(VIDEO_KINDS, ext) ? (ext as VideoKind) : null;
}

/** The video kind of a MIME type, or null. */
export function videoKindFromMime(mime: string): VideoKind | null {
  return (Object.keys(VIDEO_KINDS) as VideoKind[]).find((k) => VIDEO_KINDS[k].mime === mime) ?? null;
}

export function isVideoFile(file: Pick<AttachedFile, "kind">): boolean {
  return Object.hasOwn(VIDEO_KINDS, file.kind ?? "");
}

/** What the header says: a PDF starts with `%PDF-`, an office file is a ZIP, a CSV is UTF-8 text
 *  without NUL bytes. */
export function bytesLookLike(kind: AttachedKind, bytes: Uint8Array): boolean {
  const head = (n: number) => Array.from(bytes.subarray(0, n));
  if (kind === "pdf") return String.fromCharCode(...head(5)) === "%PDF-";
  if (kind === "csv") {
    try {
      return !new TextDecoder("utf-8", { fatal: true }).decode(bytes).includes("\0");
    } catch {
      return false;
    }
  }
  return head(4).join(",") === "80,75,3,4";
}

/** Where Len reads it: `/.openlen/attachments/<upload id>/<name>`. The upload
 *  id keeps two files with the same name apart. */
export function attachmentPath(file: Pick<AttachedFile, "url" | "name" | "kind">): string {
  const id = (file.url.split(/[?#]/)[0]!.split("/").pop() ?? "").replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "") || "file";
  const base = file.name.replace(/[^\p{L}\p{N}._ -]/gu, "-").replace(/\s+/g, "-").replace(/^[.-]+/, "").slice(0, 80) || "document";
  const ext = kindOf(file);
  return `${ATTACHMENTS_DIR}/${id}/${new RegExp(`\\.${ext}$`, "i").test(base) ? base : `${base}.${ext}`}`;
}

/** Sizes as Claude Code writes them: «812 bytes», «256KB», «1.5MB». */
function size(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes} bytes`;
  if (kb < 1024) return `${kb.toFixed(1).replace(/\.0$/, "")}KB`;
  return `${(kb / 1024).toFixed(1).replace(/\.0$/, "")}MB`;
}

/** The note that goes with the file in the user's message. */
export function attachmentNote(file: AttachedFile): string {
  if (isVideoFile(file)) {
    return `[Attached video: ${file.url} (${kindOf(file).toUpperCase()}, ${size(file.size)}). You can't watch it; to put it on the page, use this URL in a <video> element.]`;
  }
  return `[Attached file: ${attachmentPath(file)} (${kindOf(file).toUpperCase()}, ${size(file.size)})]`;
}

/** The column as it comes: a list, or nothing. */
export function filesOf(v: readonly AttachedFile[] | null | undefined): AttachedFile[] {
  return Array.isArray(v) ? [...v] : [];
}
