// `curl` to the project's Edge Functions from the box (spec local 2026-10-21-real-terminal-e2b, §6).
//
// The box's network reaches no OpenLen host, and a function call has to land in the DRAFT with its
// secrets masked on the way back — what today's terminal already does through OpenLen's door
// (lib/functions/curl.ts). So the request comes through the mailbox and runs in a short-lived
// today's terminal over the box's files: same parser, same door, same answer. What it writes
// (`-o out.json`) goes back into the box.

import type { TerminalBackend } from "@/lib/agent/terminal/backend";

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export type FunctionsCurlHandler = (
  args: readonly string[],
  cwd: string,
  files: Readonly<Record<string, string>>,
  o?: { readonly signal?: AbortSignal },
) => Promise<{ stdout: string; stderr: string; exitCode: number; files: Readonly<Record<string, string | null>> }>;

/** `newTerminal(files)`: today's terminal over those files, with the functions' `curl`. */
export function functionsCurlThrough(newTerminal: (files: Record<string, string>) => TerminalBackend): FunctionsCurlHandler {
  return async (args, cwd, files) => {
    const terminal = newTerminal({ ...files });
    try {
      const r = await terminal.ejecutar(`cd ${quote(cwd)} && curl ${args.map(quote).join(" ")}`);
      const changed: Record<string, string | null> = {};
      if (r.ficheros) {
        for (const [path, text] of Object.entries(r.ficheros)) if (files[path] !== text) changed[path] = text;
        for (const path of Object.keys(files)) if (!(path in r.ficheros)) changed[path] = null;
      }
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, files: changed };
    } finally {
      await terminal.cerrar().catch(() => undefined);
    }
  };
}
