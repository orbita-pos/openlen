import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOOLS_CHANGED_EVENT, useInstalledTools } from "./use-installed-tools";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
});

describe("useInstalledTools", () => {
  it("loads the person's tools and reloads when they change", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tools: [{ id: "a" }] })));
    vi.stubGlobal("fetch", fetchMock);
    let seen: unknown[] = [];
    function Probe() {
      seen = useInstalledTools("es").tools;
      return null;
    }
    root = createRoot(document.createElement("div"));
    await act(async () => root!.render(<Probe />));
    expect(fetchMock).toHaveBeenCalledWith("/api/tools?locale=es", expect.anything());
    expect(seen).toEqual([{ id: "a" }]);
    await act(async () => void window.dispatchEvent(new Event(TOOLS_CHANGED_EVENT)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tools off or not signed in: an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    let seen: unknown[] = ["x"];
    function Probe() {
      seen = useInstalledTools("es").tools;
      return null;
    }
    root = createRoot(document.createElement("div"));
    await act(async () => root!.render(<Probe />));
    expect(seen).toEqual([]);
  });
});
