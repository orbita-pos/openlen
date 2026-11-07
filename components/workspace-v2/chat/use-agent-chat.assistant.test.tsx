// THE PERSON'S OWN ASSISTANT IN THE CHAT ENGINE (spec local 2026-11-06-asistente-propio, §4.6): every message carries
// `assistantId`; it never falls back to ai-design (which edits the page) when Len is off; the server writes its rows
// in its conversation, so the browser doesn't; and «load earlier» asks for its conversation. Same harness as
// use-agent-chat.files.test.tsx.
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

const enc = new TextEncoder();
const TURNO = `event: turno\ndata: ${JSON.stringify({ turnoId: "t1" })}\n\n`;
const DONE = `event: done\ndata: ${JSON.stringify({ text: "Ayer hablé con 3 personas." })}\n\n`;
const OFF = `event: error\ndata: ${JSON.stringify({ message: "El Agente está desactivado temporalmente.", code: "agent_off" })}\n\n`;

function stub(eventos: string[]) {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
      if (String(url) === "/api/agent" && init?.method === "POST") {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            for (const e of eventos) c.enqueue(enc.encode(e));
            c.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response(JSON.stringify({ turns: [] }), { status: 200 });
    }),
  );
  return calls;
}

async function render(props: Record<string, unknown>, capturar: (c: ReturnType<typeof useAgentChat>) => void) {
  function Chat() {
    capturar(useAgentChat({ projectId: "p1", projectHtml: "", onLocalUpdate: () => {}, ...props } as Parameters<typeof useAgentChat>[0]));
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Chat />));
}
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 50))));

describe("the chat engine as the person's own assistant", () => {
  it("sends assistantId and leaves the row to the server", async () => {
    const calls = stub([TURNO, DONE]);
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render({ assistantId: "a1" }, (c) => (chat = c));
    await act(async () => void chat!.send("¿qué tal ayer?"));
    await tick();
    const agent = calls.find((c) => c.url === "/api/agent");
    expect(agent!.body).toMatchObject({ projectId: "p1", prompt: "¿qué tal ayer?", assistantId: "a1" });
    expect(calls.some((c) => c.url === "/api/projects/p1/chat" && c.method === "POST")).toBe(false);
  });

  it("never falls back to ai-design when Len is off: it says so instead", async () => {
    const calls = stub([TURNO, OFF]);
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render({ assistantId: "a1" }, (c) => (chat = c));
    await act(async () => void chat!.send("hola"));
    await tick();
    expect(calls.some((c) => c.url.includes("ai-design"))).toBe(false);
    expect(chat!.turns.at(-1)!.status).toBe("error");
  });

  it("without assistantId, the body carries none", async () => {
    const calls = stub([TURNO, DONE]);
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render({}, (c) => (chat = c));
    await act(async () => void chat!.send("hola"));
    await tick();
    expect(calls.find((c) => c.url === "/api/agent")!.body).not.toHaveProperty("assistantId");
  });

  it("«load earlier» asks for the assistant's conversation", async () => {
    const calls = stub([]);
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render({ assistantId: "a1", initialChat: [{ id: "r1", userText: "hola", assistantReasoning: "Hola.", status: "applied", appliedAt: 1 }] }, (c) => (chat = c));
    await act(async () => void (await chat!.loadOlder()));
    expect(calls.some((c) => c.url === "/api/projects/p1/chat?before=r1&conversation=assistant%3Aa1")).toBe(true);
  });
});
