// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { StorageAdapter, UploadArgs } from "@/lib/storage/types";
import { storeStepScreenshots } from "./capture-storage";

// What Len saw, in the chat: a step's screenshots are stored like any upload and
// its card carries their URLs.
describe("storeStepScreenshots", () => {
  const jpeg = (text: string) => ({ mimeType: "image/jpeg", dataBase64: Buffer.from(text).toString("base64") });
  const fake = (upload?: StorageAdapter["upload"]) => {
    const uploads: UploadArgs[] = [];
    const storage: StorageAdapter = {
      upload:
        upload ??
        (async (a) => {
          uploads.push(a);
          return { url: `/uploads/${a.key}`, size: a.body.length };
        }),
      delete: async () => {},
    };
    return { storage, uploads };
  };

  it("stores each screenshot under the project as screenshot-<hash>, and returns the URLs in order", async () => {
    const f = fake();
    const urls = await storeStepScreenshots("p1", [jpeg("uno"), jpeg("dos")], { storage: f.storage });
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => /^\/uploads\/uploads\/p1\/screenshot-[0-9a-f]{32}\.jpg$/.test(u))).toBe(true);
    expect(f.uploads.map((u) => u.body.toString())).toEqual(["uno", "dos"]);
    expect(f.uploads[0]!.contentType).toBe("image/jpeg");
  });

  it("gives up after its deadline and returns none: a hung upload never holds the turn", async () => {
    const f = fake(() => new Promise(() => {}));
    expect(await storeStepScreenshots("p1", [jpeg("uno")], { storage: f.storage, timeoutMs: 20 })).toEqual([]);
  });

  it("returns none when an upload fails", async () => {
    const f = fake(async () => {
      throw new Error("storage down");
    });
    expect(await storeStepScreenshots("p1", [jpeg("uno")], { storage: f.storage })).toEqual([]);
  });
});
