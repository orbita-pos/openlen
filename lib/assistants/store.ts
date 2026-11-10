// THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio): where it is kept. One assistant per project
// and, in phase 1, one project per assistant; its conversation with its owner is rows of its home project's chat
// under its own key, deleted with it.
import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { AssistantSettings } from "@/lib/projects/types";

import { assistantConversationKey } from "./conversation";
import { assistantSlug, cleanAssistantName, type AssistantInput } from "./names";
import { readyNotices, type AskLenNotice, type ReadyNotice } from "./notices";

export type AssistantRow = typeof schema.assistants.$inferSelect;

const a = schema.assistants;

class Refused extends Error {
  constructor(readonly code: "name_taken" | "project_has_assistant") {
    super(code);
  }
}

export function isUniqueViolation(err: unknown): boolean {
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
  /** The morning summary, ticked in the creator (phase 4D, spec §6.9), and the language it was ticked in. */
  morningSummary?: boolean;
  locale?: string;
}): Promise<{ ok: true; assistant: AssistantRow } | { ok: false; code: "name_taken" | "project_has_assistant" }> {
  try {
    const assistant = await db.transaction(async (tx) => {
      let row: AssistantRow;
      try {
        [row] = await tx
          .insert(a)
          .values({
            personId: o.personId,
            homeProjectId: o.projectId,
            slug: assistantSlug(o.input.name),
            ...o.input,
            ...(o.memory ? { memory: o.memory } : {}),
            ...(o.morningSummary ? { morningSummary: true, summaryLocale: o.locale ?? null } : {}),
          })
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

/** Today's assistant of a project goes off (spec §6.4): she takes its place in the same publish. One atomic write of
 *  one field, so no read-modify-write of the project's settings can lose it. `false` when it wasn't on. */
export async function switchOldAssistantOff(projectId: string): Promise<boolean> {
  const p = schema.projects;
  const done = await db
    .update(p)
    .set({ data: sql`jsonb_set(${p.data}, '{settings,assistant,enabled}', 'false'::jsonb)`, updatedAt: new Date() })
    .where(and(eq(p.id, projectId), sql`${p.data}->'settings'->'assistant'->>'enabled' = 'true'`))
    .returning({ id: p.id });
  return done.length > 0;
}

export async function assistantBySlug(personId: string, slug: string): Promise<AssistantRow | null> {
  const [row] = await db.select().from(a).where(and(eq(a.personId, personId), eq(a.slug, slug))).limit(1);
  return row ?? null;
}

/** RENAMING HER (phase 4D, spec §6.8), as Claude Code's /rename: the name changes and the id doesn't. Her address follows
 *  her name; the old slug is kept as an alias the page redirects from (`assistantByOldSlug`), and one she takes back
 *  stops being an alias. Only the case or the accents changed → the name changes, the address doesn't. */
export async function renameAssistant(
  id: string,
  personId: string,
  rawName: string,
): Promise<{ ok: true; name: string; slug: string } | { ok: false; error: "invalid" | "name_taken" | "not_found" }> {
  const name = cleanAssistantName(rawName);
  if (!name) return { ok: false, error: "invalid" };
  const slug = assistantSlug(name);
  const aliases = schema.assistantSlugAliases;
  try {
    return await db.transaction(async (tx) => {
      const [her] = await tx.select({ slug: a.slug }).from(a).where(and(eq(a.id, id), eq(a.personId, personId))).limit(1).for("update");
      if (!her) return { ok: false as const, error: "not_found" as const };
      if (her.slug !== slug) {
        await tx
          .insert(aliases)
          .values({ personId, slug: her.slug, assistantId: id })
          .onConflictDoUpdate({ target: [aliases.personId, aliases.slug], set: { assistantId: id, createdAt: new Date() } });
        await tx.delete(aliases).where(and(eq(aliases.personId, personId), eq(aliases.slug, slug)));
      }
      await tx.update(a).set({ name, slug, updatedAt: new Date() }).where(eq(a.id, id));
      return { ok: true as const, name, slug };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "name_taken" };
    throw err;
  }
}

/** The morning summary's switch (phase 4D, spec §6.9): turning it on keeps the language it was turned on in; off keeps
 *  it. `false` when she isn't this person's. */
export async function setMorningSummary(id: string, personId: string, on: boolean, locale: string): Promise<boolean> {
  const done = await db
    .update(a)
    .set({ morningSummary: on, ...(on ? { summaryLocale: locale } : {}), updatedAt: new Date() })
    .where(and(eq(a.id, id), eq(a.personId, personId)))
    .returning({ id: a.id });
  return done.length > 0;
}

/** Where an old address of hers goes now: her live slug, or `null`. The page asks only when no live slug matches. */
export async function assistantByOldSlug(personId: string, slug: string): Promise<{ slug: string } | null> {
  const aliases = schema.assistantSlugAliases;
  const [row] = await db
    .select({ slug: a.slug })
    .from(aliases)
    .innerJoin(a, eq(a.id, aliases.assistantId))
    .where(and(eq(aliases.personId, personId), eq(aliases.slug, slug)))
    .limit(1);
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
