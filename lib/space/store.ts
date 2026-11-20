// THE PERSON'S SPACE (spec local 2026-11-19-agentes-para-todos, §6.2): found or born, one per person. The unique partial
// index `projects_one_space_idx` (`npm run assistants:migrate`) is what keeps it one: two tabs creating the first agent
// at once both insert, one wins, and both read the winner back.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { SpaceOfProject } from "./types";

const isSpace = sql`(${schema.projects.data}->'space') is not null`;

/** The person's space, or null when they never made an agent. */
export async function spaceIdOf(personId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.userId, personId), isNull(schema.projects.parentProjectId), isSpace))
    .limit(1);
  return row?.id ?? null;
}

/** The person's space, born the first time. Never trusts its own insert under a race: it reads the winner back. */
export async function ensureSpace(personId: string): Promise<string> {
  const found = await spaceIdOf(personId);
  if (found) return found;
  const space: SpaceOfProject = { bornAt: new Date().toISOString() };
  await db
    .insert(schema.projects)
    .values({ id: crypto.randomUUID(), userId: personId, title: "Space", brief: "", tags: [], status: "draft", data: { html: "", space } })
    .onConflictDoNothing();
  const born = await spaceIdOf(personId);
  if (!born) throw new Error("the person's space could not be made");
  return born;
}
