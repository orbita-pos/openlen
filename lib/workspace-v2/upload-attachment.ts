/**
 * A FILE FROM THE CHAT, UPLOADED: a PDF (26/10), or an office file or a CSV for the office skills
 * (spec local 2026-10-26-len-skills, §4.8), or a video for the page (spec local
 * 2026-10-27-chat-drop-and-images); and a photo (`uploadChatPhoto`). The message to Len carries files by address
 * (`attachedFiles`), and Len reads them when he decides, as in Claude Code. Uploaded through
 * `POST /api/upload` under the project's folder, checked first so a wrong file never leaves the
 * browser. No React state: it is tested with a fake `fetch`.
 */
import {
  ATTACHMENT_KINDS,
  MAX_OFFICE_BYTES,
  MAX_PDF_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_KINDS,
  kindFromName,
  videoKindFromMime,
  videoKindFromName,
  type AttachedFile,
} from "@/lib/projects/chat-files";
import { reducirImagen } from "@/components/marketing/reducir-imagen";
import { MAX_GIF_BYTES } from "./classify-dropped-files";
import { uploadPhotos } from "./upload-photos";

export type UploadedAttachment = { readonly ok: true; readonly file: AttachedFile } | { readonly ok: false; readonly reason: "not_supported" | "too_big" | "failed" };

/** What the file pickers take. */
export const ATTACHMENT_ACCEPT = [
  "application/pdf",
  ...Object.keys(ATTACHMENT_KINDS).map((k) => `.${k}`),
  ...Object.entries(VIDEO_KINDS).flatMap(([k, v]) => [v.mime, `.${k}`]),
].join(",");

export async function uploadAttachment(file: File, projectId: string, fetchImpl: typeof fetch = fetch): Promise<UploadedAttachment> {
  const video = videoKindFromMime(file.type) ?? videoKindFromName(file.name);
  const kind = video ?? (file.type === "application/pdf" ? "pdf" : kindFromName(file.name));
  if (!kind) return { ok: false, reason: "not_supported" };
  if (file.size > (video ? MAX_VIDEO_BYTES : kind === "pdf" ? MAX_PDF_BYTES : MAX_OFFICE_BYTES)) return { ok: false, reason: "too_big" };
  const name = file.name || `document.${kind}`;
  try {
    const form = new FormData();
    // Its own type, whatever the browser said: some send office files as "" or octet-stream.
    form.append("file", new File([file], name, { type: video ? VIDEO_KINDS[video].mime : ATTACHMENT_KINDS[kind as keyof typeof ATTACHMENT_KINDS].mime }));
    form.append("generationId", projectId);
    const res = await fetchImpl("/api/upload", { method: "POST", body: form });
    const data = (await res.json().catch(() => null)) as { url?: unknown; size?: unknown } | null;
    if (!res.ok || typeof data?.url !== "string" || !data.url) return { ok: false, reason: "failed" };
    const size = typeof data.size === "number" ? data.size : file.size;
    // A PDF stays as before, without `kind`.
    return { ok: true, file: { url: data.url, name, size, ...(kind !== "pdf" ? { kind } : {}) } };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export type UploadedPhoto = { readonly ok: true; readonly image: { readonly url: string } } | { readonly ok: false; readonly reason: "not_supported" | "too_big" | "failed" };

/** A photo dropped or pasted on the chat: a GIF as it is (its animation), any other reduced in the
 *  browser first, as the start screen does, and then the same upload as its photos. */
export async function uploadChatPhoto(
  file: File,
  projectId: string,
  deps: { readonly reduce?: (f: File) => Promise<{ readonly dataUrl: string } | null>; readonly fetchImpl?: typeof fetch } = {},
): Promise<UploadedPhoto> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (file.type === "image/gif") {
    if (file.size > MAX_GIF_BYTES) return { ok: false, reason: "too_big" };
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("generationId", projectId);
      const res = await fetchImpl("/api/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { url?: unknown } | null;
      return res.ok && typeof data?.url === "string" && data.url ? { ok: true, image: { url: data.url } } : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  }
  const reduced = await (deps.reduce ?? reducirImagen)(file).catch(() => null);
  if (!reduced) return { ok: false, reason: "not_supported" };
  const r = await uploadPhotos([{ dataUrl: reduced.dataUrl, nombre: file.name }], projectId, fetchImpl);
  return r.images[0] ? { ok: true, image: { url: r.images[0].url } } : { ok: false, reason: "failed" };
}
