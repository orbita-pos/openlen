// WHAT WAITED FOR AN AGENT RIDES WITH ITS PERSON'S TURN (spec local 2026-11-21-len-y-el-agente-conversan, decision 9).
// A message from Len kept without waking the agent — the cap of four, no credits, agents off — never wakes anyone by
// itself: the agent's next turn its person starts claims it, as the store's claim does for a woken turn, and the agent
// reads it before its first call, the way the notes of its ask_len requests reach it (app/api/agent/route.ts). The
// messages may be about several projects: each project is framed apart, with its own title and id, so the reply goes
// back to the right one.
import { rideAlongForAgent } from "./policy";
import type { AgentLenMessage } from "./store";

/** What claiming needs, injected so the tests never reach a database. */
export interface RideAlongDeps {
  claimForAgent(assistantId: string, rowId: string, at: Date): Promise<AgentLenMessage[]>;
  /** The titles of the projects that exist (lib/assistants/projects.ts `titlesOf`). */
  titlesOf(projectIds: readonly string[]): Promise<Map<string, string | null>>;
}

/** What a turn claimed: the ids (to give back if the turn leaves no trace of them) and what the model reads. */
export interface HeldForAgent {
  readonly ids: readonly string[];
  readonly framing: string;
}

async function liveDeps(): Promise<RideAlongDeps> {
  const [{ claimForAgent }, { titlesOf }] = await Promise.all([import("./store"), import("../projects")]);
  return { claimForAgent, titlesOf };
}

/** Claims everything waiting for the agent, marked read by `rowId` (the turn's chat row), and frames it per project in
 *  the order each first appears. `null` when nothing waited: no framing is ever made of an empty list. A title that
 *  can't be read is the project's id. */
export async function claimRideAlongForAgent(assistantId: string, rowId: string, at: Date, deps?: RideAlongDeps): Promise<HeldForAgent | null> {
  const d = deps ?? (await liveDeps());
  const rows = await d.claimForAgent(assistantId, rowId, at);
  if (rows.length === 0) return null;
  const byProject = new Map<string, AgentLenMessage[]>();
  for (const r of rows) {
    const mine = byProject.get(r.projectId);
    if (mine) mine.push(r);
    else byProject.set(r.projectId, [r]);
  }
  const titles = await d.titlesOf([...byProject.keys()]).catch(() => new Map<string, string | null>());
  const framing = [...byProject]
    .map(([projectId, mine]) => rideAlongForAgent({ projectTitle: titles.get(projectId)?.trim() || projectId, projectId, messages: mine.map((r) => ({ text: r.text })) }))
    .join("\n\n");
  return { ids: rows.map((r) => r.id), framing };
}

/** The turn that claimed them never handed them to the model, or left no row to point at: they go back to waiting for
 *  the agent's next turn (the store's `releaseToHeld`, which moves only what is still marked read). */
export async function giveBackRideAlong(ids: readonly string[], deps?: Pick<typeof import("./store"), "releaseToHeld">): Promise<void> {
  if (ids.length === 0) return;
  const d = deps ?? (await import("./store"));
  await d.releaseToHeld(ids, "no_credits");
}
