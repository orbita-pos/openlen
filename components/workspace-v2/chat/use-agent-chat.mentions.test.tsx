// THE CHAT'S «@» (spec local 2026-10-27, §6.7–6.8): the mentions whose label is
// still in the message go with it as `mentions`, stay on the turn, and leave the
// composer. Same harness as use-agent-chat.files.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "es",
}));

import { useAgentChat } from "./use-agent-chat";
import type { MentionRef } from "@/lib/mentions/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const enc = new TextEncoder();
const TURN = `event: turno\ndata: ${JSON.stringify({ turnoId: "t1" })}\n\n`;
const ERROR = `event: error\ndata: ${JSON.stringify({ message: "falló", code: "provider_error" })}\n\n`;

function stubAgent() {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/agent" && init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            for (const e of [TURN, ERROR]) c.enqueue(enc.encode(e));
            c.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return bodies;
}

async function render(capture: (c: ReturnType<typeof useAgentChat>) => void) {
  function Chat() {
    capture(useAgentChat({ projectId: "p1", projectHtml: "", onLocalUpdate: () => {} } as Parameters<typeof useAgentChat>[0]));
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Chat />));
}
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 50))));

const LINK: MentionRef = { type: "element", label: "@Enlace · Ver el mostrador", text: "Ver el mostrador", target: { type: "page", page: null, path: "a:nth-of-type(1)", tag: "a" } };
const HERO: MentionRef = { type: "element", label: "@Título · Pan de verdad", text: "Pan de verdad", target: { type: "page", page: null, path: "h1:nth-of-type(1)", tag: "h1" } };
const GONE: MentionRef = { type: "file", label: "@/LEN.md", ruta: "/LEN.md" };

describe("mentions in the chat", () => {
  it("🔴 go with the message in text order, stay on the turn and leave the composer; no scope", async () => {
    const bodies = stubAgent();
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.setMentions([LINK, HERO, GONE]));
    await act(async () => void chat!.send(`haz ${HERO.label} como ${LINK.label}`));
    await tick();
    expect(bodies[0]!.mentions).toEqual([HERO, LINK]);
    expect(bodies[0]!.scope).toBeUndefined();
    expect(chat!.turns.at(-1)!.mentions).toEqual([HERO, LINK]);
    expect(chat!.mentions).toEqual([]);
  });

  it("addMention puts the label in the draft and refuses past the limit", async () => {
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.setDraft("haz"));
    await act(async () => void chat!.addMention(LINK));
    expect(chat!.draft).toBe(`haz ${LINK.label} `);
    expect(chat!.mentions).toEqual([LINK]);
    const full = Array.from({ length: 20 }, (_, i): MentionRef => ({ type: "file", label: `@/f${i}`, ruta: `/f${i}` }));
    await act(async () => chat!.setMentions(full));
    let added = true;
    await act(async () => void (added = chat!.addMention(HERO)));
    expect(added).toBe(false);
    expect(chat!.mentions).toHaveLength(20);
  });

  it("a message without mentions sends none, as before", async () => {
    const bodies = stubAgent();
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => void chat!.send("hola"));
    await tick();
    expect(bodies[0]!.mentions).toBeUndefined();
  });
});
