// A11 (spec local 2026-10-25-a11-continuity, point 8): after a summary, the files
// read most recently come back, as Claude Code does (binary 2.1.304, `Clr`: the
// most recent reads, `oXe` = 5 of them, each read with `rXe` = 5,000 tokens at
// most, `klr` = 50,000 in all; a file that is too large comes back as its
// `compact_file_reference` note). DeepSeek's harness has no such piece, so the
// texts are Claude Code's, verbatim. Pure.
import type { Message } from "@/lib/ai-gateway";

export const POST_COMPACT_MAX_FILES = 5;
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000;
export const POST_COMPACT_TOKEN_BUDGET = 50_000;

/** A file read again after the summary: Len's own `Read` output, or `null` if
 *  it no longer exists; `tokens` is that output's size. */
export interface RestoredFile {
  readonly path: string;
  readonly output: string | null;
  readonly tokens: number;
}

const readBlock = (path: string, output: string): string =>
  `Called the Read tool with the following input: ${JSON.stringify({ file_path: path })}\nResult of calling the Read tool:\n${output}`;

const tooLargeNote = (path: string): string =>
  `Note: ${path} was read before the last conversation was summarized, but the contents are too large to include. Use Read tool if you need to access it.`;

/** The message that goes right after the summary, or `null` if nothing comes back.
 *  `files` come most recent first. */
export function restoredFilesMessage(files: readonly RestoredFile[]): Message | null {
  const blocks: string[] = [];
  let spent = 0;
  for (const f of files.slice(0, POST_COMPACT_MAX_FILES)) {
    if (f.output === null) continue;
    const tooLarge = f.tokens > POST_COMPACT_MAX_TOKENS_PER_FILE;
    const text = tooLarge ? tooLargeNote(f.path) : readBlock(f.path, f.output);
    const cost = tooLarge ? Math.ceil(text.length / 3.5) : f.tokens;
    if (spent + cost > POST_COMPACT_TOKEN_BUDGET) continue;
    spent += cost;
    blocks.push(text);
  }
  return blocks.length > 0 ? { role: "user", content: blocks.join("\n\n") } : null;
}
