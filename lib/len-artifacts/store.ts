// WHERE AN AGENT'S TOOLS LIVE (spec local 2026-11-22-herramienta-dentro-del-agente, §1–§3): Postgres is the truth. A tool is
// one row per agent and folder (`slug`), whose private labels are fixed for its life — so publishing it again keeps the
// address the screens already framed — and the small database it shares with its agent is JSON documents in collections
// (`collection/docId`), per tool, as the `db` of Claude's artifacts.
//
// This is the storage only: who may write, what `artifact_data` and the bridge are and how a change reaches an open screen
// live elsewhere. What is in `lenArtifactDocs` is DATA — never instructions — for the agent and for the page.
import "server-only";

import { and, asc, eq, gt, isNull, or, sql, type SQL } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { LEN_ARTIFACT_DATA_MAX_BYTES, LEN_ARTIFACT_DOC_MAX_BYTES, LEN_ARTIFACT_DOCS_MAX } from "./limits";

export type LenArtifactRow = typeof schema.lenArtifacts.$inferSelect;

/** One document of a tool's database. A document that was just deleted is reported with `data: null` (a stored
 *  document is always an object, so `null` is unambiguous). */
export type LenArtifactDoc = {
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

const tools = schema.lenArtifacts;
const docs = schema.lenArtifactDocs;

/** Who made an artifact: Len, or one of the person's agents. */
export type LenArtifactMaker = "len" | { readonly assistantId: string };

/** Which artifacts: a maker's in one project, or an agent's in every project it made them in. */
export type LenArtifactScope =
  | { readonly projectId: string; readonly maker: LenArtifactMaker }
  | { readonly projectId?: undefined; readonly maker: { readonly assistantId: string } };

const assistantIdOf = (maker: LenArtifactMaker): string | null => (maker === "len" ? null : maker.assistantId);

/** `assistantId` is this maker's: `is null` for Len (an `=` with null is never true). */
const madeBy = (assistantId: string | null): SQL => (assistantId === null ? isNull(tools.assistantId) : eq(tools.assistantId, assistantId));

/** An artifact to keep. `id` is a fresh one for a new artifact: when its project already has one in that `folder`
 *  (publishing it again), the row keeps ITS id and labels and takes the new title and version. */
export type LenArtifactInput = Pick<LenArtifactRow, "id" | "projectId" | "personId" | "assistantId" | "slug" | "title" | "folder" | "releaseSha" | "hostLabel"> & {
  phoneHostLabel?: string | null;
};

/** Thrown by `upsertLenArtifact` when a NEW artifact would pass `maxPerMaker`: the cap held under a race. */
export class LenArtifactCapError extends Error {
  constructor(readonly max: number) {
    super(`lenArtifacts: a maker has at most ${max} artifacts in a project`);
    this.name = "LenArtifactCapError";
  }
}

/** Thrown by `upsertLenArtifact` when the folder already holds an artifact ANOTHER maker made: only its maker publishes
 *  it again, and nothing is written. */
export class LenArtifactMakerError extends Error {
  constructor() {
    super("lenArtifacts: that folder holds an artifact someone else made");
    this.name = "LenArtifactMakerError";
  }
}

/** Keeps the artifact. With `maxPerMaker`, one its maker doesn't have yet in that project is refused
 *  (`LenArtifactCapError`) once it has that many: the project's row is locked first, so two publishes at once are counted
 *  one after the other. Another maker's artifact in that folder is never written over (`LenArtifactMakerError`).
 *  When a maker already has an artifact with the same `(projectId, maker, slug)` — e.g. after an assistant is renamed and
 *  publishes from `/.artifacts/<new slug>/<slug>/` — the row updates in place, preserving its id, labels and documents. */
export async function upsertLenArtifact(input: LenArtifactInput, opts: { readonly maxPerMaker?: number } = {}): Promise<LenArtifactRow> {
  const max = opts.maxPerMaker;
  return db.transaction(async (tx) => {
    await tx.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, input.projectId)).for("update");
    const [atFolder] = await tx
      .select({ id: tools.id, assistantId: tools.assistantId })
      .from(tools)
      .where(and(eq(tools.projectId, input.projectId), eq(tools.folder, input.folder)));
    if (atFolder && atFolder.assistantId !== input.assistantId) throw new LenArtifactMakerError();
    const [sameMaker] = atFolder
      ? [atFolder]
      : await tx
          .select({ id: tools.id, assistantId: tools.assistantId })
          .from(tools)
          .where(and(eq(tools.projectId, input.projectId), madeBy(input.assistantId), eq(tools.slug, input.slug)))
          .limit(1);
    const now = new Date();
    if (sameMaker) {
      const [updated] = await tx
        .update(tools)
        .set({ folder: input.folder, title: input.title, slug: input.slug, releaseSha: input.releaseSha, updatedAt: now })
        .where(eq(tools.id, sameMaker.id))
        .returning();
      return updated!;
    }
    if (max !== undefined) {
      const [mine] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(tools)
        .where(and(eq(tools.projectId, input.projectId), madeBy(input.assistantId)));
      if (Number(mine?.n ?? 0) >= max) throw new LenArtifactCapError(max);
    }
    const [inserted] = await tx
      .insert(tools)
      .values({ ...input, phoneHostLabel: input.phoneHostLabel ?? null, createdAt: now, updatedAt: now })
      .returning();
    return inserted!;
  });
}

/** The artifacts in `scope`, in the order they were made. */
export async function lenArtifactsOf(scope: LenArtifactScope): Promise<LenArtifactRow[]> {
  const maker = madeBy(assistantIdOf(scope.maker));
  return db
    .select()
    .from(tools)
    .where(scope.projectId === undefined ? maker : and(eq(tools.projectId, scope.projectId), maker))
    .orderBy(asc(tools.createdAt), asc(tools.id));
}

/** The artifact in that folder of the project, whoever made it, or null. */
export async function lenArtifactByFolder(projectId: string, folder: string): Promise<LenArtifactRow | null> {
  const [row] = await db
    .select()
    .from(tools)
    .where(and(eq(tools.projectId, projectId), eq(tools.folder, folder)))
    .limit(1);
  return row ?? null;
}

export async function lenArtifactById(id: string): Promise<LenArtifactRow | null> {
  const [row] = await db.select().from(tools).where(eq(tools.id, id)).limit(1);
  return row ?? null;
}

/** Who frames an artifact on a label: the workspace (`hostLabel`) or the phone app (`phoneHostLabel`). */
export async function lenArtifactByLabel(label: string): Promise<(LenArtifactRow & { servedTo: "workspace" | "phone" }) | null> {
  const [row] = await db
    .select()
    .from(tools)
    .where(or(eq(tools.hostLabel, label), eq(tools.phoneHostLabel, label)))
    .limit(1);
  return row ? { ...row, servedTo: row.hostLabel === label ? "workspace" : "phone" } : null;
}

/** Deletes the artifact and, with it, its data for good. Whether it was there. */
export async function deleteLenArtifact(id: string): Promise<boolean> {
  const rows = await db.delete(tools).where(eq(tools.id, id)).returning({ id: tools.id });
  return rows.length > 0;
}

/** The last time its maker read or wrote this artifact's data. */
export async function markMakerSeen(toolId: string, at: Date): Promise<void> {
  await db.update(tools).set({ makerSeenAt: at }).where(eq(tools.id, toolId));
}

/** The owner of a project — the only person whose artifacts it has — or null when there is no such project. */
export async function projectOwnerOf(projectId: string): Promise<string | null> {
  const [row] = await db.select({ userId: schema.projects.userId }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  return row?.userId ?? null;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Rows as documents, by collection and then by id (code-unit order, so it doesn't depend on the database's collation). */
function asDocs(rows: (typeof docs.$inferSelect)[]): LenArtifactDoc[] {
  return rows
    .map((r) => ({ collection: r.collection, docId: r.docId, data: r.data, updatedAt: r.updatedAt, updatedBy: r.updatedBy }))
    .sort((a, b) => byCodeUnit(a.collection, b.collection) || byCodeUnit(a.docId, b.docId));
}

/** A tool's documents, one collection or all, in order. */
export async function readDocs(toolId: string, collection?: string): Promise<LenArtifactDoc[]> {
  return asDocs(
    await db
      .select()
      .from(docs)
      .where(collection === undefined ? eq(docs.toolId, toolId) : and(eq(docs.toolId, toolId), eq(docs.collection, collection))),
  );
}

/** One document of a tool by its key (the table's primary key), or null: a `get` never loads the whole collection. */
export async function readDoc(toolId: string, collection: string, docId: string): Promise<LenArtifactDoc | null> {
  const rows = await db
    .select()
    .from(docs)
    .where(and(eq(docs.toolId, toolId), eq(docs.collection, collection), eq(docs.docId, docId)))
    .limit(1);
  return asDocs(rows)[0] ?? null;
}

/** The documents of a tool at these keys, as they are stored NOW, in the order of `readDocs`; a key with no document is
 *  left out. What a stream re-reads after a change: it tells the screens what is stored, not what a writer meant to
 *  store (two writers to one document can publish out of the order they committed in). */
export async function readDocsByKeys(toolId: string, keys: readonly { collection: string; docId: string }[]): Promise<LenArtifactDoc[]> {
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
  // What goes back in must still be an object: a Date, or anything with a `toJSON` that returns a string or a list, isn't.
  const parsed: unknown = JSON.parse(json);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
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
): Promise<{ ok: true; changes: LenArtifactDoc[] } | { ok: false; error: WriteError }> {
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
      if (bytes > LEN_ARTIFACT_DOC_MAX_BYTES) return failure("doc_too_big");
      puts.push({ key, data, bytes });
      if (!was) count += 1;
      total += bytes - (was?.bytes ?? 0);
    }
    if (count > LEN_ARTIFACT_DOCS_MAX) return failure("too_many_docs");
    if (total > LEN_ARTIFACT_DATA_MAX_BYTES) return failure("tool_too_big");

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

    const changes: LenArtifactDoc[] = [];
    for (const [key, data] of after) {
      if (data === null && !before.has(key)) continue; // never there, so nothing changed
      changes.push({ ...touched.get(key)!, data, updatedAt: now, updatedBy: by });
    }
    if (by === "person" && changes.length > 0) await tx.update(tools).set({ dataChangedAt: now }).where(eq(tools.id, toolId));
    return { ok: true as const, changes };
  });
}
