// Los hijos de un turno, sólo sus referencias y sus números: sin pasos ni mensaje final.
import { SUBAGENT_CARD_TOOLS, subagentRefFrom, type SubagentRef } from "@/lib/agent/subagents/card";
import type { SubagentStatus, WorktreeOutcome } from "@/lib/agent/subagents/notice";
import type { StoredChatTurn } from "@/lib/projects/types";

export function subagentRefsOf(acciones: StoredChatTurn["actions"]): SubagentRef[] {
  const vistos = new Set<string>();
  return (acciones ?? []).flatMap(a => {
    const ref = SUBAGENT_CARD_TOOLS.has(a.tool) ? subagentRefFrom(a.subagent) : null;
    if (!ref || vistos.has(ref.id)) return [];
    vistos.add(ref.id);
    return [ref];
  });
}

export interface RunDelMovil {
  id: string;
  preset: string;
  description: string;
  status: SubagentStatus;
  toolUses: number;
  durationMs: number | null;
  worktree: null | { state: "working" } | WorktreeOutcome;
}

export const trabajando = (runs: readonly RunDelMovil[]): number => runs.filter(r => r.status === "running").length;
