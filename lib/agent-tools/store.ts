// WHERE AN AGENT'S TOOLS LIVE (spec local 2026-11-22-herramienta-dentro-del-agente, §1–§3): Postgres is the truth. A tool is
// one row per agent and folder (`slug`), whose private labels are fixed for its life — so publishing it again keeps the
// address the screens already framed — and the small database it shares with its agent is JSON documents in collections
// (`collection/docId`), per tool, as the `db` of Claude's artifacts.
//
// This is the storage only: who may write, what `tool_data` and the bridge are and how a change reaches an open screen
// live elsewhere. What is in `agentToolDocs` is DATA — never instructions — for the agent and for the page.
import "server-only";

import { and, asc, eq, gt, or, sql, type SQL } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { AGENT_TOOL_DATA_MAX_BYTES, AGENT_TOOL_DOC_MAX_BYTES, AGENT_TOOL_DOCS_MAX } from "./limits";

export type AgentToolRow = typeof schema.agentTools.$inferSelect;

/** One document of a tool's database. A document that was just deleted is reported with `data: null` (a stored
 *  document is always an object, so `null` is unambiguous). */
export type AgentToolDoc = {
  collection: string;
  docId: string;
  data: unknown;
  updatedAt: Date;
  updatedBy: "agent" | "person";
};

/** One write of a batch: `set` replaces the document, `update` merges its top-level fields into it (and creates it when
 *  it isn't there), `delete` removes it (nothing happens when it isn't there). */
export type DataWrite = {
  op: "set" | "update" | "delete";
  collection: string;
  docId: string;
  data?: Record<string, unknown>;
};

export type WriteError = "too_many_docs" | "doc_too_big" | "tool_too_big" | "bad_write";

const tools = schema.agentTools;
const docs = schema.agentToolDocs;

/** A tool to keep. `id` is a fresh one for a new tool: when the agent already has a tool of that `slug` (publishing it
 *  again), the row keeps ITS id and labels and takes the new title, folder and version. */
export type AgentToolInput = Pick<AgentToolRow, "id" | "assistantId" | "personId" | "spaceProjectId" | "slug" | "title" | "folder" | "releaseSha" | "hostLabel"> & {
  phoneHostLabel?: string | null;
};

export async function upsertAgentTool(input: AgentToolInput): Promise<AgentToolRow> {
  const now = new Date();
  const [row] = await db
    .insert(tools)
    .values({ ...input, phoneHostLabel: input.phoneHostLabel ?? null, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [tools.assistantId, tools.slug],
      set: { title: input.title, folder: input.folder, releaseSha: input.releaseSha, updatedAt: now },
    })
    .returning();
  if (!row) throw new Error("agentTools: the upsert returned no row");
  return row;
}

/** The tools of an agent, in the order they were made. */
export async function agentToolsOf(assistantId: string): Promise<AgentToolRow[]> {
  return db.select().from(tools).where(eq(tools.assistantId, assistantId)).orderBy(asc(tools.createdAt), asc(tools.id));
}

export async function agentToolById(id: string): Promise<AgentToolRow | null> {
  const [row] = await db.select().from(tools).where(eq(tools.id, id)).limit(1);
  return row ?? null;
}

/** Who frames a tool on a label: the workspace (`hostLabel`) or the phone app (`phoneHostLabel`). */
export async function agentToolByLabel(label: string): Promise<(AgentToolRow & { servedTo: "workspace" | "phone" }) | null> {
  const [row] = await db
    .select()
    .from(tools)
    .where(or(eq(tools.hostLabel, label), eq(tools.phoneHostLabel, label)))
    .limit(1);
  return row ? { ...row, servedTo: row.hostLabel === label ? "workspace" : "phone" } : null;
}

/** Deletes the tool and, with it, its data for good. Whether it was there. */
export async function deleteAgentTool(id: string): Promise<boolean> {
  const rows = await db.delete(tools).where(eq(tools.id, id)).returning({ id: tools.id });
  return rows.length > 0;
}

/** The last time the agent read or wrote this tool's data (`tool_data`). */
export async function markAgentSeen(toolId: string, at: Date): Promise<void> {
  await db.update(tools).set({ agentSeenAt: at }).where(eq(tools.id, toolId));
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Rows as documents, by collection and then by id (code-unit order, so it doesn't depend on the database's collation). */
function asDocs(rows: (typeof docs.$inferSelect)[]): AgentToolDoc[] {
  return rows
    .map((r) => ({ collection: r.collection, docId: r.docId, data: r.data, updatedAt: r.updatedAt, updatedBy: r.updatedBy }))
    .sort((a, b) => byCodeUnit(a.collection, b.collection) || byCodeUnit(a.docId, b.docId));
}

/** A tool's documents, one collection or all, in order. */
export async function readDocs(toolId: string, collection?: string): Promise<AgentToolDoc[]> {
  return asDocs(
    await db
      .select()
      .from(docs)
      .where(collection === undefined ? eq(docs.toolId, toolId) : and(eq(docs.toolId, toolId), eq(docs.collection, collection))),
  );
}

/** The documents of a tool at these keys, as they are stored NOW, in the order of `readDocs`; a key with no document is
 *  left out. What a stream re-reads after a change: it tells the screens what is stored, not what a writer meant to
 *  store (two writers to one document can publish out of the order they committed in). */
export async function readDocsByKeys(toolId: string, keys: readonly { collection: string; docId: string }[]): Promise<AgentToolDoc[]> {
  if (keys.length === 0) return [];
  return asDocs(await db.select().from(docs).where(and(eq(docs.toolId, toolId), inKeys(keys))));
}

/** Distinct collections of a tool that the person wrote after `since` (or all the person's collections when `since` is
 *  null), in code-unit order. Reads only collection names so turn start never loads document bodies. */
export async function personChangedCollections(toolId: string, since: Date | null): Promise<string[]> {
  const rows = await db
    .selectDistinct({ collection: docs.collection })
    .from(docs)
    .where(
      since === null
        ? and(eq(docs.toolId, toolId), eq(docs.updatedBy, "person"))
        : and(eq(docs.toolId, toolId), eq(docs.updatedBy, "person"), gt(docs.updatedAt, since)),
    );
  return rows.map((r) => r.collection).sort(byCodeUnit);
}

// ---- writing ---------------------------------------------------------------------------------------------------------

/** A collection or a document id: text, not empty, not a path, nothing Postgres can't keep in a `text` column. */
const NAME_MAX = 200;
const NOT_A_NAME = /[\u0000-\u001f\u007f/]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= NAME_MAX && !NOT_A_NAME.test(value);
}

/** What `jsonb` refuses: a NUL, and a surrogate that has no partner (`JSON.stringify` writes those as `\uXXXX` escapes;
 *  a pair is written as the character). The escape counts only when its backslash isn't itself escaped. */
const NOT_STORABLE = /(?<!\\)(?:\\\\)*\\u(?:0000|[dD][89a-fA-F][0-9a-fA-F]{2})/;

/** The object as plain JSON data (what a read will give back), or null when it can't be stored. */
function plainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  if (typeof json !== "string" || NOT_STORABLE.test(json)) return null;
  return JSON.parse(json) as Record<string, unknown>;
}

type Planned = { op: "set" | "update" | "delete"; collection: string; docId: string; data: Record<string, unknown> | null };

/** The batch checked one write at a time, or null as soon as one is bad. */
function plan(writes: readonly DataWrite[]): Planned[] | null {
  if (!Array.isArray(writes)) return null;
  const planned: Planned[] = [];
  for (const w of writes as readonly Partial<DataWrite>[]) {
    if (!w || (w.op !== "set" && w.op !== "update" && w.op !== "delete")) return null;
    if (!isName(w.collection) || !isName(w.docId)) return null;
    if (w.op === "delete") {
      planned.push({ op: w.op, collection: w.collection, docId: w.docId, data: null });
      continue;
    }
    const data = plainObject(w.data);
    if (!data) return null;
    planned.push({ op: w.op, collection: w.collection, docId: w.docId, data });
  }
  return planned;
}

const keyOf = (collection: string, docId: string) => JSON.stringify([collection, docId]);
const sizeOf = (data: unknown) => Buffer.byteLength(JSON.stringify(data), "utf8");

/** `(collection, docId) in (…)` for these keys. */
function inKeys(keys: readonly { collection: string; docId: string }[]): SQL {
  return sql`(${docs.collection}, ${docs.docId}) in (${sql.join(
    keys.map((k) => sql`(${k.collection}, ${k.docId})`),
    sql`, `,
  )})`;
}

const failure = (error: WriteError) => ({ ok: false as const, error });

/** Writes a batch to a tool's database — ALL of it or none: in one transaction, under a lock on the tool's row so two
 *  batches can't both pass the caps. The caps are checked against the state the batch would leave: a document at most
 *  64 KB, at most 1,000 documents and 5 MB for the tool. Writes apply in order, so a later one sees an earlier one.
 *  `changes` has one entry per document the batch left different from how it found it (a deleted one with `data: null`).
 *  A write by the person marks `dataChangedAt` (what the agent is told changed); the agent's own writes don't. */
export async function writeDocs(
  toolId: string,
  writes: readonly DataWrite[],
  by: "agent" | "person",
): Promise<{ ok: true; changes: AgentToolDoc[] } | { ok: false; error: WriteError }> {
  const planned = plan(writes);
  if (!planned) return failure("bad_write");
  if (planned.length === 0) return { ok: true, changes: [] };

  return db.transaction(async (tx) => {
    const [tool] = await tx.select({ id: tools.id }).from(tools).where(eq(tools.id, toolId)).for("update");
    if (!tool) return failure("bad_write");

    const touched = new Map<string, { collection: string; docId: string }>();
    for (const w of planned) touched.set(keyOf(w.collection, w.docId), { collection: w.collection, docId: w.docId });

    const before = new Map<string, { data: Record<string, unknown>; bytes: number }>();
    for (const r of await tx
      .select({ collection: docs.collection, docId: docs.docId, data: docs.data, bytes: docs.bytes })
      .from(docs)
      .where(and(eq(docs.toolId, toolId), inKeys([...touched.values()])))) {
      before.set(keyOf(r.collection, r.docId), { data: r.data as Record<string, unknown>, bytes: r.bytes });
    }
    const [totals] = await tx
      .select({ n: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${docs.bytes}), 0)::double precision` })
      .from(docs)
      .where(eq(docs.toolId, toolId));

    // The batch in memory: what each touched document would be once every write has applied.
    const after = new Map<string, Record<string, unknown> | null>();
    for (const w of planned) {
      const key = keyOf(w.collection, w.docId);
      if (w.op === "delete") after.set(key, null);
      else if (w.op === "set") after.set(key, w.data);
      else after.set(key, { ...(after.has(key) ? after.get(key) : before.get(key)?.data), ...w.data });
    }

    let count = Number(totals?.n ?? 0);
    let total = Number(totals?.bytes ?? 0);
    const puts: { key: string; data: Record<string, unknown>; bytes: number }[] = [];
    const deletes: string[] = [];
    for (const [key, data] of after) {
      const was = before.get(key);
      if (data === null) {
        if (!was) continue;
        deletes.push(key);
        count -= 1;
        total -= was.bytes;
        continue;
      }
      const bytes = sizeOf(data);
      if (bytes > AGENT_TOOL_DOC_MAX_BYTES) return failure("doc_too_big");
      puts.push({ key, data, bytes });
      if (!was) count += 1;
      total += bytes - (was?.bytes ?? 0);
    }
    if (count > AGENT_TOOL_DOCS_MAX) return failure("too_many_docs");
    if (total > AGENT_TOOL_DATA_MAX_BYTES) return failure("tool_too_big");

    const now = new Date();
    if (puts.length > 0) {
      await tx
        .insert(docs)
        .values(puts.map((p) => ({ toolId, ...touched.get(p.key)!, data: p.data, bytes: p.bytes, updatedAt: now, updatedBy: by })))
        .onConflictDoUpdate({
          target: [docs.toolId, docs.collection, docs.docId],
          set: { data: sql`excluded."data"`, bytes: sql`excluded."bytes"`, updatedAt: sql`excluded."updatedAt"`, updatedBy: sql`excluded."updatedBy"` },
        });
    }
    if (deletes.length > 0) await tx.delete(docs).where(and(eq(docs.toolId, toolId), inKeys(deletes.map((k) => touched.get(k)!))));

    const changes: AgentToolDoc[] = [];
    for (const [key, data] of after) {
      if (data === null && !before.has(key)) continue; // never there, so nothing changed
      changes.push({ ...touched.get(key)!, data, updatedAt: now, updatedBy: by });
    }
    if (by === "person" && changes.length > 0) await tx.update(tools).set({ dataChangedAt: now }).where(eq(tools.id, toolId));
    return { ok: true as const, changes };
  });
}
