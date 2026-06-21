// Collections storage — a per-project list (collections) + its entries
// (collection_items). Mirrors lib/bookings/store.ts: per-project rows, callers
// verify ownership, single-statement updates (Neon HTTP forbids interactive
// transactions). v1 is ONE collection per project; the parent table already
// allows several for a future lift. Items are read at PUBLISH time and baked
// into static HTML — there is no per-visitor read path.

import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

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
    .returning();
  return rowToCollection(rows[0]);
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
