// WHOM LEN MAY WRITE TO IN A PROJECT (spec local 2026-11-21-len-y-el-agente-conversan, §1 and decision 11): the agents of
// the project's OWNER related to it — the one that asked for the turn in course, the one serving the project, the ones
// that started it with ask_len's `new_project` —, whoever speaks: in a shared project a member's turn still writes only
// to the owner's agents. No other agent, and never another person's. Each one once, with the first reason that applies
// in that order, and the home its turn runs in (the waker's `homeProjectId`).
import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { RelatedWhy } from "./policy";

export interface RelatedAgent {
  readonly id: string;
  readonly name: string;
  readonly homeProjectId: string;
  readonly why: RelatedWhy;
}

const a = schema.assistants;
const ap = schema.assistantProjects;
const sp = schema.assistantStartedProjects;
const columns = { id: a.id, name: a.name, homeProjectId: a.homeProjectId };

/** `originAssistantId`: the agent an `assistant` origin names (its ask_len request, or its message that woke Len); null
 *  for a turn no agent started. The ones that started it come oldest first. */
export async function relatedAgentsOf(projectId: string, ownerId: string, originAssistantId: string | null): Promise<RelatedAgent[]> {
  const [asked, serves, started] = await Promise.all([
    originAssistantId ? db.select(columns).from(a).where(and(eq(a.id, originAssistantId), eq(a.personId, ownerId))).limit(1) : Promise.resolve([]),
    db.select(columns).from(ap).innerJoin(a, eq(a.id, ap.assistantId)).where(and(eq(ap.projectId, projectId), eq(a.personId, ownerId))),
    db
      .select(columns)
      .from(sp)
      .innerJoin(a, eq(a.id, sp.assistantId))
      .where(and(eq(sp.projectId, projectId), eq(a.personId, ownerId)))
      .orderBy(asc(sp.startedAt), asc(sp.assistantId)),
  ]);
  const related = new Map<string, RelatedAgent>();
  for (const [why, rows] of [["asked", asked], ["serves", serves], ["started", started]] as const) {
    for (const r of rows) if (!related.has(r.id)) related.set(r.id, { ...r, why });
  }
  return [...related.values()];
}
