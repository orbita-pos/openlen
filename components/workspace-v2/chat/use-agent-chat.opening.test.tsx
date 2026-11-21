// AN AGENT'S FIRST MESSAGE (spec local 2026-11-19-agentes-para-todos, §6.4): her place sends her file's `initialPrompt`
// to an empty conversation, marked `opening`, and the server claims it once. When another tab (or the phone) already
// sent it, the server says so and this one leaves no turn behind: the conversation is the other's. Same harness as
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
const ERROR = `event: error\ndata: ${JSON.stringify({ message: "falló", code: "provider_error" })}\n\n`;

function stubAgent(answer: () => Response) {
  const cuerpos: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/agent" && init?.method === "POST") {
        cuerpos.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return answer();
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return cuerpos;
}
const stream = (eventos: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const e of eventos) c.enqueue(enc.encode(e));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

async function render(props: Record<string, unknown>, capturar: (c: ReturnType<typeof useAgentChat>) => void) {
  function Chat() {
    capturar(useAgentChat({ projectId: "space", projectHtml: "", onLocalUpdate: () => {}, assistantId: "a1", ...props } as Parameters<typeof useAgentChat>[0]));
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Chat />));
}
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 50))));
const OPENING = { pendingDraft: "¡Hola! Empecemos: averigua mi nivel.", pendingDraftAutoSend: true, pendingAttachments: { images: [], opening: true }, onPendingDraftConsumed: () => {} };

describe("an agent's first message", () => {
  it("🔴 goes marked as her opening", async () => {
    const cuerpos = stubAgent(() => stream([TURNO, ERROR]));
    await render(OPENING, () => {});
    await tick();
    expect(cuerpos[0]).toMatchObject({ assistantId: "a1", prompt: "¡Hola! Empecemos: averigua mi nivel.", opening: true });
  });

  it("🔴 already sent from elsewhere: no turn is left behind, and no error", async () => {
    stubAgent(() => Response.json({ error: "this agent's first message was already sent", code: "already_opened" }, { status: 409 }));
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render(OPENING, (c) => (chat = c));
    await tick();
    expect(chat!.turns).toEqual([]);
  });

  it("🔴 already sent from elsewhere: the conversation is read again, so the other's turn shows here", async () => {
    stubAgent(() => Response.json({ error: "this agent's first message was already sent", code: "already_opened" }, { status: 409 }));
    const onChatChange = vi.fn();
    await render({ ...OPENING, onChatChange }, () => {});
    await tick();
    expect(onChatChange).toHaveBeenCalledTimes(1);
  });

  it("a message the person writes isn't an opening", async () => {
    const cuerpos = stubAgent(() => stream([TURNO, ERROR]));
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render({}, (c) => (chat = c));
    await act(async () => void chat!.send("hola"));
    await tick();
    expect("opening" in cuerpos[0]!).toBe(false);
  });
});
