// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import {
  archiveItem,
  createItem,
  getOrCreateDefaultCollection,
  isSheetBacked,
  listItems,
  setCollectionSource,
  SheetBackedReadOnlyError,
  updateItem,
} from "./store";
import { syncCollectionFromSheet } from "./sheet-sync";

// Deterministic ids so re-runs converge instead of piling up rows (mirrors
// lib/chat/identity-bridge.test.ts).
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

const PID = "test-sheet-sync-" + Math.abs(hashStr("sheet-sync-collections")).toString(36);
const UID = PID + "-u";
const FAKE_SHEET = "https://docs.google.com/spreadsheets/d/abc123/edit#gid=0";

let collectionId: string;

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: UID, email: `${PID}@test.invalid`, name: "Test" })
    .onConflictDoNothing();
  await db
    .insert(schema.projects)
    .values({ id: PID, userId: UID, title: "Sheet Sync Test", brief: "t", data: { html: "<html lang='es'></html>" } })
    .onConflictDoNothing();
  const col = await getOrCreateDefaultCollection(PID, { name: "Menu", preset: "menu" });
  collectionId = col.id;
});

beforeEach(async () => {
  await db.delete(schema.collectionItems).where(eq(schema.collectionItems.collectionId, collectionId));
  await setCollectionSource(PID, null);
});

describe("syncCollectionFromSheet", () => {
  it("creates new items from rows", async () => {
    const result = await syncCollectionFromSheet(PID, collectionId, [
      { nombre: "Espresso", precio: "$45" },
      { nombre: "Latte", precio: "$55" },
    ]);
    expect(result).toEqual({ upserted: 2, archived: 0 });
    const items = await listItems(PID, collectionId);
    expect(items.map((i) => i.title).sort()).toEqual(["Espresso", "Latte"]);
    expect(items.find((i) => i.title === "Espresso")?.priceDisplay).toBe("$45");
  });

  it("updates an existing item matched by title", async () => {
    await syncCollectionFromSheet(PID, collectionId, [{ nombre: "Espresso", precio: "$45" }]);
    const result = await syncCollectionFromSheet(PID, collectionId, [{ nombre: "Espresso", precio: "$50" }]);
    expect(result).toEqual({ upserted: 1, archived: 0 });
    const items = await listItems(PID, collectionId);
    expect(items).toHaveLength(1);
    expect(items[0].priceDisplay).toBe("$50");
  });

  it("archives an item whose title is absent from the current rows", async () => {
    await syncCollectionFromSheet(PID, collectionId, [
      { nombre: "Espresso", precio: "$45" },
      { nombre: "Latte", precio: "$55" },
    ]);
    const result = await syncCollectionFromSheet(PID, collectionId, [{ nombre: "Espresso", precio: "$45" }]);
    expect(result).toEqual({ upserted: 1, archived: 1 });

    const published = await listItems(PID, collectionId);
    expect(published.map((i) => i.title)).toEqual(["Espresso"]);

    const all = await listItems(PID, collectionId, { includeArchived: true });
    expect(all.find((i) => i.title === "Latte")?.status).toBe("archived");
  });

  it("skips a row with no title-mapped column", async () => {
    const result = await syncCollectionFromSheet(PID, collectionId, [{ precio: "$99" }]);
    expect(result).toEqual({ upserted: 0, archived: 0 });
    expect(await listItems(PID, collectionId)).toHaveLength(0);
  });

  it("maps aliased headers case-insensitively (Precio -> priceDisplay, Foto -> imageUrl, Descripcion -> subtitle)", async () => {
    await syncCollectionFromSheet(PID, collectionId, [
      { Nombre: "Taco", Precio: "$20", Foto: "https://img.example.com/taco.jpg", Descripcion: "Al pastor" },
    ]);
    const items = await listItems(PID, collectionId);
    expect(items[0]).toMatchObject({
      title: "Taco",
      priceDisplay: "$20",
      imageUrl: "https://img.example.com/taco.jpg",
      subtitle: "Al pastor",
    });
  });

  it("ignores unmapped columns and omits blank cells instead of writing empty strings", async () => {
    await syncCollectionFromSheet(PID, collectionId, [
      { nombre: "Agua", precio: "", categoria_interna: "bebidas" },
    ]);
    const items = await listItems(PID, collectionId);
    expect(items[0].title).toBe("Agua");
    expect(items[0].priceDisplay).toBeNull();
  });
});

describe("read-only guard on a sheet-backed collection", () => {
  it("rejects a manual createItem", async () => {
    await setCollectionSource(PID, { sheet: FAKE_SHEET });
    await expect(createItem(PID, collectionId, { title: "Manual" })).rejects.toThrow(SheetBackedReadOnlyError);
  });

  it("rejects a manual updateItem", async () => {
    const item = await createItem(PID, collectionId, { title: "Pre-existing" });
    await setCollectionSource(PID, { sheet: FAKE_SHEET });
    await expect(updateItem(PID, item.id, { title: "Edited" })).rejects.toThrow(SheetBackedReadOnlyError);
  });

  it("rejects a manual archiveItem", async () => {
    const item = await createItem(PID, collectionId, { title: "Pre-existing 2" });
    await setCollectionSource(PID, { sheet: FAKE_SHEET });
    await expect(archiveItem(PID, item.id)).rejects.toThrow(SheetBackedReadOnlyError);
  });

  it("isSheetBacked reflects the source field", async () => {
    expect(await isSheetBacked(PID, collectionId)).toBe(false);
    await setCollectionSource(PID, { sheet: FAKE_SHEET });
    expect(await isSheetBacked(PID, collectionId)).toBe(true);
  });

  it("syncCollectionFromSheet still writes on a sheet-backed collection (bypasses the guard)", async () => {
    await setCollectionSource(PID, { sheet: FAKE_SHEET });
    const result = await syncCollectionFromSheet(PID, collectionId, [{ nombre: "Synced Item" }]);
    expect(result.upserted).toBe(1);
    const items = await listItems(PID, collectionId);
    expect(items.some((i) => i.title === "Synced Item")).toBe(true);
  });
});
