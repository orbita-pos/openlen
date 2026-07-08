import { describe, expect, it } from "vitest";
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { runAgentLoop, type AgentStreamEvent } from "./loop";

function scripted(...turns: StreamEvent[][]): (messages: Message[]) => AsyncIterable<StreamEvent> {
  let i = 0;
  return () => {
    const turn = turns[Math.min(i, turns.length - 1)];
    i += 1;
    return (async function* () { for (const ev of turn) yield ev; })();
  };
}

const done: StreamEvent = { type: "done", stopReason: { kind: "end_turn" } };
const usage = (o: number): StreamEvent => ({ type: "usage", inputTokens: 100, outputTokens: o });

describe("runAgentLoop", () => {
  it("text-only turn finishes without tools", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hola" }], tools: [],
      openStream: scripted([{ type: "text_delta", text: "¡Hola!" }, usage(5), done]),
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
    });
    expect(r.finalText).toBe("¡Hola!");
    expect(r.toolCalls).toBe(0);
    expect(events.some((e) => e.type === "text")).toBe(true);
  });

  it("one tool call → functionResponse turn → final text", async () => {
    const events: AgentStreamEvent[] = [];
    const seen: string[] = [];
    const callsSeen: Message[][] = [];
    const scriptedStream = scripted(
      [{ type: "function_call", name: "activar_modulo", args: { modulo: "members" }, thoughtSignature: "sig-1" }, usage(10), done],
      [{ type: "text_delta", text: "Listo, activé cuentas." }, usage(8), done],
    );
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "ponme signin" }], tools: [],
      openStream: (messages) => {
        callsSeen.push([...messages]); // snapshot — `messages` is mutated in place by the loop
        return scriptedStream(messages);
      },
      runTool: async (name) => { seen.push(name); return { response: { ok: true }, action: { tool: name, ok: true, summary: "members" } }; },
      emit: (e) => events.push(e),
    });
    expect(seen).toEqual(["activar_modulo"]);
    expect(r.finalText).toContain("Listo");
    expect(r.usage.outputTokens).toBe(18);
    // Happy multi-turn (tool call + final text) charges credits — F2-T9.
    expect(r.terminalError).toBe(false);
    const actions = events.filter((e) => e.type === "action");
    expect(actions.map((a: any) => a.status)).toEqual(["running", "done"]);

    expect(callsSeen).toHaveLength(2);
    const secondCallMessages = callsSeen[1];
    expect(secondCallMessages.length).toBeGreaterThan(callsSeen[0].length);
    const assistantTurn = secondCallMessages.find((m) => m.role === "assistant");
    expect(assistantTurn?.functionCalls?.[0]?.thoughtSignature).toBe("sig-1");
    const functionResponseTurn = secondCallMessages.find((m) => m.functionResponses);
    expect(functionResponseTurn).toBeDefined();
  });

  it("tool failure flows back as data and the loop continues", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, done],
        [{ type: "text_delta", text: "No pude, el elemento ya no existe." }, done],
      ),
      runTool: async () => ({ response: { ok: false, error: "target missing" } }),
      emit: (e) => events.push(e),
    });
    expect(r.finalText).toContain("No pude");
    expect(events.some((e) => e.type === "error")).toBe(false);
    // A tool's {ok:false} is data, not a terminal error — the turn completed
    // cleanly and still charges credits (F2-T9 billing ruling).
    expect(r.terminalError).toBe(false);
  });

  it("caps runaway loops at maxTurns", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxTurns: 3,
      openStream: scripted([{ type: "function_call", name: "leer_estado", args: {} }, done]),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    expect(r.turns).toBe(3);
    expect(events.some((e) => e.type === "error")).toBe(true);
    // Hitting the maxTurns cap is a terminal error — 0 credits (F2-T9).
    expect(r.terminalError).toBe(true);
    // F2-T10: coded so the panel can localize instead of showing raw Spanish.
    const err = events.find((e) => e.type === "error") as { message: string; code?: string };
    expect(err.code).toBe("turn_limit");
    expect(err.message).toContain("límite de pasos");
  });

  it("caps runaway loops at maxToolCalls", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxToolCalls: 1,
      openStream: scripted(
        [{ type: "function_call", name: "leer_estado", args: {} }, { type: "function_call", name: "leer_estado", args: {} }, done],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    expect(r.toolCalls).toBe(1);
    expect(events.some((e) => e.type === "error")).toBe(true);
    // Hitting the maxToolCalls cap is also a terminal error — 0 credits.
    expect(r.terminalError).toBe(true);
    const err = events.find((e) => e.type === "error") as { message: string; code?: string };
    expect(err.code).toBe("tool_limit");
    expect(err.message).toContain("límite de pasos");
  });

  it("surfaces an error and stops the loop when a turn truncates at max_tokens", async () => {
    const events: AgentStreamEvent[] = [];
    let opened = 0;
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: () => {
        opened += 1;
        return (async function* () {
          yield { type: "text_delta", text: "empeza" } as StreamEvent;
          yield { type: "usage", inputTokens: 100, outputTokens: 20 } as StreamEvent;
          yield { type: "done", stopReason: { kind: "max_tokens" } } as StreamEvent;
        })();
      },
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
    });
    // The truncated turn stops the loop after exactly one openStream call.
    expect(opened).toBe(1);
    expect(r.turns).toBe(1);
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toContain("espacio");
    // Accumulated usage is still returned rather than discarded.
    expect(r.usage.outputTokens).toBe(20);
    // A truncated (max_tokens) turn is a terminal error — 0 credits (F2-T9).
    expect(r.terminalError).toBe(true);
    expect((err as { code?: string }).code).toBe("truncated");
  });

  it("surfaces an error and stops the loop when a turn is cancelled", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted([
        { type: "text_delta", text: "..." },
        { type: "done", stopReason: { kind: "cancelled" } },
      ]),
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
    });
    expect(r.turns).toBe(1);
    expect(events.some((e) => e.type === "error")).toBe(true);
    // A cancelled turn is a terminal error — 0 credits (F2-T9).
    expect(r.terminalError).toBe(true);
    const err = events.find((e) => e.type === "error") as { message: string; code?: string };
    expect(err.code).toBe("cancelled");
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("surfaces an error and stops the loop when a turn's stopReason is an upstream error", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted([
        { type: "text_delta", text: "..." },
        { type: "done", stopReason: { kind: "error", error: "upstream 503" } },
      ]),
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
    });
    expect(r.turns).toBe(1);
    expect(r.terminalError).toBe(true);
    const err = events.find((e) => e.type === "error") as { message: string; code?: string };
    expect(err.code).toBe("upstream");
    expect(err.message).toBe("upstream 503");
  });

  it("a confirm outcome emits a confirm event, feeds the model esperando_confirmacion, and continues", async () => {
    const events: AgentStreamEvent[] = [];
    const callsSeen: Message[][] = [];
    const stream = scripted(
      [{ type: "function_call", name: "publicar", args: { subdominio: "mi-negocio" } }, done],
      [{ type: "text_delta", text: "Preparé la publicación. Toca Publicar para confirmar." }, done],
    );
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "publica mi-negocio" }], tools: [],
      openStream: (messages) => {
        callsSeen.push([...messages]);
        return stream(messages);
      },
      // The tool NEVER publishes — it returns a confirm payload the user must tap.
      runTool: async () => ({
        response: { ok: true },
        action: { tool: "publicar", ok: true, summary: "mi-negocio" },
        confirm: { action: "publicar", subdominio: "mi-negocio", idiomas: ["es"], republicar: false },
      }),
      emit: (e) => events.push(e),
    });

    const confirmEv = events.find((e) => e.type === "confirm");
    expect(confirmEv).toMatchObject({
      type: "confirm",
      action: "publicar",
      subdominio: "mi-negocio",
      idiomas: ["es"],
      republicar: false,
    });
    // The loop keeps going after the confirm — the model closes the turn.
    expect(r.finalText).toContain("Publicar");

    // The functionResponse the model saw is the fixed waiting state, NOT the
    // tool's raw response — so the model closes its turn asking for the tap.
    const second = callsSeen[1];
    const frTurn = second.find((m) => m.functionResponses);
    const fr = (frTurn as { functionResponses: { name: string; response: Record<string, unknown> }[] })
      .functionResponses[0];
    expect(fr.name).toBe("publicar");
    expect(fr.response.ok).toBe(true);
    expect(fr.response.estado).toBe("esperando_confirmacion_del_usuario");
    // A turn that ends waiting on a confirm card still finishes clean —
    // charges credits (F2-T9); it's the model's own end_turn, not an error.
    expect(r.terminalError).toBe(false);
  });

  it("emits html events when a tool updates the doc", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, done],
        [{ type: "text_delta", text: "Hecho." }, done],
      ),
      runTool: async () => ({ response: { ok: true }, updatedHtml: "<!doctype html><html><body>new</body></html>" }),
      emit: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === "html")).toBe(true);
  });
});
