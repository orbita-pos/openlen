// @vitest-environment jsdom
//
// EL PRIMER MENSAJE SE MANDA UNA VEZ. Visto en los turnos reales del 09/10: en
// `next dev` (reactStrictMode) el primer mensaje de una app nueva salía DOS
// veces —dos turnos a la vez, pisándose los ficheros, el doble de gasto—: React
// monta, desmonta y vuelve a montar los efectos, y el del envío automático veía
// el mismo borrador las dos veces, antes de que el padre lo consumiera.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, StrictMode, useState } from "react";
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

function Chat(props: { draft: string | null; onConsumed: () => void }) {
  useAgentChat({
    projectId: "p1",
    projectHtml: "",
    onLocalUpdate: () => {},
    pendingDraft: props.draft,
    pendingDraftAutoSend: true,
    onPendingDraftConsumed: props.onConsumed,
  } as Parameters<typeof useAgentChat>[0]);
  return null;
}

describe("el envío automático del borrador", () => {
  it("🔴 en StrictMode el primer mensaje va UNA vez a Len; y el mismo texto, pedido otra vez, vuelve a ir", async () => {
    const turnos: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url) === "/api/agent" && init?.method === "POST") {
          turnos.push(String(init.body));
          // Un turno que acaba (en error): `send` deja de estar ocupado.
          return new Response(JSON.stringify({ error: "x" }), { status: 500 });
        }
        return new Response("{}", { status: 200 });
      }),
    );
    let pedir: (texto: string) => void = () => {};
    function Padre() {
      const [draft, setDraft] = useState<string | null>("hazme una caja");
      pedir = setDraft;
      return <Chat draft={draft} onConsumed={() => setDraft(null)} />;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <StrictMode>
          <Padre />
        </StrictMode>,
      ),
    );
    expect(turnos).toHaveLength(1);
    expect(turnos[0]).toContain("hazme una caja");

    await act(async () => pedir("hazme una caja"));
    expect(turnos).toHaveLength(2);
  });
});
