// What a browser gets of the person's own assistant: never its memory. Pure.
import type { FigureLook } from "@/lib/figure/look";

import { lookOfRow } from "./look";
import type { AssistantTone } from "./names";

export interface AssistantView {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  /** Her figure, whole (phase 6). */
  readonly look: FigureLook;
  /** Her accent: the look's color. */
  readonly color: string;
  readonly tone: AssistantTone;
  readonly projectId: string;
  /** Her morning summary is on (phase 4D, spec §6.9). */
  readonly morningSummary?: boolean;
  /** The agent file Len wrote for it, `~/.len/agents/<name>.md` (spec local 2026-11-19-agentes-para-todos, §6.1); absent
   *  for an assistant without one. Its name only: never what it says. */
  readonly agentType?: string;
}

/** In the person's list: also the projects she serves (her home is `projectId`). */
export interface AssistantListItem extends AssistantView {
  readonly projectIds: readonly string[];
}

export function assistantView(a: { id: string; name: string; slug: string; look?: unknown; color: string; tone: string; homeProjectId: string; morningSummary?: boolean; agentType?: string | null }): AssistantView {
  const look = lookOfRow(a);
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    look,
    color: look.color,
    tone: a.tone as AssistantTone,
    projectId: a.homeProjectId,
    ...(a.morningSummary !== undefined ? { morningSummary: a.morningSummary } : {}),
    ...(a.agentType ? { agentType: a.agentType } : {}),
  };
}
