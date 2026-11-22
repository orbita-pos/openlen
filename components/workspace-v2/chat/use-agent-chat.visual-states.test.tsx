// WHAT THE VISUALS SHARED (spec local 2026-11-22-visuales-de-verdad, §2; Claude Code 2.1.329's held views): the chat keeps
// the latest state of each visual of the open conversation and sends them with every message, correction and answer — in
// their own field, never inside what the person wrote. Another conversation starts with none. Same harness as
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
const A = "widget_aaaa1111";
const B = "widget_bbbb2222";

/** `/api/agent` answers; with `hold`, the stream stays open (a turn in flight) until `release()`, after `first` events. */
function stubAgent(opts: { hold?: boolean; first?: string[] } = {}) {
  const agent: Record<string, unknown>[] = [];
  const steer: Record<string, unknown>[] = [];
  const answers: Record<string, unknown>[] = [];
  let release: () => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/agent" && init?.method === "POST") {
        agent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(sse("turno", { turnoId: "t1" })));
            for (const e of opts.first ?? []) c.enqueue(enc.encode(e));
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
      if (String(url) === "/api/agent/responder") {
        answers.push(JSON.parse(String(init!.body)) as Record<string, unknown>);
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return { agent, steer, answers, release: () => release() };
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

describe("what the visuals shared, going with what the person sends", () => {
  it("🔴 the latest state of each visual travels in its own field; the prompt is just what they wrote", async () => {
    const calls = stubAgent();
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => {
      chat!.reportVisualState(A, "1 of 5");
      chat!.reportVisualState(B, "Marzo");
      chat!.reportVisualState(A, "3 of 5");
    });
    await act(async () => chat!.setDraft("ya"));
    await act(async () => chat!.submit());
    await tick();
    expect(calls.agent[0]!.prompt).toBe("ya");
    expect(calls.agent[0]!.visualStates).toEqual([
      { widgetId: B, state: "Marzo" },
      { widgetId: A, state: "3 of 5" },
    ]);
    expect(calls.agent[0]).not.toHaveProperty("visualContext");
    expect(chat!.turns.at(-1)!.userText).toBe("ya");
  });

  it("🔴 a visual that reports 300 times leaves one state; an empty one removes it", async () => {
    const calls = stubAgent();
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => {
      for (let i = 0; i < 300; i++) chat!.reportVisualState(A, `step ${i}`);
      chat!.reportVisualState(B, "x");
      chat!.reportVisualState(B, "");
    });
    await act(async () => void chat!.send("uno"));
    await tick();
    expect(calls.agent[0]!.visualStates).toEqual([{ widgetId: A, state: "step 299" }]);
  });

  it("they stay for the next message too (the latest is what counts, not one message's worth)", async () => {
    const calls = stubAgent();
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.reportVisualState(A, "3 of 5"));
    await act(async () => void chat!.send("uno"));
    await tick();
    await act(async () => void chat!.send("dos"));
    await tick();
    expect(calls.agent[1]!.visualStates).toEqual([{ widgetId: A, state: "3 of 5" }]);
  });

  it("🔴 another conversation starts with none", async () => {
    const calls = stubAgent();
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.reportVisualState(A, "3 of 5"));
    await act(async () => chat!.conversationChanged());
    await act(async () => void chat!.send("hola"));
    await tick();
    expect(calls.agent[0]).not.toHaveProperty("visualStates");
  });

  it("BRAZO DE CONTROL: with no state the body has no such field", async () => {
    const calls = stubAgent();
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.setDraft("hola"));
    await act(async () => chat!.submit());
    await tick();
    expect(calls.agent[0]).not.toHaveProperty("visualStates");
  });

  it("🔴 with a turn in flight, a correction carries them", async () => {
    const calls = stubAgent({ hold: true });
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.setDraft("hazme ejercicios"));
    await act(async () => chat!.submit());
    await tick();
    await act(async () => chat!.reportVisualState(A, "3 of 5"));
    await act(async () => chat!.setDraft("ya"));
    await act(async () => chat!.submit());
    await tick();
    expect(calls.steer).toEqual([{ turnoId: "t1", texto: "ya", visualStates: [{ widgetId: A, state: "3 of 5" }] }]);
    await act(async () => calls.release());
    await tick();
  });

  it("🔴 a visual's «Check ↗» with a turn in flight steers it, as typing would", async () => {
    const calls = stubAgent({ hold: true });
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.setDraft("hazme ejercicios"));
    await act(async () => chat!.submit());
    await tick();
    await act(async () => chat!.reportVisualState(A, "5 of 5"));
    await act(async () => chat!.continueWith("Check my answers"));
    await tick();
    expect(calls.steer).toEqual([{ turnoId: "t1", texto: "Check my answers", visualStates: [{ widgetId: A, state: "5 of 5" }] }]);
    expect(calls.agent).toHaveLength(1);
    await act(async () => calls.release());
    await tick();
  });

  it("an answer to Len's question carries them", async () => {
    const questions = [{ id: "q1", question: "¿Plazo?", options: [{ label: "48 horas" }] }];
    const calls = stubAgent({ hold: true, first: [sse("question", { questions })] });
    let chat: ReturnType<typeof useAgentChat> | null = null;
    await render((c) => (chat = c));
    await act(async () => chat!.setDraft("planifica"));
    await act(async () => chat!.submit());
    await tick();
    await act(async () => chat!.reportVisualState(A, "picked B"));
    const turnId = chat!.turns.at(-1)!.id;
    await act(async () => void (await chat!.answerQuestion(turnId, chat!.turns.at(-1)!.pendingQuestions ?? [], [{ id: "q1", selected: ["48 horas"] }])));
    await tick();
    expect(calls.answers[0]!.visualStates).toEqual([{ widgetId: A, state: "picked B" }]);
    await act(async () => calls.release());
    await tick();
  });
});
