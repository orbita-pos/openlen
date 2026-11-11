// THE PROJECTS SHE SERVES (spec local 2026-11-06-asistente-propio, §4.5): the person's own assistant is theirs and serves
// one or more of their projects — one assistant per project (`assistantProjects`' key). She can be taken off one, never
// off her last (for that, she is deleted). Her HOME is the project whose chat keeps her conversation with her owner
// (`projectChatMessages.conversation = "assistant:<id>"`) and whose box her turns use: when it goes — taken off, or the
// project deleted — her home and that conversation move to her oldest other project, so she is never lost with it.
import "server-only";

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { PublicTable } from "@/lib/db/schema";

import { ESTADO_EN_CURSO } from "@/lib/projects/stored-turn";

import { assistantConversationKey } from "./conversation";
import { isUniqueViolation } from "./store";

export interface ServedProject {
  readonly projectId: string;
  readonly title: string | null;
  readonly subdomain: string | null;
  /** Where her conversation with her owner lives. */
  readonly isHome: boolean;
  /** «En mi página»: the page's bubble is hers. */
  readonly onPage: boolean;
  /** What the project last published, as she knows it; null until a publish since she serves it. */
  readonly knowledge: string | null;
  readonly knowledgeAt: Date | null;
  /** The last publish that baked her bubble on this project's page. */
  readonly bakedAt: Date | null;
  readonly publicData: PublicTable[];
  readonly connectedAt: Date;
}

const a = schema.assistants;
const ap = schema.assistantProjects;
const p = schema.projects;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Her home first, then in the order she joined them. */
export async function projectsOfAssistant(assistantId: string): Promise<ServedProject[]> {
  const rows = await db
    .select({
      projectId: ap.projectId,
      title: p.title,
      subdomain: p.subdomain,
      isHome: sql<boolean>`${a.homeProjectId} = ${ap.projectId}`,
      onPage: ap.onPage,
      knowledge: ap.knowledge,
      knowledgeAt: ap.knowledgeAt,
      bakedAt: ap.bakedAt,
      publicData: ap.publicData,
      connectedAt: ap.connectedAt,
    })
    .from(ap)
    .innerJoin(a, eq(a.id, ap.assistantId))
    .innerJoin(p, eq(p.id, ap.projectId))
    .where(eq(ap.assistantId, assistantId))
    .orderBy(desc(sql`${a.homeProjectId} = ${ap.projectId}`), asc(ap.connectedAt), asc(ap.projectId));
  return rows.map((r) => ({ ...r, isHome: Boolean(r.isHome), publicData: r.publicData ?? [] }));
}

/** The projects each of these assistants serves (the person's list: a card knows whether this project has her). */
export async function projectIdsOf(assistantIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(assistantIds.map((id) => [id, []]));
  if (assistantIds.length === 0) return out;
  const rows = await db.select({ assistantId: ap.assistantId, projectId: ap.projectId }).from(ap).where(inArray(ap.assistantId, [...assistantIds])).orderBy(asc(ap.connectedAt));
  for (const r of rows) out.get(r.assistantId)?.push(r.projectId);
  return out;
}

/** Projects' titles by id (her visits name the project they came from, even one she no longer serves). */
export async function titlesOf(projectIds: readonly string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: p.id, title: p.title }).from(p).where(inArray(p.id, ids));
  return new Map(rows.map((r) => [r.id, r.title]));
}

/** The project's home document, for reading its accent (lib/assistants/create-tool.ts). */
export async function pageHtmlOf(projectId: string): Promise<string | null> {
  const [row] = await db.select({ data: p.data }).from(p).where(eq(p.id, projectId)).limit(1);
  const html = (row?.data as { html?: unknown } | null | undefined)?.html;
  return typeof html === "string" ? html : null;
}

/** The route checked that the project is her person's own. A project with an assistant keeps it. On the page at once,
 *  as when she is created (11/11, Jesús: «encendido de una»): the one door here is Len's card, «Usar a Lucía aquí». */
export async function connectProject(o: { readonly assistantId: string; readonly projectId: string }): Promise<"connected" | "project_has_assistant"> {
  try {
    await db.insert(ap).values({ projectId: o.projectId, assistantId: o.assistantId, onPage: true });
    return "connected";
  } catch (err) {
    if (isUniqueViolation(err)) return "project_has_assistant";
    throw err;
  }
}

/** Her home and her conversation with her owner move to `to`, in the caller's transaction. Len's rows never move. */
async function moveHome(tx: Tx, assistantId: string, from: string, to: string): Promise<void> {
  const m = schema.projectChatMessages;
  await tx.update(m).set({ projectId: to }).where(and(eq(m.projectId, from), eq(m.conversation, assistantConversationKey(assistantId))));
  await tx.update(a).set({ homeProjectId: to, updatedAt: new Date() }).where(eq(a.id, assistantId));
}

/** Her oldest project other than `except`, or null. */
async function oldestOther(tx: Tx, assistantId: string, except: string): Promise<string | null> {
  const [row] = await tx
    .select({ projectId: ap.projectId })
    .from(ap)
    .where(and(eq(ap.assistantId, assistantId), ne(ap.projectId, except)))
    .orderBy(asc(ap.connectedAt), asc(ap.projectId))
    .limit(1);
  return row?.projectId ?? null;
}

/** Takes her off a project. Off her home, her home moves first. Her visits and requests of that project stay, for her
 *  person to read. Under her row's lock, so two removals at once can't leave her with none. */
export async function disconnectProject(assistantId: string, projectId: string): Promise<"disconnected" | "only_project" | "not_connected" | "busy"> {
  return db.transaction(async (tx) => {
    const [her] = await tx.select({ home: a.homeProjectId }).from(a).where(eq(a.id, assistantId)).for("update");
    if (!her) return "not_connected";
    const [connected] = await tx.select({ projectId: ap.projectId }).from(ap).where(and(eq(ap.assistantId, assistantId), eq(ap.projectId, projectId)));
    if (!connected) return "not_connected";
    const other = await oldestOther(tx, assistantId, projectId);
    if (!other) return "only_project";
    if (her.home === projectId) {
      // A turn of hers closes its row by the project it started in: moved mid-turn, the row would stay «en curso» for good
      // in her new home (final review M1). Her home waits until she is done.
      const m = schema.projectChatMessages;
      const [answering] = await tx
        .select({ id: m.id })
        .from(m)
        .where(and(eq(m.projectId, projectId), eq(m.conversation, assistantConversationKey(assistantId)), eq(m.status, ESTADO_EN_CURSO)))
        .limit(1);
      if (answering) return "busy";
      await moveHome(tx, assistantId, projectId, other);
    }
    await tx.delete(ap).where(and(eq(ap.assistantId, assistantId), eq(ap.projectId, projectId)));
    return "disconnected";
  });
}

/** Before a project is deleted: every assistant whose home it is and who serves another moves there; one with no other
 *  project stays, and goes with it as before (the cascade). How many moved. */
export async function rehomeAssistantsOf(projectId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const homed = await tx.select({ id: a.id }).from(a).where(eq(a.homeProjectId, projectId)).for("update");
    let moved = 0;
    for (const { id } of homed) {
      const other = await oldestOther(tx, id, projectId);
      if (!other) continue;
      await moveHome(tx, id, projectId, other);
      moved++;
    }
    return moved;
  });
}
