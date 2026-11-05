// «CREAR» CARDS (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): Len's `propose_action` reaches the chat as
// the stream's `tool_card`, and the card shows under its answer at once — before any fetch.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string) => clave,
  useLocale: () => "es",
}));

import { toolCardsLive } from "../tools/use-tool-cards";

import { useAgentChat } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  toolCardsLive.forget();
  vi.unstubAllGlobals();
});

function stubAgent(eventos: (rowId: () => string) => string[]) {
  const enc = new TextEncoder();
  let row = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/agent" && init?.method === "POST") {
        row = String((JSON.parse(String(init.body)) as { turnId: string }).turnId);
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            for (const e of eventos(() => row)) c.enqueue(enc.encode(e));
            c.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return () => row;
}

describe("the stream's tool_card", () => {
  it("puts the card in the chat's store under the turn's row", async () => {
    const rowOf = stubAgent((row) => [
      `event: turno\ndata: ${JSON.stringify({ turnoId: "t1" })}\n\n`,
      `event: tool_card\ndata: ${JSON.stringify({
        type: "tool_card",
        card: { id: "card-1", chatRowId: row(), title: "Reservas de hoy", brief: "Ver las reservas.", initialContent: null, placement: "rail", customLocation: null, phase: "proposed", toolProjectId: null, installationId: null, error: null, review: null },
      })}\n\n`,
      `event: done\ndata: ${JSON.stringify({ turns: 1, toolCalls: 1 })}\n\n`,
    ]);
    function Chat() {
      useAgentChat({
        projectId: "p1",
        projectHtml: "",
        onLocalUpdate: () => {},
        pendingDraft: "¿Qué herramienta me harías?",
        pendingDraftAutoSend: true,
        onPendingDraftConsumed: () => {},
      } as Parameters<typeof useAgentChat>[0]);
      return null;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<Chat />));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(rowOf()).not.toBe("");
    expect(toolCardsLive.of("p1", rowOf()).map((c) => c.id)).toEqual(["card-1"]);
  });
});
