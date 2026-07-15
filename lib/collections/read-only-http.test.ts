// @vitest-environment node
//
// Task 15: the collections item routes must turn SheetBackedReadOnlyError
// (thrown by createItem/updateItem/archiveItem/reorderItems in ./store) into
// a clean 409 { error: "sheet_backed_read_only" } instead of an unhandled
// 500. Exercises the real route handlers against the real DB — mirrors the
// DB setup pattern in ./sheet-sync.test.ts (seed user + project + default
// collection, then setCollectionSource to flip it sheet-backed).
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { getOrCreateDefaultCollection, setCollectionSource, createItem } from "./store";

const { PID, UID } = vi.hoisted(() => {
  const PID = "test-readonly-http-collections";
  const UID = PID + "-u";
  return { PID, UID };
});

// The routes call auth() first; mock it to a session for our seeded user so
// the real ownership check (owns(projectId, userId) against the DB) passes.
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: UID } })),
}));

import { POST as postItem } from "@/app/api/projects/[id]/collections/items/route";
import { PATCH as patchItem, DELETE as deleteItem } from "@/app/api/projects/[id]/collections/items/[itemId]/route";
import { PATCH as patchReorder } from "@/app/api/projects/[id]/collections/items/reorder/route";

const FAKE_SHEET = "https://docs.google.com/spreadsheets/d/readonlyhttp/edit#gid=0";

let collectionId: string;

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: UID, email: `${PID}@test.invalid`, name: "Test" })
    .onConflictDoNothing();
  await db
    .insert(schema.projects)
    .values({ id: PID, userId: UID, title: "Read-only HTTP Test", brief: "t", data: { html: "<html lang='es'></html>" } })
    .onConflictDoNothing();
  const col = await getOrCreateDefaultCollection(PID, { name: "Menu", preset: "menu" });
  collectionId = col.id;
});

beforeEach(async () => {
  await setCollectionSource(PID, null);
  await db.delete(schema.collectionItems).where(eq(schema.collectionItems.collectionId, collectionId));
});

function params<T extends Record<string, string> = Record<string, never>>(extra?: T) {
  return { params: Promise.resolve({ id: PID, ...(extra ?? ({} as T)) }) };
}

describe("collections item routes vs. a sheet-backed collection → 409, not 500", () => {
  it(
    "POST items → 409 sheet_backed_read_only",
    async () => {
      await setCollectionSource(PID, { sheet: FAKE_SHEET });
      const req = new Request(`http://localhost/api/projects/${PID}/collections/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Manual insert" }),
      });
      const res = await postItem(req, params());
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({ error: "sheet_backed_read_only" });
    },
    30000,
  );

  it(
    "PATCH items/[itemId] → 409 sheet_backed_read_only",
    async () => {
      const item = await createItem(PID, collectionId, { title: "Pre-existing" });
      await setCollectionSource(PID, { sheet: FAKE_SHEET });
      const req = new Request(`http://localhost/api/projects/${PID}/collections/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Edited" }),
      });
      const res = await patchItem(req, params({ itemId: item.id }));
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({ error: "sheet_backed_read_only" });
    },
    30000,
  );

  it(
    "DELETE items/[itemId] → 409 sheet_backed_read_only",
    async () => {
      const item = await createItem(PID, collectionId, { title: "Pre-existing 2" });
      await setCollectionSource(PID, { sheet: FAKE_SHEET });
      const req = new Request(`http://localhost/api/projects/${PID}/collections/items/${item.id}`, {
        method: "DELETE",
      });
      const res = await deleteItem(req, params({ itemId: item.id }));
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({ error: "sheet_backed_read_only" });
    },
    30000,
  );

  it(
    "PATCH items/reorder → 409 sheet_backed_read_only",
    async () => {
      const a = await createItem(PID, collectionId, { title: "Reorder A" });
      const b = await createItem(PID, collectionId, { title: "Reorder B" });
      await setCollectionSource(PID, { sheet: FAKE_SHEET });
      const req = new Request(`http://localhost/api/projects/${PID}/collections/items/reorder`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order: [b.id, a.id] }),
      });
      const res = await patchReorder(req, params());
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({ error: "sheet_backed_read_only" });
    },
    30000,
  );
});
