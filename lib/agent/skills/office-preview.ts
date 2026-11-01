/**
 * The PDF preview of an Office deliverable (spec local 2026-10-31-len-movil, §5.2): the turn's box
 * converts it with LibreOffice, the same command as the `office-export-pdf` skill, so the web and the
 * phone show a faithful view instead of drawing PowerPoint themselves. Under /tmp, outside the project,
 * so nothing is synced back to its files. Anything odd (no box, a failed or slow command, no PDF) is
 * no preview: the file is delivered all the same. No Node imports: `present.ts`, which imports this,
 * also reaches the web chat's bundle (`deliveredFrom`).
 */
import type { TerminalBackend } from "@/lib/agent/terminal/backend";

const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");

export const OFFICE_PREVIEW_KINDS: readonly string[] = ["pptx", "docx", "xlsx", "xlsm", "csv"];

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Whether a delivered file's name asks for a preview. */
export function wantsOfficePreview(name: string): boolean {
  return OFFICE_PREVIEW_KINDS.includes(/\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "");
}

export async function officePreview(
  terminal: Partial<Pick<TerminalBackend, "ejecutar" | "readFileBytes">>,
  path: string,
  budgetMs: number,
): Promise<Uint8Array | null> {
  const { ejecutar, readFileBytes } = terminal;
  if (!ejecutar || !readFileBytes || budgetMs <= 0) return null;
  const outdir = `/tmp/office-preview/${randomHex()}`;
  const stem = (path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  try {
    const run = await ejecutar.call(terminal, `mkdir -p ${quote(outdir)} && soffice --headless --convert-to pdf --outdir ${quote(outdir)} ${quote(path)}`, { timeoutMs: budgetMs });
    if (run.exitCode !== 0) return null;
    const pdf = await readFileBytes.call(terminal, `${outdir}/${stem}.pdf`);
    if (!pdf || pdf.byteLength < 5 || new TextDecoder().decode(pdf.slice(0, 5)) !== "%PDF-") return null;
    return pdf;
  } catch {
    return null;
  }
}
