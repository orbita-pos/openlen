// A11 · el turno en vivo que resumió la conversación (un `/compact`, o la
// compactación a media faena) pinta su línea «Conversación resumida» sin
// esperar a recargar: la trae el evento `compaction` (`preTokens`).
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

async function lastTurn(events: string[]) {
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
  let chat: ReturnType<typeof useAgentChat> | null = null;
  function Chat() {
    chat = useAgentChat({
      projectId: "p1",
      projectHtml: "",
      onLocalUpdate: () => {},
      pendingDraft: "/compact",
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

describe("A11 · the live turn that summarized", () => {
  it("🔴 a summarized compaction event gives the turn its compactedTokens", async () => {
    const turn = await lastTurn([
      sse("turno", { turnoId: "t1" }),
      sse("compaction_start", { type: "compaction_start" }),
      sse("compaction", { type: "compaction", pruned: 0, summarized: true, discardChars: 0, preTokens: 912000 }),
      sse("done", { turns: 0, toolCalls: 0 }),
    ]);
    expect(turn.compactedTokens).toBe(912000);
  });

  it("a prune without a summary does not", async () => {
    const turn = await lastTurn([
      sse("turno", { turnoId: "t1" }),
      sse("compaction", { type: "compaction", pruned: 2, summarized: false, discardChars: 0 }),
      sse("text", { type: "text", text: "Hecho." }),
      sse("done", { turns: 1, toolCalls: 0 }),
    ]);
    expect(turn.compactedTokens).toBeUndefined();
  });
});
