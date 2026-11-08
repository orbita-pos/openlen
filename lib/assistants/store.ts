// THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio): where it is kept. One assistant per project
// and, in phase 1, one project per assistant; its conversation with its owner is rows of its home project's chat
// under its own key, deleted with it.
import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { AssistantSettings } from "@/lib/projects/types";

import { assistantConversationKey } from "./conversation";
import { assistantSlug, type AssistantInput } from "./names";
import { readyNotices, type AskLenNotice, type ReadyNotice } from "./notices";

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
  /** Its memory to start with: what today's assistant of the project was taught (lib/assistants/knowledge.ts). */
  memory?: string;
}): Promise<{ ok: true; assistant: AssistantRow } | { ok: false; code: "name_taken" | "project_has_assistant" }> {
  try {
    const assistant = await db.transaction(async (tx) => {
      let row: AssistantRow;
      try {
        [row] = await tx
          .insert(a)
          .values({ personId: o.personId, homeProjectId: o.projectId, slug: assistantSlug(o.input.name), ...o.input, ...(o.memory ? { memory: o.memory } : {}) })
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

/** Today's assistant of a project (`settings.assistant`): what it was taught becomes her memory (spec §6.4). */
export async function oldAssistantSettings(projectId: string): Promise<AssistantSettings | undefined> {
  const [row] = await db.select({ data: schema.projects.data }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  return row?.data?.settings?.assistant ?? undefined;
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

// HOW ITS ask_len REQUESTS END (lib/assistants/notices.ts): appended when passed, settled when Len's turn ends, handed
// to its next request and removed once heard — DeepSeek's «marked delivered once».

/** Read-modify-write under the row's lock: two settlements never overwrite each other. */
async function withNotices(id: string, change: (notices: AskLenNotice[]) => AskLenNotice[]): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ notices: a.notices }).from(a).where(eq(a.id, id)).limit(1).for("update");
    if (!row) return;
    await tx.update(a).set({ notices: change(row.notices ?? []) }).where(eq(a.id, id));
  });
}

export async function addAssistantNotice(id: string, notice: AskLenNotice): Promise<void> {
  await withNotices(id, (all) => [...all, notice]);
}

export async function settleAssistantNotice(id: string, noticeId: string, patch: Partial<Pick<AskLenNotice, "status" | "closing" | "reason">>): Promise<void> {
  await withNotices(id, (all) => all.map((n) => (n.id === noticeId ? { ...n, ...patch } : n)));
}

export async function readyAssistantNotices(id: string, now: Date): Promise<ReadyNotice[]> {
  const [row] = await db.select({ notices: a.notices }).from(a).where(eq(a.id, id)).limit(1);
  return readyNotices(row?.notices ?? [], now);
}

export async function removeAssistantNotices(id: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await withNotices(id, (all) => all.filter((n) => !ids.includes(n.id)));
}
