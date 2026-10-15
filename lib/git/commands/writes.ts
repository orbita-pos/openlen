// What a command writes to the working tree, minus what is already there: the terminal should
// save (and version) only the files that really change.
import type { CommandContext } from "../command";
import { toRepoPath } from "../paths";

export function onlyChanged(ctx: CommandContext, write: Readonly<Record<string, string | null>>): Record<string, string | null> | undefined {
  const out: Record<string, string | null> = {};
  for (const [abs, content] of Object.entries(write)) {
    const now = ctx.tree.files.get(toRepoPath(abs));
    if (content === null ? now !== undefined : now !== content) out[abs] = content;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
