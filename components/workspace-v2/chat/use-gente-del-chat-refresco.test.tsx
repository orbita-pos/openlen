// @vitest-environment jsdom
//
// LA GENTE DEL CHAT SE REFRESCA: una pestaña abierta antes de que nadie
// aceptara la invitación tiene que enterarse de que el proyecto ya es
// compartido —si no, no lee los mensajes del equipo ni ofrece la «@»—.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { avisarMiembrosCambiaron, useGenteDelChat, type GenteDelChat } from "./use-gente-del-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const DANA = { userId: "u-dana", name: "Dana Dueña", email: "d@x" };
const ELI = { userId: "u-eli", name: "Eli Editor", email: "e@x" };
const respuesta = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200 });

function Sonda({ ver }: { ver: (g: GenteDelChat) => void }) {
  ver(useGenteDelChat("p1"));
  return null;
}

async function montar(f: ReturnType<typeof vi.fn>): Promise<() => GenteDelChat> {
  vi.stubGlobal("fetch", f);
  let g: GenteDelChat | null = null;
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Sonda ver={(x) => (g = x)} />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return () => g!;
}

describe("la gente del chat se refresca", () => {
  it("🔴 el dueño que invitó espera: cuando el invitado acepta, el chat pasa a compartido sin recargar", async () => {
    vi.useFakeTimers();
    const f = vi
      .fn()
      .mockResolvedValueOnce(respuesta({ rol: "dueno", yo: "u-dana", dueno: DANA, miembros: [], invitaciones: [{ email: "e@x" }] }))
      .mockImplementation(async () => respuesta({ rol: "dueno", yo: "u-dana", dueno: DANA, miembros: [ELI], invitaciones: [] }));
    const gente = await montar(f);
    expect(gente().compartido).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(gente().compartido).toBe(true);
    expect(gente().gente.map((p) => p.nombre)).toEqual(["Dana Dueña", "Eli Editor"]);
    // Ya no espera a nadie: deja de preguntar.
    const llamadas = f.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(f.mock.calls.length).toBe(llamadas);
  });

  it("🔴 sin invitaciones no pregunta solo; un cambio de miembros (invitar desde el diálogo) lo vuelve a leer", async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => respuesta({ rol: "dueno", yo: "u-dana", dueno: DANA, miembros: [], invitaciones: [] }));
    await montar(f);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(f).toHaveBeenCalledTimes(1);
    await act(async () => {
      avisarMiembrosCambiaron();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
