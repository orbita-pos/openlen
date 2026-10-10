// @vitest-environment jsdom
//
// UNA APP QUE NACE SE VE COMO APP DESDE EL PRIMER TURNO. Visto en el ensayo de
// caja (10/10): el servidor pone el esqueleto antes del turno, pero la vista no
// se enteraba hasta que el turno acababa —más de 7 minutos con «Leyendo la
// página», la barra «/» y el lápiz, y «Revisa tu página»—; y si el turno
// fallaba, seguía en modo página hasta recargar. El evento `turno` sale
// DESPUÉS del esqueleto (app/api/agent/route.ts): ahí se recarga el proyecto.
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
let cerrarStream: (() => void) | null = null;
afterEach(() => {
  cerrarStream?.();
  cerrarStream = null;
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** `/api/agent` contesta con el evento `turno` y deja el stream ABIERTO: el
 *  turno sigue en marcha mientras se mira. */
function stubAgentStream() {
  const enc = new TextEncoder();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/agent" && init?.method === "POST") {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(`event: turno\ndata: ${JSON.stringify({ turnoId: "t1" })}\n\n`));
            cerrarStream = () => {
              try {
                c.close();
              } catch {
                /* ya cerrado */
              }
            };
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response("{}", { status: 200 });
    }),
  );
}

async function render(attachments: Parameters<typeof useAgentChat>[0]["pendingAttachments"], onChatChange: () => void) {
  function Chat() {
    useAgentChat({
      projectId: "p1",
      projectHtml: "",
      onLocalUpdate: () => {},
      onChatChange,
      pendingDraft: "hazme la caja de una cafetería",
      pendingDraftAutoSend: true,
      pendingAttachments: attachments,
      onPendingDraftConsumed: () => {},
    } as Parameters<typeof useAgentChat>[0]);
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Chat />));
  // Que el stream entregue su primer evento.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe("la app que nace con el primer mensaje", () => {
  it("🔴 recarga el proyecto en cuanto el turno empieza, sin esperar a que acabe", async () => {
    stubAgentStream();
    const onChatChange = vi.fn();
    await render({ images: [], styleDirection: null, naceComo: "app", idioma: "es" }, onChatChange);
    expect(onChatChange).toHaveBeenCalledTimes(1);
  });

  it("CONTRA-PRUEBA: un primer mensaje de página no recarga a mitad del turno", async () => {
    stubAgentStream();
    const onChatChange = vi.fn();
    await render({ images: [], styleDirection: null }, onChatChange);
    expect(onChatChange).not.toHaveBeenCalled();
  });
});
