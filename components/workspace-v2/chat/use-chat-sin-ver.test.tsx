// @vitest-environment jsdom
//
// EL PUNTO DE «SIN VER» DEL CHAT en el carril (el chat del equipo): lo que dice
// el servidor con el chat cerrado; 0 con el chat abierto (abrirlo las ve).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { chatALaVista, useChatSinVer } from "./use-chat-sin-ver";
import { avisarMiembrosCambiaron } from "./use-gente-del-chat";

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

describe("¿el chat se ve?", () => {
  it("🔴 minimizado no se ve (y no marca nada visto); flotante sí aunque el panel esté plegado; anclado, sólo desplegado", () => {
    expect(chatALaVista({ mode: "chat", plegado: false, layout: "minimized", movil: false })).toBe(false);
    expect(chatALaVista({ mode: "chat", plegado: true, layout: "floating", movil: false })).toBe(true);
    expect(chatALaVista({ mode: "chat", plegado: true, layout: "docked", movil: false })).toBe(false);
    expect(chatALaVista({ mode: "chat", plegado: false, layout: "docked", movil: false })).toBe(true);
    expect(chatALaVista({ mode: "content", plegado: false, layout: "floating", movil: false })).toBe(false);
    // En el móvil el chat siempre va anclado: lo que cuenta es el panel.
    expect(chatALaVista({ mode: "chat", plegado: false, layout: "minimized", movil: true })).toBe(true);
    expect(chatALaVista({ mode: "chat", plegado: true, layout: "floating", movil: true })).toBe(false);
  });
});

describe("sin miembros", () => {
  it("🔴 si el servidor dice que el proyecto no es compartido, deja de preguntar", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(async () => new Response(JSON.stringify({ sinVer: 0, compartido: false }), { status: 200 }));
      vi.stubGlobal("fetch", f);
      const host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      await act(async () => root!.render(<Sonda abierto={false} ver={() => {}} />));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(95_000);
      });
      expect(f).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("🔴 sin miembros pero con una invitación pendiente, sigue preguntando (el invitado puede aceptar con la pestaña abierta)", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(async () => new Response(JSON.stringify({ sinVer: 0, compartido: false, esperando: true }), { status: 200 }));
      vi.stubGlobal("fetch", f);
      const host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      await act(async () => root!.render(<Sonda abierto={false} ver={() => {}} />));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });
      expect(f).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("🔴 parado por no ser compartido, vuelve a preguntar cuando cambian los miembros (el dueño invitó)", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(async () => new Response(JSON.stringify({ sinVer: 0, compartido: false }), { status: 200 }));
      vi.stubGlobal("fetch", f);
      const host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      await act(async () => root!.render(<Sonda abierto={false} ver={() => {}} />));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(35_000);
      });
      expect(f).toHaveBeenCalledTimes(1);
      await act(async () => {
        avisarMiembrosCambiaron();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(f).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
