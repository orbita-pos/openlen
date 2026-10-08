// @vitest-environment jsdom
//
// EL BOTÓN «DESHACER» DE UN TURNO CON REGISTRO EN EL SERVIDOR LLAMA AL SERVIDOR.
// Visto en el ensayo de caja (08/10): `handleUndo` salía si el plan no era
// «restaurar», así que el plan «servidor» (F2) se pintaba y no hacía nada —ni en
// directo ni tras recargar—.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string) => clave,
  useLocale: () => "es",
}));

import { useAgentChat } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Deshacer con registro en el servidor", () => {
  it("🔴 pide al servidor que deshaga el turno entero, y lo marca revertido", async () => {
    const llamadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        llamadas.push(`${init?.method ?? "GET"} ${url}`);
        if (String(url).includes("/deshacer")) {
          return new Response(JSON.stringify({ paginas: [{ page: null, html: "<p>antes</p>" }], ficheros: [], noSeDeshacen: [] }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );
    let chat: ReturnType<typeof useAgentChat> | null = null;
    function Sonda() {
      chat = useAgentChat({
        projectId: "p1",
        projectHtml: "<p>despues</p>",
        onLocalUpdate: () => {},
        initialChat: [{ id: "t1", userText: "hazme la app", assistantReasoning: "Hecho.", status: "applied", appliedAt: 0, deshacible: true }],
      } as Parameters<typeof useAgentChat>[0]);
      return null;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<Sonda />));
    const turno = chat!.turns.find((t) => t.id === "t1")!;
    await act(async () => {
      await chat!.handleUndo(turno);
    });
    expect(llamadas).toContain("POST /api/projects/p1/turnos/t1/deshacer");
    expect(chat!.turns.find((t) => t.id === "t1")!.status).toBe("reverted");
  });
});
