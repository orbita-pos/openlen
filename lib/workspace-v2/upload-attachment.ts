/**
 * A FILE FROM THE CHAT, UPLOADED: a PDF (26/10), or an office file or a CSV for the office skills
 * (spec local 2026-10-26-len-skills, §4.8). The message to Len carries files by address
 * (`attachedFiles`), and Len reads them when he decides, as in Claude Code. Uploaded through
 * `POST /api/upload` under the project's folder, checked first so a wrong file never leaves the
 * browser. No React state: it is tested with a fake `fetch`.
 */
import { ATTACHMENT_KINDS, MAX_OFFICE_BYTES, MAX_PDF_BYTES, kindFromName, type AttachedFile } from "@/lib/projects/chat-files";

export type UploadedAttachment = { readonly ok: true; readonly file: AttachedFile } | { readonly ok: false; readonly reason: "not_supported" | "too_big" | "failed" };

/** What the file pickers take. */
export const ATTACHMENT_ACCEPT = ["application/pdf", ...Object.keys(ATTACHMENT_KINDS).map((k) => `.${k}`)].join(",");

export async function uploadAttachment(file: File, projectId: string, fetchImpl: typeof fetch = fetch): Promise<UploadedAttachment> {
  const kind = file.type === "application/pdf" ? "pdf" : kindFromName(file.name);
  if (!kind) return { ok: false, reason: "not_supported" };
  if (file.size > (kind === "pdf" ? MAX_PDF_BYTES : MAX_OFFICE_BYTES)) return { ok: false, reason: "too_big" };
  const name = file.name || `document.${kind}`;
  try {
    const form = new FormData();
    // Its own type, whatever the browser said: some send office files as "" or octet-stream.
    form.append("file", new File([file], name, { type: ATTACHMENT_KINDS[kind].mime }));
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
