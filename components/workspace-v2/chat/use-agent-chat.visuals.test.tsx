// LEN'S VISUALS IN THE CHAT (local spec 2026-10-16-len-inline-visuals): what the
// chat keeps of a show_widget call from the agent's stream.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const widget = { title: "visits_week", loadingMessages: ["Contando"], code: "<p>V</p>" };

function stubAgent(events: string[]) {
  const enc = new TextEncoder();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/agent" && init?.method === "POST") {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            for (const e of events) c.enqueue(enc.encode(e));
            c.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response("{}", { status: 200 });
    }),
  );
}

async function lastTurn(events: string[]) {
  stubAgent(events);
  let chat: ReturnType<typeof useAgentChat> | null = null;
  function Chat() {
    chat = useAgentChat({
      projectId: "p1",
      projectHtml: "",
      onLocalUpdate: () => {},
      pendingDraft: "¿cómo va?",
      pendingDraftAutoSend: true,
      pendingAttachments: { images: [], styleDirection: null },
      onPendingDraftConsumed: () => {},
    } as unknown as Parameters<typeof useAgentChat>[0]);
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Chat />));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return chat!.turns[chat!.turns.length - 1]!;
}

describe("useAgentChat — Len's visuals", () => {
  it("the show_widget card keeps the visual and the point of the text where it started", async () => {
    const turn = await lastTurn([
      sse("turno", { turnoId: "t1" }),
      sse("text", { type: "text", text: "Mira:" }),
      sse("widget_preview", { type: "widget_preview", callIndex: 0, title: null, loadingMessages: [], code: "<p>" }),
      sse("text", { type: "text", text: " más" }),
      sse("action", { type: "action", tool: "show_widget", status: "done", summary: "", widget }),
      sse("done", { turns: 1, toolCalls: 1 }),
    ]);
    const card = turn.actions?.find((a) => a.tool === "show_widget");
    expect(card?.widget).toEqual(widget);
    expect(card?.textOffset).toBe(5);
    expect(turn.liveWidget).toBeUndefined();
  });

  it("without a preview, the card's point is the text written so far", async () => {
    const turn = await lastTurn([
      sse("turno", { turnoId: "t1" }),
      sse("text", { type: "text", text: "Hola" }),
      sse("action", { type: "action", tool: "show_widget", status: "done", summary: "", widget }),
      sse("done", { turns: 1, toolCalls: 1 }),
    ]);
    expect(turn.actions?.find((a) => a.tool === "show_widget")?.textOffset).toBe(4);
  });

  it("a visual left half written when the turn ends is not kept", async () => {
    const turn = await lastTurn([
      sse("turno", { turnoId: "t1" }),
      sse("widget_preview", { type: "widget_preview", callIndex: 0, title: null, loadingMessages: [], code: "<p>a" }),
      sse("done", { turns: 1, toolCalls: 0 }),
    ]);
    expect(turn.liveWidget).toBeUndefined();
  });

  it("a card with a bad widget keeps no visual", async () => {
    const turn = await lastTurn([
      sse("turno", { turnoId: "t1" }),
      sse("action", { type: "action", tool: "show_widget", status: "done", summary: "", widget: { code: "" } }),
      sse("done", { turns: 1, toolCalls: 1 }),
    ]);
    expect(turn.actions?.find((a) => a.tool === "show_widget")?.widget).toBeUndefined();
  });
});
