// WHETHER A THEME CAN BE BORN HERE (spec local 2026-11-27-temas-del-workspace, §7): on unless `HEAD /api/themes` says
// themes are off (404); a network failure doesn't turn it off (the server ignores a theme birth when they are off anyway).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useThemesAvailable } from "./use-themes-available";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function seen(answer: () => Promise<Response>): Promise<{ values: boolean[]; fetch: ReturnType<typeof vi.fn> }> {
  const fetch = vi.fn(answer);
  vi.stubGlobal("fetch", fetch);
  const values: boolean[] = [];
  function Probe() {
    values.push(useThemesAvailable());
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Probe />));
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  return { values, fetch };
}

describe("useThemesAvailable", () => {
  it("is on from the start, and asks with a HEAD that reads nothing", async () => {
    const { values, fetch } = await seen(async () => new Response(null, { status: 204 }));
    expect(values[0]).toBe(true);
    expect(values.at(-1)).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/api/themes", expect.objectContaining({ method: "HEAD" }));
  });

  it("turns off when the server answers 404 (OPENLEN_THEMES=0)", async () => {
    expect((await seen(async () => new Response(null, { status: 404 }))).values.at(-1)).toBe(false);
  });

  it("a network failure leaves it on", async () => {
    expect((await seen(async () => Promise.reject(new Error("offline")))).values.at(-1)).toBe(true);
  });
});
