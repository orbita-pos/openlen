/**
 * THE CHAT'S UPLOADS IN FLIGHT (spec local 2026-10-27-chat-drop-and-images, Part A).
 */

/** A file dropped, pasted or picked that is still uploading: its chip in the composer. */
export interface PendingUpload {
  readonly id: string;
  readonly name: string;
  readonly kind: "photo" | "file";
}
