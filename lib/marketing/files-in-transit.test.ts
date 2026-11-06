// @vitest-environment jsdom
// The home's files cross to /new (Jesús, 06/11: «sólo debe haber un input y debe ser el que tenga todo»): a one-use
// pass in this tab's `sessionStorage` says which ones; the bytes wait in a store (IndexedDB in the browser, a Map
// here). The rules are the first message's: one use, this tab, 30 minutes.
import { afterEach, describe, expect, it } from "vitest";

import { FIRST_MESSAGE_TTL_MS } from "./first-message-in-transit";
import { filesInTransit, type FilesRecord, type FilesStore } from "./files-in-transit";

function memoryStore() {
  const map = new Map<string, FilesRecord>();
  const store: FilesStore = {
    put: async (id, record) => void map.set(id, record),
    get: async (id) => map.get(id),
    delete: async (id) => void map.delete(id),
    prune: async (before) => {
      for (const [id, r] of map) if (r.at < before) map.delete(id);
    },
  };
  return { map, store };
}

const pdf = () => new File(["%PDF-1.4"], "menu.pdf", { type: "application/pdf" });
const video = () => new File(["mp4"], "tour.mp4", { type: "video/mp4" });

afterEach(() => sessionStorage.clear());

describe("the home's files in transit", () => {
  it("🔴 what the home left, /new takes once — and then it is gone, from the tab and from the store", async () => {
    const { map, store } = memoryStore();
    const t = filesInTransit(() => store);
    const files = [pdf(), video()];
    expect(await t.leave(files, 1_000)).toBe(true);
    const taken = await t.take(2_000);
    expect(taken.map((f) => f.name)).toEqual(["menu.pdf", "tour.mp4"]);
    expect(taken[0]).toBeInstanceOf(File);
    expect(map.size).toBe(0);
    expect(await t.take(3_000)).toEqual([]);
  });

  it("🔴 nothing was left in this tab: nothing is taken, even if the store holds another tab's", async () => {
    const { map, store } = memoryStore();
    map.set("other-tab", { at: 1_000, files: [pdf()] });
    expect(await filesInTransit(() => store).take(2_000)).toEqual([]);
    expect(map.has("other-tab")).toBe(true);
  });

  it("🔴 past 30 minutes the pass is stale: nothing is taken and the bytes are dropped", async () => {
    const { map, store } = memoryStore();
    const t = filesInTransit(() => store);
    await t.leave([pdf()], 1_000);
    expect(await t.take(1_000 + FIRST_MESSAGE_TTL_MS + 1)).toEqual([]);
    expect(map.size).toBe(0);
  });

  it("closing the sign-in dialog drops them; leaving none drops what an earlier send left", async () => {
    const { map, store } = memoryStore();
    const t = filesInTransit(() => store);
    await t.leave([pdf()], 1_000);
    await t.drop();
    expect(map.size).toBe(0);
    expect(await t.take(2_000)).toEqual([]);

    await t.leave([pdf()], 1_000);
    expect(await t.leave([], 2_000)).toBe(true);
    expect(map.size).toBe(0);
    expect(await t.take(3_000)).toEqual([]);
  });

  it("a second send replaces the first: only the last files cross", async () => {
    const { map, store } = memoryStore();
    const t = filesInTransit(() => store);
    await t.leave([pdf()], 1_000);
    await t.leave([video()], 2_000);
    expect(map.size).toBe(1);
    expect((await t.take(3_000)).map((f) => f.name)).toEqual(["tour.mp4"]);
  });

  it("leaving prunes what closed tabs left past the 30 minutes", async () => {
    const { map, store } = memoryStore();
    map.set("lost", { at: 0, files: [pdf()] });
    map.set("recent", { at: FIRST_MESSAGE_TTL_MS, files: [pdf()] });
    await filesInTransit(() => store).leave([video()], FIRST_MESSAGE_TTL_MS + 1_000);
    expect(map.has("lost")).toBe(false);
    expect(map.has("recent")).toBe(true);
  });

  it("🔴 without a store (no IndexedDB, private window) the files stay behind and nothing throws", async () => {
    const t = filesInTransit(() => null);
    expect(await t.leave([pdf()], 1_000)).toBe(false);
    expect(await t.take(2_000)).toEqual([]);
    await expect(t.drop()).resolves.toBeUndefined();
  });

  it("🔴 /new takes them when it sends the first message, and uploads them with it", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const page = readFileSync(join(process.cwd(), "app/[locale]/new/page.tsx"), "utf8");
    const send = page.slice(page.indexOf("const handleHeroSend"), page.indexOf("useFirstMessageOnArrival({"));
    // /new has no box of its own since 06/11 (Jesús: «¿para qué tener 2 inputs?»): what the home left is all there is.
    expect(send).toMatch(/const pdfs = await takeFilesInTransit\(\)/);
    expect(send).toMatch(/pdfs\.map\(\(pdf\) => uploadAttachment\(pdf, loadedProjectId\)\)/);
  });

  it("with sessionStorage blocked, nothing throws either", async () => {
    const { store } = memoryStore();
    const t = filesInTransit(() => store, () => {
      throw new Error("SecurityError");
    });
    expect(await t.leave([pdf()], 1_000)).toBe(false);
    expect(await t.take(2_000)).toEqual([]);
  });
});
