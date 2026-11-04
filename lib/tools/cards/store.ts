// WHERE «CREAR» CARDS LIVE (spec local 2026-11-04-herramientas-hechas-por-len, §4.10). DeepSeek keeps proposals and
// decisions in the session log (packages/experimental/action-cards); here a card is a row: a newer card replaces
// every unstarted one of the same person's chat in that project, a phase changes by compare-and-swap (decided once),
// and Len hears a card again only when the person or the background work changed it.
import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { ToolPlacement } from "../types";
import type { ToolCardPhase, ToolCardView } from "./types";

export type ToolCardRow = typeof schema.toolCards.$inferSelect;

const c = schema.toolCards;

/** Phases the model made, not news to it (DeepSeek: a replaced card «no status is reported»). */
const NOT_NEWS: readonly ToolCardPhase[] = ["proposed", "replaced"];

export function toCardView(row: ToolCardRow): ToolCardView {
  return {
    id: row.id,
    chatRowId: row.chatRowId,
    title: row.title,
    brief: row.brief,
    initialContent: row.initialContent,
    placement: row.placement,
    customLocation: row.customLocation,
    phase: row.phase,
    toolProjectId: row.toolProjectId,
    installationId: row.installationId,
    error: row.error,
    review: row.review,
  };
}

/** A proposed card; the person's earlier unstarted card in this project becomes `replaced`. */
export async function insertCard(input: {
  readonly projectId: string;
  readonly chatRowId: string;
  readonly personId: string;
  readonly title: string;
  readonly brief: string;
  readonly initialContent: string | null;
  readonly placement: ToolPlacement;
}): Promise<ToolCardRow> {
  await db
    .update(c)
    .set({ phase: "replaced", updatedAt: sql`now()`, statusDeliveredAt: sql`now()` })
    .where(and(eq(c.projectId, input.projectId), eq(c.personId, input.personId), eq(c.phase, "proposed")));
  const now = new Date();
  const [row] = await db
    .insert(c)
    .values({ id: randomUUID(), ...input, phase: "proposed", createdAt: now, updatedAt: now })
    .returning();
  if (!row) throw new Error("toolCards: the insert returned no row");
  return row;
}

export async function cardById(id: string): Promise<ToolCardRow | null> {
  const [row] = await db.select().from(c).where(eq(c.id, id)).limit(1);
  return row ?? null;
}

/** The person's cards in a project, oldest first: each is drawn under the answer it follows. */
export function cardsOfProject(projectId: string, personId: string): Promise<ToolCardRow[]> {
  return db.select().from(c).where(and(eq(c.projectId, projectId), eq(c.personId, personId))).orderBy(asc(c.createdAt));
}

/** Change the phase only from one of `from` (decided once); null when another press got there first. */
export async function casPhase(
  id: string,
  from: readonly ToolCardPhase[],
  to: ToolCardPhase,
  set: Partial<Omit<typeof c.$inferInsert, "id" | "phase">> = {},
): Promise<ToolCardRow | null> {
  const [row] = await db
    .update(c)
    .set({ ...set, phase: to, updatedAt: sql`now()` })
    .where(and(eq(c.id, id), inArray(c.phase, [...from])))
    .returning();
  return row ?? null;
}

/** Cards of this person and project that changed since Len last heard about them. */
export function undeliveredCards(projectId: string, personId: string): Promise<ToolCardRow[]> {
  return db
    .select()
    .from(c)
    .where(
      and(
        eq(c.projectId, projectId),
        eq(c.personId, personId),
        notInArray(c.phase, [...NOT_NEWS]),
        or(isNull(c.statusDeliveredAt), gt(c.updatedAt, c.statusDeliveredAt)),
      ),
    )
    .orderBy(asc(c.updatedAt));
}

export async function markDelivered(ids: readonly string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await db.update(c).set({ statusDeliveredAt: at }).where(inArray(c.id, [...ids]));
}
