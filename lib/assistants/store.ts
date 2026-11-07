// THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio): where it is kept. One assistant per project
// and, in phase 1, one project per assistant; its conversation with its owner is rows of its home project's chat
// under its own key, deleted with it.
import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { assistantConversationKey } from "./conversation";
import { assistantSlug, type AssistantInput } from "./names";

export type AssistantRow = typeof schema.assistants.$inferSelect;

const a = schema.assistants;

class Refused extends Error {
  constructor(readonly code: "name_taken" | "project_has_assistant") {
    super(code);
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === "23505" || e.cause?.code === "23505";
}

export async function createAssistant(o: {
  personId: string;
  projectId: string;
  input: AssistantInput;
}): Promise<{ ok: true; assistant: AssistantRow } | { ok: false; code: "name_taken" | "project_has_assistant" }> {
  try {
    const assistant = await db.transaction(async (tx) => {
      let row: AssistantRow;
      try {
        [row] = await tx
          .insert(a)
          .values({ personId: o.personId, homeProjectId: o.projectId, slug: assistantSlug(o.input.name), ...o.input })
          .returning();
      } catch (err) {
        if (isUniqueViolation(err)) throw new Refused("name_taken");
        throw err;
      }
      try {
        await tx.insert(schema.assistantProjects).values({ projectId: o.projectId, assistantId: row!.id });
      } catch (err) {
        if (isUniqueViolation(err)) throw new Refused("project_has_assistant");
        throw err;
      }
      return row!;
    });
    return { ok: true, assistant };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, code: err.code };
    throw err;
  }
}

export async function assistantBySlug(personId: string, slug: string): Promise<AssistantRow | null> {
  const [row] = await db.select().from(a).where(and(eq(a.personId, personId), eq(a.slug, slug))).limit(1);
  return row ?? null;
}

export async function assistantById(id: string): Promise<AssistantRow | null> {
  const [row] = await db.select().from(a).where(eq(a.id, id)).limit(1);
  return row ?? null;
}

/** The newest first. */
export async function assistantsOf(personId: string): Promise<AssistantRow[]> {
  return db.select().from(a).where(eq(a.personId, personId)).orderBy(desc(a.createdAt));
}

export async function assistantOfProject(projectId: string): Promise<AssistantRow | null> {
  const p = schema.assistantProjects;
  const [row] = await db.select({ assistant: a }).from(p).innerJoin(a, eq(a.id, p.assistantId)).where(eq(p.projectId, projectId)).limit(1);
  return row?.assistant ?? null;
}

/** `false` when it is not this person's. Its conversation goes with it. */
export async function deleteAssistant(personId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [gone] = await tx.delete(a).where(and(eq(a.id, id), eq(a.personId, personId))).returning({ homeProjectId: a.homeProjectId });
    if (!gone) return false;
    const m = schema.projectChatMessages;
    await tx.delete(m).where(and(eq(m.projectId, gone.homeProjectId), eq(m.conversation, assistantConversationKey(id))));
    return true;
  });
}

export async function saveAssistantMemory(id: string, text: string): Promise<void> {
  await db.update(a).set({ memory: text, updatedAt: new Date() }).where(eq(a.id, id));
}
