// WHETHER THE «JUEGO» CARD IS DRAWN (spec local 2026-11-05-modo-juego-design, §8.1): on unless the server says games
// are off; a network failure doesn't hide it (the server ignores a game birth when they are off anyway).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGamesAvailable } from "./use-games-available";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function seen(answer: () => Promise<Response>): Promise<boolean[]> {
  vi.stubGlobal("fetch", vi.fn(answer));
  const values: boolean[] = [];
  function Probe() {
    values.push(useGamesAvailable());
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Probe />));
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  return values;
}

describe("useGamesAvailable", () => {
  it("is on from the start, and stays on when the server says so", async () => {
    const v = await seen(async () => new Response(JSON.stringify({ available: true }), { status: 200 }));
    expect(v[0]).toBe(true);
    expect(v.at(-1)).toBe(true);
  });

  it("turns off when the server answers 404 (OPENLEN_GAMES=0)", async () => {
    expect((await seen(async () => new Response("{}", { status: 404 }))).at(-1)).toBe(false);
  });

  it("a network failure leaves it on", async () => {
    expect((await seen(async () => Promise.reject(new Error("offline")))).at(-1)).toBe(true);
  });
});
