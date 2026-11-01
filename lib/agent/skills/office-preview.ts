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

/** Seconds kept back from the budget: `timeout`'s 5 s grace before SIGKILL, plus the copy. */
const KILL_MARGIN_S = 8;
/** Below this, LibreOffice can't even start: not attempted. */
const MIN_SECONDS = 3;

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
  // Killed (`timeout -k 5`) before the terminal's own timeout, which would leave it running in the box's
  // background; with too little time left for that, not started.
  const seconds = Math.floor(budgetMs / 1000) - KILL_MARGIN_S;
  if (!ejecutar || !readFileBytes || seconds < MIN_SECONDS) return null;
  const outdir = `/tmp/office-preview/${randomHex()}`;
  const name = path.split("/").pop() ?? "";
  const stem = name.replace(/\.[^.]+$/, "");
  const copy = `${outdir}/${name}`;
  // A copy is converted, so LibreOffice's lock files stay in /tmp; with its own profile, so it never
  // waits on the one Len's office skills use in the same box.
  const command =
    `mkdir -p ${quote(outdir)} && cp -- ${quote(path)} ${quote(copy)} && ` +
    `timeout -k 5 ${seconds} soffice -env:UserInstallation=file://${outdir}/profile --headless --convert-to pdf --outdir ${quote(outdir)} ${quote(copy)}`;
  try {
    const run = await ejecutar.call(terminal, command, { timeoutMs: budgetMs });
    if (run.exitCode !== 0) return null;
    const pdf = await readFileBytes.call(terminal, `${outdir}/${stem}.pdf`);
    if (!pdf || pdf.byteLength < 5 || new TextDecoder().decode(pdf.slice(0, 5)) !== "%PDF-") return null;
    return pdf;
  } catch {
    return null;
  }
}
