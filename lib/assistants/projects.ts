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
import { isSpaceData } from "@/lib/space/types";

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

/** Whether the project is its person's space (spec local 2026-11-19-agentes-para-todos, §6.2): never a page to attend. */
async function isSpace(q: Tx | typeof db, projectId: string): Promise<boolean> {
  const [row] = await q.select({ data: p.data }).from(p).where(eq(p.id, projectId)).limit(1);
  return isSpaceData(row?.data as { space?: unknown } | null | undefined);
}

/** The route checked that the project is her person's own. A project with an assistant keeps it. On the page at once,
 *  as when she is created (11/11, Jesús: «encendido de una»): the one door here is Len's card, «Usar a Lucía aquí». */
export async function connectProject(o: {
  readonly assistantId: string;
  readonly projectId: string;
  /** Her bubble on the page: on, unless connected from the phone (Jesús 16/11, spec local
   *  2026-11-16-movil-es-tu-asistente, §5.6). Absent = on. */
  readonly onPage?: boolean;
}): Promise<"connected" | "project_has_assistant" | "space_not_a_page"> {
  if (await isSpace(db, o.projectId)) return "space_not_a_page";
  try {
    await db.insert(ap).values({ projectId: o.projectId, assistantId: o.assistantId, onPage: o.onPage ?? true });
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

/** Whether a turn of hers is running in this project. A turn closes its row by the project it started in: moved mid-turn,
 *  the row would stay «en curso» for good in her new home (final review M1). Her home waits until she is done. */
async function answeringAt(tx: Tx, assistantId: string, projectId: string): Promise<boolean> {
  const m = schema.projectChatMessages;
  const [answering] = await tx
    .select({ id: m.id })
    .from(m)
    .where(and(eq(m.projectId, projectId), eq(m.conversation, assistantConversationKey(assistantId)), eq(m.status, ESTADO_EN_CURSO)))
    .limit(1);
  return Boolean(answering);
}

/** Takes her off a project. Off her home, her home moves first; off her last, she would be lost, unless her home is
 *  elsewhere — an agent of the person's space attends pages without living on any (spec local
 *  2026-11-19-agentes-para-todos, §6.7). Her visits and requests of that project stay, for her person to read. Under her
 *  row's lock, so two removals at once can't leave her with none. */
export async function disconnectProject(assistantId: string, projectId: string): Promise<"disconnected" | "only_project" | "not_connected" | "busy"> {
  return db.transaction(async (tx) => {
    const [her] = await tx.select({ home: a.homeProjectId }).from(a).where(eq(a.id, assistantId)).for("update");
    if (!her) return "not_connected";
    const [connected] = await tx.select({ projectId: ap.projectId }).from(ap).where(and(eq(ap.assistantId, assistantId), eq(ap.projectId, projectId)));
    if (!connected) return "not_connected";
    if (her.home === projectId) {
      const other = await oldestOther(tx, assistantId, projectId);
      if (!other) return "only_project";
      if (await answeringAt(tx, assistantId, projectId)) return "busy";
      await moveHome(tx, assistantId, projectId, other);
    }
    await tx.delete(ap).where(and(eq(ap.assistantId, assistantId), eq(ap.projectId, projectId)));
    return "disconnected";
  });
}

/** «Atender una página» (spec local 2026-11-19-agentes-para-todos, §6.7): the person puts her on one of their pages in
 *  place of the assistant it had — one per page. That one leaves it; if it was her HOME (an assistant of before, born on
 *  that page), her home and her conversation with her owner move to the person's space first, so she is never lost with
 *  it — not while she is answering there. In one transaction, under the page's row. */
export async function replaceOnProject(o: {
  readonly assistantId: string;
  readonly projectId: string;
  readonly onPage: boolean;
  readonly spaceId: string;
}): Promise<"connected" | "busy" | "space_not_a_page" | "project_has_assistant"> {
  try {
    return await db.transaction(async (tx) => {
      if (await isSpace(tx, o.projectId)) return "space_not_a_page";
      const [seen] = await tx.select({ assistantId: ap.assistantId }).from(ap).where(eq(ap.projectId, o.projectId));
      if (seen?.assistantId === o.assistantId) return "connected";
      if (seen) {
        // Locked in disconnectProject's order — the assistant's row, then the page's — so the two at once wait for each
        // other instead of deadlocking; then the page is read again under its lock.
        const [old] = await tx.select({ home: a.homeProjectId }).from(a).where(eq(a.id, seen.assistantId)).for("update");
        const [current] = await tx.select({ assistantId: ap.assistantId }).from(ap).where(eq(ap.projectId, o.projectId)).for("update");
        if (current?.assistantId === o.assistantId) return "connected";
        // Another one took it while this waited: the person asks again with what is there now.
        if (current && current.assistantId !== seen.assistantId) return "busy";
        // Still hers (if she left meanwhile, the page is simply free).
        if (current) {
          if (old?.home === o.projectId) {
            if (await answeringAt(tx, current.assistantId, o.projectId)) return "busy";
            await moveHome(tx, current.assistantId, o.projectId, o.spaceId);
          }
          await tx.delete(ap).where(and(eq(ap.assistantId, current.assistantId), eq(ap.projectId, o.projectId)));
        }
      }
      await tx.insert(ap).values({ projectId: o.projectId, assistantId: o.assistantId, onPage: o.onPage });
      return "connected";
    });
  } catch (err) {
    // Another one was put on that free page at the same moment: it has it now.
    if (isUniqueViolation(err)) return "project_has_assistant";
    throw err;
  }
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
