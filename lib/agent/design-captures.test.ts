// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { StorageAdapter, UploadArgs } from "@/lib/storage/types";
import { storeDesignCaptures } from "./design-screenshots";

// Len 3.1: the design-mode captures are stored like any upload, so the next turn
// can attach the SAME bytes again (`transcript.designCaptures`).
describe("storeDesignCaptures", () => {
  const png = (text: string) => ({ mimeType: "image/png", dataBase64: Buffer.from(text).toString("base64") });
  const fake = (fail: (key: string) => boolean = () => false) => {
    const uploads: UploadArgs[] = [];
    const storage: StorageAdapter = {
      upload: async (a) => {
        if (fail(a.key)) throw new Error("storage down");
        uploads.push(a);
        return { url: `/uploads/${a.key}`, size: a.body.length };
      },
      delete: async () => {},
    };
    return { storage, uploads };
  };

  it("stores each capture's exact bytes under the project, by content hash, and returns the URLs in order", async () => {
    const f = fake();
    const urls = await storeDesignCaptures("p1", [png("uno"), png("dos")], f.storage);
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => /^\/uploads\/uploads\/p1\/design-[0-9a-f]{32}\.png$/.test(u))).toBe(true);
    expect(f.uploads.map((u) => u.body.toString())).toEqual(["uno", "dos"]);
    expect(f.uploads[0]!.contentType).toBe("image/png");
    // Same bytes, same key: storing twice does not make a second file.
    expect(await storeDesignCaptures("p1", [png("uno")], fake().storage)).toEqual([urls[0]]);
  });

  it("if one capture cannot be stored, none is recorded (the history stays as before)", async () => {
    const f = fake((key) => key.endsWith(".png") && f.uploads.length === 1);
    expect(await storeDesignCaptures("p1", [png("uno"), png("dos")], f.storage)).toEqual([]);
  });
});
