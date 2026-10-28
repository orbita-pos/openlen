// `image_search` (spec local 2026-10-27-chat-drop-and-images, Part B): Len searches Wikimedia
// Commons, each photo is copied to our storage with its credit beside it (so the chat and a page
// load it from us), and Len SEES them small before choosing — Commons' ranking is weak.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import axolotl from "./__fixtures__/commons-axolotl.json";
import { IMAGE_SEARCH, IMAGE_SEARCHES_PER_TURN, toolImageSearch, type CommonsDeps } from "./image-search";
import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const session = () => ({ projectId: "p1", userId: "u1" }) as unknown as AgentSession;

function fakeCommons(over: Partial<CommonsDeps> = {}) {
  const stored: { key: string; contentType: string; text?: string }[] = [];
  const deps: CommonsDeps = {
    search: vi.fn(async () => axolotl),
    fetchImage: vi.fn(async (url: string) => ({ bytes: new Uint8Array([1, 2, 3]), mime: url.endsWith(".webp") ? "image/webp" : "image/jpeg" })),
    store: vi.fn(async (key: string, bytes: Uint8Array, contentType: string) => {
      stored.push({ key, contentType, ...(contentType === "application/json" ? { text: new TextDecoder().decode(bytes) } : {}) });
      return { url: `https://uploads.openlen.com/${key}` };
    }),
    shrink: vi.fn(async () => ({ mimeType: "image/jpeg", dataBase64: "AAA" })),
    ...over,
  };
  return { deps: { commons: deps } as unknown as AgentDeps, stored, commons: deps };
}

const text = (o: { response: Record<string, unknown> }) => String(o.response[CLAVE_TOOL_RESULT]);

describe("image_search", () => {
  it("copies each photo and its credit to commons/, returns them in order with small images", async () => {
    const { deps, stored } = fakeCommons();
    const out = await toolImageSearch(session(), deps, { query: "axolotl" });
    const k1 = `commons/${sha1("File:Ambystoma mexicanum 1.jpg")}-960`;
    expect(stored.map((s) => s.key)).toEqual(expect.arrayContaining([`${k1}.jpg`, `${k1}.json`]));
    expect(JSON.parse(stored.find((s) => s.key === `${k1}.json`)!.text!)).toEqual({
      title: "Ambystoma mexicanum 1",
      author: "Stan Shebs",
      license: "CC BY-SA 3.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Ambystoma_mexicanum_1.jpg",
    });
    expect(out.images).toHaveLength(2);
    const t = text(out);
    expect(t).toContain(`1. ![Ambystoma mexicanum 1](https://uploads.openlen.com/${k1}.jpg)`);
    expect(t).toContain("Credit: Photo: Stan Shebs, CC BY-SA 3.0, via Wikimedia Commons");
    expect(t).toContain("Source: https://commons.wikimedia.org/wiki/File:Ambystoma_mexicanum_1.jpg");
    expect(t.indexOf("Ambystoma")).toBeLessThan(t.indexOf("Axolotl en el acuario"));
    expect(out.action).toMatchObject({ tool: IMAGE_SEARCH, ok: true, summary: "axolotl" });
  });

  it("a photo that fails to download is dropped, the rest stay", async () => {
    const { deps } = fakeCommons({ fetchImage: vi.fn(async (url: string) => (url.includes("Ambystoma") ? null : { bytes: new Uint8Array([1]), mime: "image/webp" })) });
    const out = await toolImageSearch(session(), deps, { query: "axolotl" });
    expect(out.images).toHaveLength(1);
    expect(text(out)).not.toContain("Ambystoma");
    expect(text(out)).toContain("1. ![Axolotl en el acuario]");
  });

  it("no results: says so, with no images", async () => {
    const { deps, stored } = fakeCommons({ search: vi.fn(async () => ({ batchcomplete: true })) });
    const out = await toolImageSearch(session(), deps, { query: "zzqx" });
    expect(out.images ?? []).toHaveLength(0);
    expect(text(out)).toMatch(/No photos found on Wikimedia Commons for "zzqx"/);
    expect(stored).toEqual([]);
  });

  it("Wikimedia down: an error Len can read, nothing stored", async () => {
    const { deps, stored } = fakeCommons({ search: vi.fn(async () => Promise.reject(new Error("HTTP 503"))) });
    const out = await toolImageSearch(session(), deps, { query: "axolotl" });
    expect(out.response.ok).toBe(false);
    expect(text(out)).toMatch(/^Error: Wikimedia Commons didn't answer/);
    expect(stored).toEqual([]);
  });

  it("Wikimedia slow: gives up at 15 s instead of hanging", async () => {
    vi.useFakeTimers();
    try {
      const { deps } = fakeCommons({
        search: vi.fn((_url: string, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))),
      });
      const pending = toolImageSearch(session(), deps, { query: "axolotl" });
      await vi.advanceTimersByTimeAsync(15_000);
      const out = await pending;
      expect(out.response.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it(`the search after ${IMAGE_SEARCHES_PER_TURN} in a turn is refused; an empty query too`, async () => {
    const { deps, commons } = fakeCommons();
    const s = session();
    for (let i = 0; i < IMAGE_SEARCHES_PER_TURN; i++) await toolImageSearch(s, deps, { query: `q${i}` });
    const out = await toolImageSearch(s, deps, { query: "one more" });
    expect(out.response.ok).toBe(false);
    expect(commons.search).toHaveBeenCalledTimes(IMAGE_SEARCHES_PER_TURN);
    expect((await toolImageSearch(session(), deps, { query: "  " })).response.ok).toBe(false);
  });

  it("without the Commons deps (tests, a server without it): an error, not a throw", async () => {
    const out = await toolImageSearch(session(), {} as AgentDeps, { query: "axolotl" });
    expect(out.response.ok).toBe(false);
  });
});
