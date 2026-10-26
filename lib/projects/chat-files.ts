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

/** A file attached to a message, as the chat row keeps it. */
export interface AttachedFile {
  readonly url: string;
  readonly name: string;
  readonly size: number;
}

/** Where Len reads it: `/.openlen/attachments/<upload id>/<name>`. The upload
 *  id keeps two files with the same name apart. */
export function attachmentPath(file: Pick<AttachedFile, "url" | "name">): string {
  const id = (file.url.split(/[?#]/)[0]!.split("/").pop() ?? "").replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "") || "file";
  const base = file.name.replace(/[^\p{L}\p{N}._ -]/gu, "-").replace(/\s+/g, "-").replace(/^[.-]+/, "").slice(0, 80) || "document";
  return `${ATTACHMENTS_DIR}/${id}/${/\.pdf$/i.test(base) ? base : `${base}.pdf`}`;
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
  return `[Attached file: ${attachmentPath(file)} (PDF, ${size(file.size)})]`;
}

/** The column as it comes: a list, or nothing. */
export function filesOf(v: readonly AttachedFile[] | null | undefined): AttachedFile[] {
  return Array.isArray(v) ? [...v] : [];
}
