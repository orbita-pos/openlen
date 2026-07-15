// Collections storage — a per-project list (collections) + its entries
// (collection_items). Mirrors lib/bookings/store.ts: per-project rows, callers
// verify ownership, single-statement updates (Neon HTTP forbids interactive
// transactions). v1 is ONE collection per project; the parent table already
// allows several for a future lift. Items are read at PUBLISH time and baked
// into static HTML — there is no per-visitor read path.

import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { liveDataEnabled } from "@/lib/publish/kill-switches";

export interface CollectionRow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  preset: string;
  layout: "grid" | "list";
  status: "active" | "archived";
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ItemRow {
  id: string;
  projectId: string;
  collectionId: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  imageUrl: string | null;
  priceDisplay: string | null;
  badge: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  tags: string[];
  attrs: Record<string, string>;
  status: "published" | "archived";
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ItemInput {
  title: string;
  subtitle?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  priceDisplay?: string | null;
  badge?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  tags?: string[];
  attrs?: Record<string, string>;
  status?: "published" | "archived";
  sortOrder?: number;
}

/** "Datos vivos": a collection sourced from a Google Sheet. Lives in
 *  project.data.settings.collections.source (JSONB, no migration) rather than
 *  a column on the collection row — v1 is one collection per project, and
 *  that JSON settings blob already holds the module's other per-site config
 *  (CollectionsSettings.enabled). See lib/projects/types.ts. */
export interface CollectionSource {
  sheet: string;
}

/** A manual write (createItem/updateItem/archiveItem) hit a sheet-backed
 *  collection. The Sheet is the single source of truth for that collection;
 *  only syncCollectionFromSheet (lib/collections/sheet-sync.ts) may write its
 *  items — a manual edit here would be silently overwritten by the next sync. */
export class SheetBackedReadOnlyError extends Error {
  constructor() {
    super("this collection is sourced from a Google Sheet and is read-only in OpenLen — edit the Sheet instead");
    this.name = "SheetBackedReadOnlyError";
  }
}

/** Standard 409 for a manual mutation blocked by the read-only Sheet guard. */
export function sheetBackedReadOnlyResponse(): Response {
  return new Response(JSON.stringify({ error: "sheet_backed_read_only" }), {
    status: 409,
    headers: { "content-type": "application/json" },
  });
}

/** Corre una mutación de items atrapando SOLO el candado de solo-lectura →
 *  409; cualquier otro error se propaga intacto (mismo 500 que siempre). Las
 *  4 rutas de items comparten este envoltorio en vez de copiar el try/catch
 *  (Minor de la revisión Task 15, cerrado 2026-07-15). */
export async function guardSheetBacked<T>(fn: () => Promise<T>): Promise<T | Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SheetBackedReadOnlyError) return sheetBackedReadOnlyResponse();
    throw e;
  }
}

function rowToCollection(r: typeof schema.collections.$inferSelect): CollectionRow {
  return r;
}

function rowToItem(r: typeof schema.collectionItems.$inferSelect): ItemRow {
  return {
    ...r,
    tags: r.tags ?? [],
    attrs: (r.attrs ?? {}) as Record<string, string>,
  };
}

// ─── Collection (v1: one per project, lazily created) ────────────────────────

/** Read the project's collection without creating one (used by the publish bake). */
export async function getDefaultCollection(projectId: string): Promise<CollectionRow | null> {
  const rows = await db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.projectId, projectId), eq(schema.collections.status, "active")))
    .orderBy(asc(schema.collections.sortOrder), asc(schema.collections.createdAt))
    .limit(1);
  return rows[0] ? rowToCollection(rows[0]) : null;
}

/** Owner-side: get the collection, creating it on first access. */
export async function getOrCreateDefaultCollection(
  projectId: string,
  defaults?: { name?: string; preset?: string; layout?: "grid" | "list" },
): Promise<CollectionRow> {
  const existing = await getDefaultCollection(projectId);
  if (existing) return existing;
  const rows = await db
    .insert(schema.collections)
    .values({
      projectId,
      name: defaults?.name ?? "Products",
      preset: defaults?.preset ?? "products",
      layout: defaults?.layout ?? "grid",
    })
    .onConflictDoNothing()
    .returning();
  if (rows[0]) return rowToCollection(rows[0]);
  // Lost the insert race — the partial unique index rejected a 2nd active row;
  // converge on the winner.
  const after = await getDefaultCollection(projectId);
  if (after) return after;
  throw new Error("getOrCreateDefaultCollection: insert + refetch both empty");
}

export async function updateDefaultCollection(
  projectId: string,
  patch: { name?: string; description?: string | null; preset?: string; layout?: "grid" | "list" },
): Promise<CollectionRow | null> {
  const col = await getOrCreateDefaultCollection(projectId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["name", "description", "preset", "layout"] as const) {
    if (k in patch && patch[k] !== undefined) set[k] = patch[k];
  }
  const rows = await db
    .update(schema.collections)
    .set(set)
    .where(and(eq(schema.collections.id, col.id), eq(schema.collections.projectId, projectId)))
    .returning();
  return rows[0] ? rowToCollection(rows[0]) : null;
}

// ─── Sheet source (read-only guard) ──────────────────────────────────────────

/** Reads project.data.settings.collections.source. v1 is one collection per
 *  project, so this is project-scoped rather than joined through collectionId. */
export async function getCollectionSource(projectId: string): Promise<CollectionSource | null> {
  const rows = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return rows[0]?.data?.settings?.collections?.source ?? null;
}

/** Sets (or clears, with null) the project's collection source. The only
 *  caller in v1 is the future settings route that saves the owner-pasted
 *  Sheet URL, plus tests — sync itself never touches this. */
export async function setCollectionSource(
  projectId: string,
  source: CollectionSource | null,
): Promise<void> {
  const rows = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const data = rows[0]?.data;
  if (!data) throw new Error(`setCollectionSource: project ${projectId} not found`);
  const collectionsSettings = { ...(data.settings?.collections ?? {}) };
  if (source) collectionsSettings.source = source;
  else delete collectionsSettings.source;
  await db
    .update(schema.projects)
    .set({ data: { ...data, settings: { ...(data.settings ?? {}), collections: collectionsSettings } } })
    .where(eq(schema.projects.id, projectId));
}

/** True when the project's collection is sheet-backed — createItem/updateItem/
 *  archiveItem reject with SheetBackedReadOnlyError in that case.
 *  `collectionId` is accepted for call-site symmetry with the item functions
 *  and future multi-collection support; unused while v1 stays single-collection. */
export async function isSheetBacked(projectId: string, _collectionId?: string): Promise<boolean> {
  // El kill-switch REVIERTE a comportamiento normal (hallazgo de la revisión
  // final, 2026-07-14): con OPENLEN_LIVE_DATA=0 el cron deja de sincronizar,
  // así que si además dejáramos la colección de solo-lectura el dueño quedaría
  // encerrado sin arreglo automático. Apagar datos vivos ⇒ la colección vuelve
  // a ser editable a mano.
  if (!liveDataEnabled()) return false;
  const source = await getCollectionSource(projectId);
  return Boolean(source?.sheet);
}

// ─── Items (owner CRUD + publish read) ───────────────────────────────────────

export async function listItems(
  projectId: string,
  collectionId: string,
  opts?: { includeArchived?: boolean },
): Promise<ItemRow[]> {
  const filters = [
    eq(schema.collectionItems.projectId, projectId),
    eq(schema.collectionItems.collectionId, collectionId),
  ];
  if (!opts?.includeArchived) {
    filters.push(eq(schema.collectionItems.status, "published"));
  }
  const rows = await db
    .select()
    .from(schema.collectionItems)
    .where(and(...filters))
    .orderBy(asc(schema.collectionItems.sortOrder), asc(schema.collectionItems.createdAt));
  return rows.map(rowToItem);
}

/** The published items of a project's default collection — read at publish time
 *  to bake the static grid. Returns [] when there's no collection/items. */
export async function listPublishedItems(projectId: string): Promise<ItemRow[]> {
  const col = await getDefaultCollection(projectId);
  if (!col) return [];
  return listItems(projectId, col.id, { includeArchived: false });
}

export async function getItem(projectId: string, itemId: string): Promise<ItemRow | null> {
  const rows = await db
    .select()
    .from(schema.collectionItems)
    .where(and(eq(schema.collectionItems.id, itemId), eq(schema.collectionItems.projectId, projectId)))
    .limit(1);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function createItem(
  projectId: string,
  collectionId: string,
  input: ItemInput,
): Promise<ItemRow> {
  if (await isSheetBacked(projectId, collectionId)) throw new SheetBackedReadOnlyError();
  return createItemUnguarded(projectId, collectionId, input);
}

/** The actual write, with NO read-only check — reserved for
 *  syncCollectionFromSheet (lib/collections/sheet-sync.ts), the one writer
 *  allowed to touch a sheet-backed collection's items. Do not call this from
 *  owner-facing routes; call createItem, which guards it. */
export async function createItemUnguarded(
  projectId: string,
  collectionId: string,
  input: ItemInput,
): Promise<ItemRow> {
  const rows = await db
    .insert(schema.collectionItems)
    .values({
      projectId,
      collectionId,
      title: input.title,
      subtitle: input.subtitle ?? null,
      description: input.description ?? null,
      imageUrl: input.imageUrl ?? null,
      priceDisplay: input.priceDisplay ?? null,
      badge: input.badge ?? null,
      ctaLabel: input.ctaLabel ?? null,
      ctaUrl: input.ctaUrl ?? null,
      tags: input.tags ?? [],
      attrs: input.attrs ?? {},
      status: input.status ?? "published",
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return rowToItem(rows[0]);
}

export async function updateItem(
  projectId: string,
  itemId: string,
  patch: Partial<ItemInput>,
): Promise<ItemRow | null> {
  if (await isSheetBacked(projectId)) throw new SheetBackedReadOnlyError();
  return updateItemUnguarded(projectId, itemId, patch);
}

/** The actual write, with NO read-only check — see createItemUnguarded. */
export async function updateItemUnguarded(
  projectId: string,
  itemId: string,
  patch: Partial<ItemInput>,
): Promise<ItemRow | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of [
    "title",
    "subtitle",
    "description",
    "imageUrl",
    "priceDisplay",
    "badge",
    "ctaLabel",
    "ctaUrl",
    "tags",
    "attrs",
    "status",
    "sortOrder",
  ] as const) {
    if (k in patch && patch[k] !== undefined) set[k] = patch[k];
  }
  const rows = await db
    .update(schema.collectionItems)
    .set(set)
    .where(and(eq(schema.collectionItems.id, itemId), eq(schema.collectionItems.projectId, projectId)))
    .returning();
  return rows[0] ? rowToItem(rows[0]) : null;
}

/** Archive (soft-delete) — drops it from the published grid, keeps the row. */
export async function archiveItem(projectId: string, itemId: string): Promise<boolean> {
  if (await isSheetBacked(projectId)) throw new SheetBackedReadOnlyError();
  return archiveItemUnguarded(projectId, itemId);
}

/** The actual write, with NO read-only check — see createItemUnguarded. */
export async function archiveItemUnguarded(projectId: string, itemId: string): Promise<boolean> {
  const rows = await db
    .update(schema.collectionItems)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(schema.collectionItems.id, itemId), eq(schema.collectionItems.projectId, projectId)))
    .returning({ id: schema.collectionItems.id });
  return rows.length > 0;
}

/** Apply a manual drag order — sortOrder = index. Project+collection scoped, so
 *  a foreign id updates nothing. One statement per row (Neon HTTP has no txn). */
export async function reorderItems(
  projectId: string,
  collectionId: string,
  orderedIds: string[],
): Promise<void> {
  // A drag-reorder is a real mutation reachable from an owner route — a
  // sheet-backed collection is READ-ONLY, and sync never re-writes sortOrder,
  // so a manual reorder would persist. Guard it like create/update/archive.
  if (await isSheetBacked(projectId, collectionId)) throw new SheetBackedReadOnlyError();
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(schema.collectionItems)
      .set({ sortOrder: i, updatedAt: new Date() })
      .where(
        and(
          eq(schema.collectionItems.id, orderedIds[i]),
          eq(schema.collectionItems.projectId, projectId),
          eq(schema.collectionItems.collectionId, collectionId),
        ),
      );
  }
}
