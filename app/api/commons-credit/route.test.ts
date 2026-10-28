// The credit of a Commons copy, read on the server (spec local 2026-10-27-chat-drop-and-images,
// Part B): the chat can't read our storage's JSON across origins, so this same-origin route does —
// and only for our own Commons copies, so it can't be pointed anywhere else.
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const CREDIT = { title: "Axolotl", author: "Stan Shebs", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg" };

afterEach(() => vi.unstubAllGlobals());
const ask = (u: string) => GET(new Request(`http://localhost:3000/api/commons-credit?url=${encodeURIComponent(u)}`));

describe("GET /api/commons-credit", () => {
  it("reads the sidecar beside our copy and answers the credit, cacheable", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(CREDIT), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await ask(`https://uploads.openlen.com/commons/${SHA}-960.jpg`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CREDIT);
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe(`https://uploads.openlen.com/commons/${SHA}-960.json`);
    expect(res.headers.get("cache-control")).toContain("max-age");
  });

  it("a relative copy (filesystem storage) is read from this same origin", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(CREDIT)));
    vi.stubGlobal("fetch", fetchMock);
    await ask(`/uploads/commons/${SHA}-960.jpg`);
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe(`http://localhost:3000/uploads/commons/${SHA}-960.json`);
  });

  it("anything that isn't our copy is refused without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await ask(`https://evil.example/commons/${SHA}-960.jpg`)).status).toBe(400);
    expect((await ask("http://169.254.169.254/latest")).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a missing or broken sidecar is a 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect((await ask(`/uploads/commons/${SHA}-960.jpg`)).status).toBe(404);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    expect((await ask(`/uploads/commons/${SHA}-960.jpg`)).status).toBe(404);
  });
});
