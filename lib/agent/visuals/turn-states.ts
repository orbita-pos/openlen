/**
 * WHAT THE VISUALS SHARED, brought by a correction or an answer while the turn runs (spec local
 * 2026-11-22-visuales-de-verdad, §2). The turn's own message is checked in the route; these come through
 * `/api/agent/dirigir` and `/api/agent/responder`, and replace what the turn holds. A visual counts if this conversation
 * drew it (`widgetsOfConversation`) or this very turn did — its card isn't stored yet (`widgetsDrawnBy`).
 */
import { openTurnOf, widgetsDrawnBy } from "@/lib/agent/direcciones";
import { widgetsOfConversation } from "@/lib/projects/chat";

import { cleanVisualStates, heldVisualStates, type HeldVisualState } from "./model-context";

/** `null`: the body brought no states (what the turn holds stays) or the turn isn't this person's. Otherwise what the turn
 *  should hold now — possibly none. */
export async function visualStatesForOpenTurn(turnoId: string, userId: string, raw: unknown): Promise<HeldVisualState[] | null> {
  if (raw === undefined) return null;
  const open = openTurnOf(turnoId, userId);
  if (!open) return null;
  const states = cleanVisualStates(raw);
  if (states.length === 0) return [];
  const known = new Map(widgetsDrawnBy(turnoId));
  if (open.projectId) {
    const stored = await widgetsOfConversation(open.projectId, open.conversation).catch(() => new Map<string, string | null>());
    for (const [id, title] of stored) if (!known.has(id)) known.set(id, title);
  }
  return heldVisualStates(states, known);
}
