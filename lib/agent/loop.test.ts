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
const usage = (o: number, cached = 0): StreamEvent => ({
  type: "usage",
  inputTokens: 100,
  outputTokens: o,
  cachedTokens: cached,
});

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
      [{ type: "function_call", name: "activar_modulo", args: { modulo: "members" }, thoughtSignature: "sig-1" }, usage(10, 30), done],
      [{ type: "text_delta", text: "Listo, activé cuentas." }, usage(8, 20), done],
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
    // Cached tokens sum across turns just like input/output — F3-T2.
    expect(r.usage.cachedTokens).toBe(50);
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
    // editar_pagina is a mutating tool — leer_estado/elegir_foto are read-only
    // and exempt from maxTurns, so they'd defeat this test's premise.
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxTurns: 3,
      openStream: scripted([{ type: "function_call", name: "editar_pagina", args: {} }, done]),
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

  it("read-only-only turns (photo hunts / state reads) don't count toward maxTurns", async () => {
    // Repro of the terror-hero bug: the model spent every turn calling the
    // read-only elegir_foto and died on turn_limit before it ever edited.
    // Read-only tools are exempt from maxToolCalls (F3-T5) — they must be
    // exempt from maxTurns too, or the turn cap defeats that exemption. Only
    // ABSOLUTE_MAX_TOOL_CALLS bounds a pure read-only chain.
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hero de terror" }], tools: [], maxTurns: 2,
      openStream: scripted(
        [{ type: "function_call", name: "elegir_foto", args: {} }, done],
        [{ type: "function_call", name: "elegir_foto", args: {} }, done],
        [{ type: "function_call", name: "leer_estado", args: {} }, done],
        [{ type: "text_delta", text: "No hay fotos de terror; oscurecí el tema." }, done],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    // Three read-only turns with maxTurns:2 — the old code died with a
    // turn_limit error on turn 3; now it runs to the closing text turn.
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(r.finalText).toContain("oscurecí");
    expect(r.terminalError).toBe(false);
  });

  it("a turn that mixes read-only and mutating calls still counts toward maxTurns", async () => {
    // The exemption is only for turns that did NOTHING but read — a turn that
    // also mutated (editar_pagina) is a real step and must be counted.
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxTurns: 2,
      openStream: scripted([
        { type: "function_call", name: "elegir_foto", args: {} },
        { type: "function_call", name: "editar_pagina", args: {} },
        done,
      ]),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    const err = events.find((e) => e.type === "error") as { code?: string } | undefined;
    expect(err?.code).toBe("turn_limit");
    expect(r.terminalError).toBe(true);
  });

  it("caps runaway loops at maxToolCalls", async () => {
    const events: AgentStreamEvent[] = [];
    // editar_pagina is a budgeted (non-read-only) tool — leer_estado/elegir_foto
    // are exempt from maxToolCalls (F3-T5) so they'd defeat this test's premise.
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxToolCalls: 1,
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, { type: "function_call", name: "editar_pagina", args: {} }, done],
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

  it("F3-T5: read-only tools (elegir_foto) don't count toward maxToolCalls — a photo hunt doesn't burn the budget", async () => {
    const events: AgentStreamEvent[] = [];
    const seen: string[] = [];
    const photoCalls: StreamEvent[] = Array.from({ length: 12 }, (): StreamEvent => ({
      type: "function_call",
      name: "elegir_foto",
      args: {},
    }));
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "ponme fotos" }], tools: [], maxToolCalls: 10,
      openStream: scripted(
        [
          ...photoCalls,
          { type: "function_call", name: "editar_pagina", args: {} },
          { type: "function_call", name: "activar_modulo", args: { modulo: "chat" } },
          done,
        ],
        [{ type: "text_delta", text: "Listo, puse las fotos." }, done],
      ),
      runTool: async (name) => { seen.push(name); return { response: { ok: true } }; },
      emit: (e) => events.push(e),
    });
    // All 14 calls actually ran — the 12 elegir_foto ones just didn't count
    // against the 10-call budget, which only the 2 non-exempt calls touch.
    expect(seen).toHaveLength(14);
    expect(seen.filter((n) => n === "elegir_foto")).toHaveLength(12);
    expect(r.finalText).toBe("Listo, puse las fotos.");
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(r.terminalError).toBe(false);
  });

  it("F3-T5: an absolute cap of 20 total tool calls still terminates a runaway loop, mixing exempt and budgeted tools", async () => {
    const events: AgentStreamEvent[] = [];
    const seen: string[] = [];
    // 21 calls in one turn, alternating exempt (elegir_foto) and budgeted
    // (editar_pagina) — 11 exempt + 10 budgeted. The 10 budgeted calls never
    // reach maxToolCalls's own trip point on their own turn ordering here;
    // it's the ABSOLUTE cap (20, counts everything) that must stop the 21st.
    const calls: StreamEvent[] = Array.from({ length: 21 }, (_, i): StreamEvent => ({
      type: "function_call",
      name: i % 2 === 0 ? "elegir_foto" : "editar_pagina",
      args: {},
    }));
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted([...calls, done]),
      runTool: async (name) => { seen.push(name); return { response: { ok: true } }; },
      emit: (e) => events.push(e),
    });
    // Only 20 of the 21 scripted calls actually ran before the absolute cap
    // stopped the loop.
    expect(seen).toHaveLength(20);
    expect(r.toolCalls).toBe(20);
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(r.terminalError).toBe(true);
    const err = events.find((e) => e.type === "error") as { message: string; code?: string };
    expect(err.code).toBe("tool_limit");
  });

  it("A: hitting a cap with a closeOut streams a graceful summary instead of a red error", async () => {
    // Graceful termination: when the step budget runs out, the turn should end
    // with a "here's what I did / what's pending" message (emitted as normal
    // text so the panel renders a normal assistant turn), NOT a red error card.
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "haz muchas cosas" }], tools: [], maxTurns: 1,
      openStream: scripted([{ type: "function_call", name: "editar_pagina", args: {} }, done]),
      closeOut: scripted([
        { type: "text_delta", text: "Llegué a mi límite de pasos. Cambié el título; me faltó el resto — pídemelo de nuevo." },
        usage(12),
        done,
      ]),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    // No red error — the cap produced a closing message instead.
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(r.finalText).toContain("límite de pasos");
    // Still a terminal (0-credit) turn for billing — just gracefully closed.
    expect(r.terminalError).toBe(true);
  });

  it("A: a closeOut that yields no text falls back to the coded error", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxTurns: 1,
      openStream: scripted([{ type: "function_call", name: "editar_pagina", args: {} }, done]),
      closeOut: scripted([done]), // no text_delta
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    const err = events.find((e) => e.type === "error") as { code?: string } | undefined;
    expect(err?.code).toBe("turn_limit");
    expect(r.terminalError).toBe(true);
  });

  it("B: refuses an identical MUTATING call that keeps failing, instead of looping on it", async () => {
    // No-progress guard: the same editar_pagina (identical args) that returns
    // ok:false twice is refused the 3rd time — the model gets a nudge to change
    // approach rather than burning the budget repeating a dead action.
    const events: AgentStreamEvent[] = [];
    const seen: string[] = [];
    const failArgs = { edits: [{ op: "replace", target: "op-stale", new_html: "<p>x</p>" }], resumen: "z" };
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [
          { type: "function_call", name: "editar_pagina", args: failArgs },
          { type: "function_call", name: "editar_pagina", args: failArgs },
          { type: "function_call", name: "editar_pagina", args: failArgs },
          { type: "function_call", name: "editar_pagina", args: failArgs },
          done,
        ],
        [{ type: "text_delta", text: "Cambio de enfoque." }, done],
      ),
      runTool: async (name) => { seen.push(name); return { response: { ok: false, error: "target missing" } }; },
      emit: (e) => events.push(e),
    });
    // Only 2 identical failing calls actually ran; the 3rd and 4th were refused.
    expect(seen).toEqual(["editar_pagina", "editar_pagina"]);
    expect(r.finalText).toContain("enfoque");
  });

  it("B: does NOT block an identical call that SUCCEEDS (only failing repeats are guarded)", async () => {
    const seen: string[] = [];
    const okArgs = { edits: [{ op: "replace", target: "op-1", new_html: "<p>y</p>" }], resumen: "z" };
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [
          { type: "function_call", name: "editar_pagina", args: okArgs },
          { type: "function_call", name: "editar_pagina", args: okArgs },
          { type: "function_call", name: "editar_pagina", args: okArgs },
          done,
        ],
        [{ type: "text_delta", text: "Listo." }, done],
      ),
      runTool: async (name) => { seen.push(name); return { response: { ok: true } }; },
      emit: () => {},
    });
    // All 3 ran — a succeeding call is never treated as a no-progress loop.
    expect(seen).toEqual(["editar_pagina", "editar_pagina", "editar_pagina"]);
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
          yield { type: "usage", inputTokens: 100, outputTokens: 20, cachedTokens: 0 } as StreamEvent;
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

  // F4-T4: html gains `page` — the ONLY SSE protocol change this task makes.
  // A tool outcome with no `page` (e.g. a fixture that predates F4) defaults
  // to home (null) rather than surfacing `undefined` to the panel.
  it("F4-T4: html event with an explicit page (subpage write) carries it verbatim", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, done],
        [{ type: "text_delta", text: "Hecho." }, done],
      ),
      runTool: async () => ({
        response: { ok: true },
        updatedHtml: "<!doctype html><html><body>menu</body></html>",
        page: "menu",
      }),
      emit: (e) => events.push(e),
    });
    const html = events.find((e) => e.type === "html") as { html: string; page: string | null };
    expect(html.page).toBe("menu");
  });

  it("F4-T4: html event with no page on the outcome defaults to home (null), not undefined", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, done],
        [{ type: "text_delta", text: "Hecho." }, done],
      ),
      runTool: async () => ({ response: { ok: true }, updatedHtml: "<!doctype html><html><body>home</body></html>" }),
      emit: (e) => events.push(e),
    });
    const html = events.find((e) => e.type === "html") as { html: string; page: string | null };
    expect(html.page).toBeNull();
  });

  it("F4-T4: a mid-turn trabajar_en_pagina switch means later html events carry the NEW page, not the turn's starting one", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [
          { type: "function_call", name: "editar_pagina", args: {} },
          { type: "function_call", name: "trabajar_en_pagina", args: { pagina: "menu" } },
          { type: "function_call", name: "editar_pagina", args: {} },
          done,
        ],
        [{ type: "text_delta", text: "Listo, cambié ambos." }, done],
      ),
      runTool: async (name) => {
        if (name === "trabajar_en_pagina") return { response: { ok: true, pagina_activa: "menu" } };
        // First editar_pagina call writes home (page: null); the second — after
        // the switch — writes menu. A real runAgentTool derives this from
        // session.page; the script just plays back what that would produce.
        const page = name === "editar_pagina" && events.some((e) => e.type === "html") ? "menu" : null;
        return { response: { ok: true }, updatedHtml: `<!doctype html><html><body>${page ?? "home"}</body></html>`, page };
      },
      emit: (e) => events.push(e),
    });
    const htmlEvents = events.filter((e) => e.type === "html") as { html: string; page: string | null }[];
    expect(htmlEvents).toHaveLength(2);
    expect(htmlEvents[0].page).toBeNull();
    expect(htmlEvents[1].page).toBe("menu");
  });
});

// ── F5 — verificación visual (los ojos del agente) ─────────────────────────
describe("runAgentLoop — verifyTurn", () => {
  const editThenClose = () =>
    scripted(
      [{ type: "function_call", name: "editar_pagina", args: { resumen: "hero" } }, done],
      [{ type: "text_delta", text: "Listo, cambié el hero." }, done],
      [{ type: "text_delta", text: "Arreglado el contraste." }, done],
    );
  const okEdit = async () => ({
    response: { ok: true },
    updatedHtml: "<!doctype html><html><body>v2</body></html>",
  });

  it("NO verifica un turno sin mutaciones", async () => {
    let verifies = 0;
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hola" }], tools: [],
      openStream: scripted([{ type: "text_delta", text: "¡Hola!" }, done]),
      runTool: async () => { throw new Error("no tools"); },
      verifyTurn: async () => { verifies++; return { ok: true }; },
      emit: () => {},
    });
    expect(verifies).toBe(0);
    expect(r.finalText).toBe("¡Hola!");
  });

  it("verifica tras mutar; ok → cierra con la card en 'ok'", async () => {
    const events: AgentStreamEvent[] = [];
    let sawHtml: string | null = null;
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: editThenClose(),
      runTool: okEdit,
      verifyTurn: async ({ html }) => { sawHtml = html; return { ok: true }; },
      emit: (e) => events.push(e),
    });
    expect(sawHtml).toContain("v2"); // verifica el HTML MUTADO, no el original
    expect(r.finalText).toContain("Listo");
    const verify = events.filter((e) => e.type === "action" && (e as any).tool === "verificar_diseno");
    expect(verify.map((v: any) => [v.status, v.summary])).toEqual([["running", ""], ["done", "ok"]]);
  });

  it("rotura → inyecta la crítica y el modelo recibe UN ciclo de arreglo", async () => {
    const events: AgentStreamEvent[] = [];
    const streams: Message[][] = [];
    let verifies = 0;
    const stream = editThenClose();
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: (msgs) => { streams.push([...msgs]); return stream(msgs); },
      runTool: okEdit,
      verifyTurn: async () => {
        verifies++;
        return { ok: false, critique: "- el hero quedó con texto encimado" };
      },
      emit: (e) => events.push(e),
    });
    // Una sola verificación por request, aunque el ciclo de arreglo vuelva a cerrar.
    expect(verifies).toBe(1);
    // El tercer stream vio la instrucción de arreglo como último mensaje user.
    const fixMessages = streams[2];
    const lastUser = [...fixMessages].reverse().find((m) => m.role === "user");
    expect(lastUser?.content).toContain("verificación visual automática");
    expect(lastUser?.content).toContain("texto encimado");
    // El cierre final es el texto del ciclo de arreglo.
    expect(r.finalText).toContain("Arreglado");
    expect(r.terminalError).toBe(false);
    const verify = events.filter((e) => e.type === "action" && (e as any).tool === "verificar_diseno");
    expect(verify.map((v: any) => v.summary)).toEqual(["", "issues"]);
  });

  it("sin presupuesto para arreglar, NO verifica (encontrar sin poder arreglar no sirve)", async () => {
    let verifies = 0;
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, done],
        [{ type: "text_delta", text: "Listo." }, done],
      ),
      runTool: okEdit,
      verifyTurn: async () => { verifies++; return { ok: false, critique: "- roto" }; },
      maxTurns: 1, // el único turno mutante agotó el tope
      emit: () => {},
    });
    expect(verifies).toBe(0);
  });

  it("un verifyTurn que revienta es fail-open — el turno cierra normal", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: editThenClose(),
      runTool: okEdit,
      verifyTurn: async () => { throw new Error("chrome murió"); },
      emit: () => {},
    });
    expect(r.finalText).toContain("Listo");
    expect(r.terminalError).toBe(false);
  });

  it("sin verifyTurn el comportamiento es idéntico al de antes", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: editThenClose(),
      runTool: okEdit,
      emit: (e) => events.push(e),
    });
    expect(r.finalText).toContain("Listo");
    expect(events.some((e) => e.type === "action" && (e as any).tool === "verificar_diseno")).toBe(false);
  });
});
