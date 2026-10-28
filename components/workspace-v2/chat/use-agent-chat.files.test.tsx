// A PDF in the chat (26/10): what the composer attached goes with the message
// as `attachedFiles`, stays on the turn (the bubble shows it, Retry resends
// it) and leaves the composer. Same harness as use-agent-chat.design.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string) => clave,
  useLocale: () => "es",
}));

import { restoreTurn, useAgentChat } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const MENU = { url: "/uploads/uploads/p1/abc123.pdf", name: "menu.pdf", size: 2048 };
const enc = new TextEncoder();
const TURNO = `event: turno\ndata: ${JSON.stringify({ turnoId: "t1" })}\n\n`;
const ERROR = `event: error\ndata: ${JSON.stringify({ message: "falló", code: "provider_error" })}\n\n`;

function stubAgent(eventos: string[]) {
  const cuerpos: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/agent" && init?.method === "POST") {
        cuerpos.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            for (const e of eventos) c.enqueue(enc.encode(e));
            c.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return cuerpos;
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

describe("several photos attached in the chat (spec local 2026-10-27-chat-drop-and-images)", () => {
  it("sends every attached photo, up to 4, and clears them", async () => {
    const cuerpos = stubAgent([TURNO, ERROR]);
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render({}, (c) => (chat = c));
    await act(async () => chat!.setAttachedImages([{ url: "https://u/1.jpg" }, { url: "https://u/2.jpg" }]));
    expect(chat!.attachedImage).toEqual({ url: "https://u/1.jpg" });
    await act(async () => void chat!.send("ponlas"));
    await tick();
    expect(cuerpos[0]!.attachedImages).toEqual([{ url: "https://u/1.jpg" }, { url: "https://u/2.jpg" }]);
    expect(chat!.attachedImages).toEqual([]);
    expect(chat!.turns.at(-1)!.attachedImages).toEqual([{ url: "https://u/1.jpg" }, { url: "https://u/2.jpg" }]);
  });

  it("the old one-photo setter still works", async () => {
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render({}, (c) => (chat = c));
    await act(async () => chat!.setAttachedImage({ url: "https://u/a.jpg" }));
    expect(chat!.attachedImages).toEqual([{ url: "https://u/a.jpg" }]);
    await act(async () => chat!.setAttachedImage(null));
    expect(chat!.attachedImages).toEqual([]);
  });
});

describe("a PDF attached in the chat", () => {
  it("🔴 goes with the message as attachedFiles, stays on the turn and leaves the composer; Retry resends it", async () => {
    const cuerpos = stubAgent([TURNO, ERROR]);
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render({}, (c) => (chat = c));
    await act(async () => chat!.setAttachedFiles([MENU]));
    await act(async () => void chat!.send("pon mi menú"));
    await tick();
    expect(cuerpos[0]!.attachedFiles).toEqual([MENU]);
    expect(chat!.attachedFiles).toEqual([]);
    const turno = chat!.turns.at(-1)!;
    expect(turno.attachedFiles).toEqual([MENU]);
    await act(async () => chat!.handleRetry(turno));
    await tick();
    expect(cuerpos[1]!.attachedFiles).toEqual([MENU]);
  });

  it("the first message of a blank project carries the files the start screen attached", async () => {
    const cuerpos = stubAgent([TURNO, ERROR]);
    await render(
      { pendingDraft: "hazme una página con mi menú", pendingDraftAutoSend: true, pendingAttachments: { images: [], files: [MENU] }, onPendingDraftConsumed: () => {} },
      () => {},
    );
    await tick();
    expect(cuerpos[0]!.attachedFiles).toEqual([MENU]);
  });

  it("a message without files sends no attachedFiles, as before", async () => {
    const cuerpos = stubAgent([TURNO, ERROR]);
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render({}, (c) => (chat = c));
    await act(async () => void chat!.send("hola"));
    await tick();
    expect("attachedFiles" in cuerpos[0]!).toBe(false);
  });

  it("a stored turn brings its files back for the bubble", () => {
    const t = restoreTurn({ id: "x", userText: "pon mi menú", assistantReasoning: "", status: "applied", appliedAt: 1, attachedFiles: [MENU] } as Parameters<typeof restoreTurn>[0]);
    expect(t.attachedFiles).toEqual([MENU]);
  });
});
