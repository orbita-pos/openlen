// The chat tells the workspace how Len's latest turn is going
// (`onLatestTurnChange`): the canvas shows the app-birth workshop from it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string) => clave,
  useLocale: () => "es",
}));

import type { LatestTurn } from "@/lib/workspace-v2/app-birth";
import type { StoredChatTurn } from "@/lib/projects/types";
import { useAgentChat } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** `/api/agent` answers an SSE stream the test feeds one event at a time
 *  (`push`), so each event gets its own render, as it does with a real server. */
function stubAgent() {
  const enc = new TextEncoder();
  let feed: ReadableStreamDefaultController<Uint8Array> | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/agent" && init?.method === "POST") {
        const body = new ReadableStream<Uint8Array>({ start: (c) => void (feed = c) });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  return {
    push: async (event: string) => {
      feed!.enqueue(enc.encode(event));
      await settle();
    },
    close: async () => {
      feed!.close();
      await settle();
    },
  };
}

async function render(initialChat: StoredChatTurn[] = []) {
  const seen: (LatestTurn | null)[] = [];
  function Chat() {
    useAgentChat({
      projectId: "p1",
      projectHtml: "",
      onLocalUpdate: () => {},
      initialChat,
      pendingDraft: "Una app de inventario",
      pendingDraftAutoSend: true,
      onPendingDraftConsumed: () => {},
      onLatestTurnChange: (t: LatestTurn | null) => seen.push(t),
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
  return seen;
}

const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const TURNO = ev("turno", { turnoId: "t1" });
const WRITE = ev("action", { tool: "Write", status: "running", summary: "src/screens/Home.tsx" });
const DONE = ev("done", { turns: 1, toolCalls: 1 });


describe("onLatestTurnChange", () => {
  it("reports the first turn while it runs, with its cards, and then how it ended", async () => {
    const sse = stubAgent();
    const seen = await render();
    await sse.push(TURNO);
    await sse.push(WRITE);
    expect(seen[seen.length - 1]).toMatchObject({
      status: "streaming",
      isFirst: true,
      actions: [{ tool: "Write", status: "running", summary: "src/screens/Home.tsx" }],
    });
    await sse.push(DONE);
    await sse.close();
    expect(seen[seen.length - 1]?.status).toBe("applied");
  });

  it("a turn after an earlier one is not the first", async () => {
    const sse = stubAgent();
    const before: StoredChatTurn = { id: "old", userText: "hola", assistantReasoning: "hola", status: "applied" } as StoredChatTurn;
    const seen = await render([before]);
    await sse.push(TURNO);
    const running = seen.filter((t) => t?.status === "streaming");
    expect(running.length).toBeGreaterThan(0);
    expect(running.every((t) => !t!.isFirst)).toBe(true);
  });

  it("a team message doesn't count as Len's earlier turn", async () => {
    const sse = stubAgent();
    const persona = { id: "m1", userText: "hola equipo", assistantReasoning: "", status: "applied", tipo: "persona" } as StoredChatTurn;
    const seen = await render([persona]);
    await sse.push(TURNO);
    const running = seen.filter((t) => t?.status === "streaming");
    expect(running.length).toBeGreaterThan(0);
    expect(running.every((t) => t!.isFirst)).toBe(true);
  });
});
