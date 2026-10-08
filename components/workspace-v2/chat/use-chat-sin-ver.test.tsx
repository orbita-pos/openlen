// @vitest-environment jsdom
//
// EL PUNTO DE «SIN VER» DEL CHAT en el carril (el chat del equipo): lo que dice
// el servidor con el chat cerrado; 0 con el chat abierto (abrirlo las ve).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { useChatSinVer } from "./use-chat-sin-ver";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function Sonda({ abierto, ver }: { abierto: boolean; ver: (n: number) => void }) {
  ver(useChatSinVer("p1", abierto));
  return null;
}

async function medir(abierto: boolean): Promise<{ n: number; fetch: ReturnType<typeof vi.fn> }> {
  const f = vi.fn(async () => new Response(JSON.stringify({ sinVer: 2 }), { status: 200 }));
  vi.stubGlobal("fetch", f);
  let n = -1;
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Sonda abierto={abierto} ver={(x) => (n = x)} />));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { n, fetch: f };
}

describe("el punto de «sin ver» del chat", () => {
  it("🔴 con el chat cerrado, las menciones sin ver que dice el servidor", async () => {
    const { n, fetch } = await medir(false);
    expect(n).toBe(2);
    expect(String(fetch.mock.calls[0]![0])).toBe("/api/projects/p1/chat/mensajes?solo=sinVer");
  });

  it("con el chat abierto, 0 y sin preguntar", async () => {
    const { n, fetch } = await medir(true);
    expect(n).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
