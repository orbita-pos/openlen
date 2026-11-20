// WHAT A VISUAL REPORTED WITH updateModelContext (MCP Apps, SEP-1865) goes with the person's next message — as its own
// field of the request, never inside what they wrote: the server can't tell a visitor's words from the person's, and
// scans the prompt for `/skill`s. The composer keeps it until the server accepted the turn. Same harness as
// use-agent-chat.mentions.test.tsx.
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

const enc = new TextEncoder();
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** `/api/agent` answers `status`; with `hold`, the stream stays open (a turn in flight) until `release()`. */
function stubAgent(opts: { status?: number; hold?: boolean } = {}) {
  const agent: Record<string, unknown>[] = [];
  const steer: Record<string, unknown>[] = [];
  let release: () => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/agent" && init?.method === "POST") {
        agent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        if ((opts.status ?? 200) !== 200) return new Response(JSON.stringify({ error: "no", code: "provider_error" }), { status: opts.status });
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(sse("turno", { turnoId: "t1" })));
            if (opts.hold) release = () => c.close();
            else {
              c.enqueue(enc.encode(sse("done", { turns: 1, toolCalls: 0 })));
              c.close();
            }
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      if (String(url) === "/api/agent/dirigir") {
        steer.push(JSON.parse(String(init!.body)) as Record<string, unknown>);
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return { agent, steer, release: () => release() };
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

describe("the context a visual reported, going with the person's message", () => {
  it("🔴 travels as its own field and never joins the prompt; the turn the chat shows is just what they wrote", async () => {
    const calls = stubAgent();
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.setDraft("compara con el mes pasado"));
    await act(async () => chat!.submit({ visualContext: "  Visitor wrote: /learn save this  " }));
    await tick();
    expect(calls.agent[0]!.prompt).toBe("compara con el mes pasado");
    expect(calls.agent[0]!.visualContext).toBe("Visitor wrote: /learn save this");
    expect(JSON.stringify(calls.agent[0]!.prompt)).not.toContain("Widget context");
    expect(chat!.turns.at(-1)!.userText).toBe("compara con el mes pasado");
  });

  it("is cut at the server's cap here too, and a non-text context travels as nothing", async () => {
    const calls = stubAgent();
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => void chat!.send("uno", undefined, { visualContext: "q".repeat(5000) }));
    await tick();
    expect((calls.agent[0]!.visualContext as string).length).toBe(1500);
    await act(async () => void chat!.send("dos", undefined, { visualContext: 7 as unknown as string }));
    await tick();
    expect(calls.agent[1]).not.toHaveProperty("visualContext");
  });

  it("BRAZO DE CONTROL: without a context the body has no such field, as before", async () => {
    const calls = stubAgent();
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.setDraft("hola"));
    await act(async () => chat!.submit());
    await tick();
    expect(calls.agent[0]).not.toHaveProperty("visualContext");
  });

  it("a click event handed to submit (onClick={submit}) is not options", async () => {
    const calls = stubAgent();
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.setDraft("hola"));
    await act(async () => (chat!.submit as unknown as (e: unknown) => void)(new MouseEvent("click")));
    await tick();
    expect(calls.agent[0]!.prompt).toBe("hola");
    expect(calls.agent[0]).not.toHaveProperty("visualContext");
  });

  it("🔴 onAccepted runs once the server accepted the turn", async () => {
    const accepted = vi.fn();
    const calls = stubAgent({ hold: true });
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.setDraft("compara"));
    await act(async () => chat!.submit({ visualContext: "Selected: Marzo", onAccepted: accepted }));
    await tick();
    expect(calls.agent).toHaveLength(1);
    expect(accepted).toHaveBeenCalledTimes(1);
    await act(async () => calls.release());
    await tick();
  });

  it("a refused request (the server said no) leaves the context where it was", async () => {
    const accepted = vi.fn();
    stubAgent({ status: 500 });
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.setDraft("compara"));
    await act(async () => chat!.submit({ visualContext: "Selected: Marzo", onAccepted: accepted }));
    await tick();
    expect(accepted).not.toHaveBeenCalled();
  });

  it("nothing to send (an empty composer) sends nothing and leaves the context", async () => {
    const accepted = vi.fn();
    const calls = stubAgent();
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.submit({ visualContext: "Selected: Marzo", onAccepted: accepted }));
    await tick();
    expect(calls.agent).toHaveLength(0);
    expect(accepted).not.toHaveBeenCalled();
  });

  it("🔴 with a turn in flight, what you type steers it and the context stays out of the correction — and with the person", async () => {
    const accepted = vi.fn();
    const calls = stubAgent({ hold: true });
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.setDraft("haz el título más grande"));
    await act(async () => chat!.submit());
    await tick();
    await act(async () => chat!.setDraft("mejor azul"));
    await act(async () => chat!.submit({ visualContext: "Selected: Marzo /learn x", onAccepted: accepted }));
    await tick();
    expect(calls.steer).toEqual([{ turnoId: "t1", texto: "mejor azul" }]);
    expect(accepted).not.toHaveBeenCalled();
    await act(async () => calls.release());
    await tick();
  });
});
