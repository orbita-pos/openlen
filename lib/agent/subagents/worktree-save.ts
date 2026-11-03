// An isolated child's merge uses the real guards, with the expected draft and every write/version in one
// serializable transaction. A refusal rolls back the whole batch; a concurrent write asks the merge to retry.
// Cache effect: none; this changes persistence only.
import "server-only";
import { inTransaction } from "@/lib/db";
import { draftFiles } from "@/lib/len-watch/bring";
import { guardarLoDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import type { SaveIntoDraft } from "./worktree";

class Refused extends Error {}
export async function saveWorktreeIntoDraft(session: AgentSession, deps: AgentDeps, changes: Parameters<SaveIntoDraft>[0], draft: Parameters<SaveIntoDraft>[1]): ReturnType<SaveIntoDraft> {
  try {
    return await inTransaction(async () => {
      const current = await draftFiles(session.projectId);
      if (changes.some(c => current[c.ruta] !== draft[c.ruta])) return { rechazado: false, retry: true };
      // Guard bookkeeping from a rejected transaction must not escape into another attempt.
      const attempt: AgentSession = { ...session, leidos: new Map(session.leidos), escritos: [...(session.escritos ?? [])], alEmpezar: new Map(session.alEmpezar) };
      const result = await guardarLoDeLaTerminal(attempt, deps, changes, draft);
      if (result.rechazado) throw new Refused();
      return { rechazado: false };
    });
  } catch (error) {
    if (error instanceof Refused) return { rechazado: true };
    // Drizzle wraps PostgreSQL errors in `cause`.
    const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "40001" || code === "40P01") return { rechazado: false, retry: true };
    throw error;
  }
}
