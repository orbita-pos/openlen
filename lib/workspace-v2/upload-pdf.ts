/**
 * A PDF FROM THE CHAT, UPLOADED (26/10). The message to Len carries files by
 * address (`attachedFiles`), and Len reads them with Read when he decides, as
 * in Claude Code. Uploaded through `POST /api/upload` under the project's
 * folder, checked first so a wrong file never leaves the browser. No React
 * state: it is tested with a fake `fetch`.
 */
import { MAX_PDF_BYTES, type AttachedFile } from "@/lib/projects/chat-files";

export type UploadedPdf = { readonly ok: true; readonly file: AttachedFile } | { readonly ok: false; readonly reason: "not_pdf" | "too_big" | "failed" };

export async function uploadPdf(file: File, projectId: string, fetchImpl: typeof fetch = fetch): Promise<UploadedPdf> {
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return { ok: false, reason: "not_pdf" };
  if (file.size > MAX_PDF_BYTES) return { ok: false, reason: "too_big" };
  try {
    const form = new FormData();
    form.append("file", new File([file], file.name || "document.pdf", { type: "application/pdf" }));
    form.append("generationId", projectId);
    const res = await fetchImpl("/api/upload", { method: "POST", body: form });
    const data = (await res.json().catch(() => null)) as { url?: unknown; size?: unknown } | null;
    if (!res.ok || typeof data?.url !== "string" || !data.url) return { ok: false, reason: "failed" };
    return { ok: true, file: { url: data.url, name: file.name || "document.pdf", size: typeof data.size === "number" ? data.size : file.size } };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
