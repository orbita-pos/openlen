// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import {
  archiveItem,
  createItem,
  getOrCreateDefaultCollection,
  isSheetBacked,
  listItems,
  reorderItems,
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

  it("collapses two rows with the same (new) title into ONE item — no orphan duplicate", async () => {
    // Both rows share a title that does NOT pre-exist. Without the in-loop
    // byTitle update, both miss the map and create → two rows, one of which
    // orphans on the next sync (last-wins Map collapse).
    const result = await syncCollectionFromSheet(PID, collectionId, [
      { nombre: "Café", precio: "$40" },
      { nombre: "café", precio: "$45" }, // same title, case-insensitive
    ]);
    const items = await listItems(PID, collectionId);
    expect(items).toHaveLength(1);
    expect(items[0].priceDisplay).toBe("$45"); // second row won the update
    expect(result.archived).toBe(0);

    // A third sync must leave NO orphan: the single item updates cleanly, and
    // dropping it entirely archives exactly one (proving there was never a
    // hidden duplicate that survived unarchived).
    await syncCollectionFromSheet(PID, collectionId, [{ nombre: "Café", precio: "$50" }]);
    expect(await listItems(PID, collectionId)).toHaveLength(1);

    const drop = await syncCollectionFromSheet(PID, collectionId, [{ nombre: "Otra Cosa" }]);
    expect(drop.archived).toBe(1);
    const published = await listItems(PID, collectionId);
    expect(published.map((i) => i.title)).toEqual(["Otra Cosa"]);
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

  it("rejects a manual reorderItems (drag-reorder is a real mutation)", async () => {
    const a = await createItem(PID, collectionId, { title: "Reorder A" });
    const b = await createItem(PID, collectionId, { title: "Reorder B" });
    await setCollectionSource(PID, { sheet: FAKE_SHEET });
    await expect(reorderItems(PID, collectionId, [b.id, a.id])).rejects.toThrow(SheetBackedReadOnlyError);
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

describe("kill-switch reverts the read-only lock (OPENLEN_LIVE_DATA=0)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Sin la reversión, apagar la feature dejaría colecciones eternamente
  // solo-lectura (el motor no corre pero la guarda seguiría rechazando).
  it("isSheetBacked returns false and a manual edit is allowed again", async () => {
    await setCollectionSource(PID, { sheet: FAKE_SHEET });
    expect(await isSheetBacked(PID, collectionId)).toBe(true);

    vi.stubEnv("OPENLEN_LIVE_DATA", "0");
    expect(await isSheetBacked(PID, collectionId)).toBe(false);
    await expect(createItem(PID, collectionId, { title: "Manual again" })).resolves.toBeTruthy();
  });
});

describe("item-count cap (MAX_SYNC_ITEMS = 60)", () => {
  // Un Sheet con miles de filas no debe crear miles de items.
  // 60 inserts secuenciales contra Neon HTTP → timeout holgado (no es lentitud
  // del código, son 60 round-trips reales de red).
  it("processes at most 60 rows and ignores the rest", async () => {
    const rows = Array.from({ length: 70 }, (_, i) => ({ nombre: `Fila ${i}` }));
    const result = await syncCollectionFromSheet(PID, collectionId, rows);
    expect(result.upserted).toBe(60);
    expect(await listItems(PID, collectionId)).toHaveLength(60);
  }, 60000);
});
