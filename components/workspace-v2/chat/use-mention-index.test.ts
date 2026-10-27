import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { etiquetarConPosiciones } from "@/lib/agent/ficheros/posiciones";

import { useMentionIndex } from "./use-mention-index";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "<!doctype html>\n<html><body>\n<h1>Pan</h1>\n</body></html>";
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  vi.unstubAllGlobals();
});

function mount(projectId: string) {
  const seen: { current: ReturnType<typeof useMentionIndex> | null } = { current: null };
  function Probe() {
    seen.current = useMentionIndex(projectId);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  return seen;
}

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

describe("useMentionIndex", () => {
  it("turns a page index into entries parsed in the browser", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ kind: "page", hash: "h1", files: ["/index.html"], pages: [{ page: null, ruta: "/index.html", tagged: etiquetarConPosiciones(HOME) }] }),
      { status: 200, headers: { etag: '"h1"' } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const seen = mount("p1");
    await settle();
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/mention-index", expect.anything());
    expect(seen.current!.ready).toBe(true);
    expect(seen.current!.entries).toEqual([expect.objectContaining({ tag: "h1", name: "Pan", line: 3 })]);
    expect(seen.current!.files).toEqual(["/index.html"]);
  });

  it("keeps what it has when the server answers 304 to a refresh", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ kind: "app", hash: "h2", files: [], entries: [{ key: "k", tag: "li" }] }), { status: 200, headers: { etag: '"h2"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);
    const seen = mount("p2");
    await settle();
    act(() => seen.current!.refresh());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toEqual({ "if-none-match": '"h2"' });
    expect(seen.current!.entries).toEqual([{ key: "k", tag: "li" }]);
  });
});
