/**
 * FILES THE USER ATTACHED (26/10): a PDF in the chat is a file Len reads with
 * `Read` when he decides, as in Claude Code — its path goes in the message and
 * nothing is read ahead of him. The bytes are the user's upload; the pages
 * come back as images (`lib/agent/pdf-pages.ts`), with Claude Code's wording,
 * ranges and limits.
 */
import type { InlineImage } from "@/lib/ai-gateway";

import { ejecutarRead, noExiste } from "./ficheros/read";
import { exito, fallo, formatoDeBytes, type Resultado } from "./ficheros/resultado";
import { MAX_PDF_PAGES_PER_READ, kindOf, type AttachedFile } from "@/lib/projects/chat-files";

import type { PdfPages } from "./pdf-pages";

export { ATTACHMENTS_DIR, type AttachedFile } from "@/lib/projects/chat-files";

/** `pages` as Claude Code takes it: one page ("3") or one range ("1-5"), 1-based. */
export function parsePages(raw: unknown): { ok: true; range: { first: number; last: number } | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return { ok: true, range: null };
  const text = String(raw).trim();
  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(text);
  const first = m ? Number(m[1]) : NaN;
  const last = m ? Number(m[2] ?? m[1]) : NaN;
  if (!m || first < 1 || last < first) {
    return {
      ok: false,
      error: `Invalid pages parameter: "${text}". Give one page ("3") or one range ("1-5"), not a list. To read several pages or ranges, read each one separately. Pages are 1-indexed.`,
    };
  }
  const count = last - first + 1;
  if (count > MAX_PDF_PAGES_PER_READ) {
    return {
      ok: false,
      error: `Invalid pages parameter: "${text}" asks for ${count} pages. Maximum ${MAX_PDF_PAGES_PER_READ} pages per request (e.g., pages: "${first}-${first + MAX_PDF_PAGES_PER_READ - 1}").`,
    };
  }
  return { ok: true, range: { first, last } };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** `Read` of an attached PDF: the text Len reads, and the pages as images. */
export async function readAttachedPdf(
  path: string,
  pages: unknown,
  attachments: ReadonlyMap<string, AttachedFile>,
  deps: {
    readonly read: (file: AttachedFile) => Promise<Uint8Array | null>;
    readonly render: (pdf: Uint8Array, range: { first: number; last: number } | null) => Promise<PdfPages>;
  },
): Promise<{ result: Resultado; images?: InlineImage[] }> {
  const file = attachments.get(path);
  if (!file) return { result: fallo(noExiste(path, [...attachments.keys()])) };
  const p = parsePages(pages);
  if (!p.ok) return { result: fallo(p.error) };
  const bytes = await deps.read(file).catch(() => null);
  if (!bytes) return { result: fallo("The PDF couldn't be downloaded this time. Don't take it as empty; you can try again.") };
  const r = await deps.render(bytes, p.range);
  if (!r.ok) {
    if (r.reason === "too_many_pages") {
      return {
        result: fallo(
          `This PDF has ${r.pageCount} pages, which is too many to read at once. Use the pages parameter to read specific page ranges (e.g., pages: "1-5"). Maximum ${MAX_PDF_PAGES_PER_READ} pages per request.`,
        ),
      };
    }
    if (r.reason === "page_out_of_range") {
      const asked = p.range!.first === p.range!.last ? `page ${p.range!.first}` : `pages ${p.range!.first}-${p.range!.last}`;
      return {
        result: fallo(
          `Requested ${asked} is outside the document (PDF has ${plural(r.pageCount, "page")}). Use a range within 1-${r.pageCount}, maximum ${MAX_PDF_PAGES_PER_READ} pages per request (e.g. pages: "1-${Math.min(r.pageCount, MAX_PDF_PAGES_PER_READ)}").`,
        ),
      };
    }
    if (r.reason === "password_protected") return { result: fallo("PDF is password-protected. Please provide an unprotected version.") };
    return { result: fallo("The PDF could not be read: it may be damaged, or not a PDF.") };
  }
  let text = `PDF pages extracted: ${r.images.length} page(s) from ${path} (${formatoDeBytes(file.size)})`;
  if (r.first > 1 || r.last < r.pageCount) {
    const count = r.last - r.first + 1;
    const next = r.last < r.pageCount ? `${r.last + 1}-${Math.min(r.last + count, r.pageCount)}` : `1-${Math.min(r.first - 1, MAX_PDF_PAGES_PER_READ)}`;
    text += `. This PDF has ${r.pageCount} pages. These are pages ${r.first}-${r.last}. Use the pages parameter to read other pages (e.g., pages: "${next}").`;
  }
  return { result: exito(text), images: r.images };
}

/**
 * `Read` of ANY attached file (spec local 2026-10-26-len-skills, §4.8): a PDF as its pages; a CSV as
 * the text it is, with Read's line numbers, offset and limit; an office file is binary, and Read
 * answers it as Claude Code answers any binary file, so Len opens it in the terminal with its skill.
 */
export async function readAttachment(
  path: string,
  args: { readonly pages?: unknown; readonly offset?: number; readonly limit?: number },
  attachments: ReadonlyMap<string, AttachedFile>,
  deps: Parameters<typeof readAttachedPdf>[3],
): Promise<{ result: Resultado; images?: InlineImage[] }> {
  const file = attachments.get(path);
  if (!file) return { result: fallo(noExiste(path, [...attachments.keys()])) };
  const kind = kindOf(file);
  if (kind === "pdf") return readAttachedPdf(path, args.pages, attachments, deps);
  if (kind === "csv") {
    const bytes = await deps.read(file).catch(() => null);
    if (!bytes) return { result: fallo("The file couldn't be downloaded this time. Don't take it as empty; you can try again.") };
    const text = new TextDecoder().decode(bytes);
    return {
      result: ejecutarRead(
        { file_path: path, ...(args.offset !== undefined ? { offset: args.offset } : {}), ...(args.limit !== undefined ? { limit: args.limit } : {}) },
        { contenido: (r) => (r === path ? text : null), ficheros: [path] },
        new Map(),
      ),
    };
  }
  return {
    result: fallo(
      `This tool cannot read binary files. The file appears to be a binary .${kind} file. Use a skill for this file type if one is available, or a shell command or script that can read the format.`,
    ),
  };
}
