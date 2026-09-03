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
  thinkingTokens: 0,
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

  // 🔴 BUSCAR TAMPOCO GASTA PRESUPUESTO — 2026-09-01.
  //
  // El turno que justifica `buscar_en_pagina` es «cambia el teléfono» sobre un
  // dato repetido en tres páginas: buscar + (mudarse + editar) × 3. Si la
  // búsqueda descontara del presupuesto de ediciones, la herramienta que existe
  // para no dejar el dato viejo a medias sería la que hace que el turno se
  // quede sin cuerda antes de terminar — el mismo fallo que ya se midió con las
  // fotos, justo aquí arriba.
  it("buscar_en_pagina tampoco cuenta: buscar y luego arreglar las tres páginas cabe", async () => {
    const seen: string[] = [];
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cambia el teléfono" }], tools: [], maxToolCalls: 6,
      openStream: scripted(
        [
          { type: "function_call", name: "buscar_en_pagina", args: { texto: "600112233" } },
          { type: "function_call", name: "editar_pagina", args: {} },
          { type: "function_call", name: "trabajar_en_pagina", args: { pagina: "nosotros" } },
          { type: "function_call", name: "editar_pagina", args: {} },
          { type: "function_call", name: "trabajar_en_pagina", args: { pagina: "contacto" } },
          { type: "function_call", name: "editar_pagina", args: {} },
          done,
        ],
        [{ type: "text_delta", text: "Cambiado en las tres páginas." }, done],
      ),
      runTool: async (name) => { seen.push(name); return { response: { ok: true } }; },
      emit: (e) => events.push(e),
    });
    // Las seis corrieron: sólo las cinco no exentas tocan el presupuesto de 6.
    expect(seen).toHaveLength(6);
    expect(seen[0]).toBe("buscar_en_pagina");
    expect(r.finalText).toBe("Cambiado en las tres páginas.");
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
    // Y ESTE ES EL FINAL MENOS VISIBLE DE TODOS: cierre elegante = ningún evento
    // `error`, así que quien mire los eventos ve un turno terminal sin código y
    // sin mensaje. `topeAlcanzado` es lo único que dice qué pasó. Sin él, la
    // batería del Agente reportaba «terminó en error terminal» a secas y
    // averiguar cuál de los dos había sido costaba otra corrida pagada.
    expect(r.topeAlcanzado).toBe("turn_limit");
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
    // Por el otro camino de finishOnCap el código también viaja al resultado.
    expect(r.topeAlcanzado).toBe("turn_limit");
  });

  // BRAZO DE CONTROL de las dos de arriba. Sin esto, `topeAlcanzado` podría
  // devolver un tope SIEMPRE y las dos pruebas anteriores seguirían verdes —
  // y entonces la batería etiquetaría de «se quedó sin cuerda» turnos que de
  // verdad reventaron, que es el error contrario y del mismo tamaño.
  it("A: un turno que REVIENTA no se etiqueta como tope agotado", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxTurns: 6,
      openStream: scripted([{ type: "done", stopReason: { kind: "max_tokens" } }]),
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
    });
    expect(r.terminalError).toBe(true);
    expect(r.topeAlcanzado).toBeNull();
  });

  it("A: y un turno limpio tampoco", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxTurns: 6,
      openStream: scripted([{ type: "text_delta", text: "listo" }, done]),
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
    });
    expect(r.terminalError).toBe(false);
    expect(r.topeAlcanzado).toBeNull();
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
          yield { type: "usage", inputTokens: 100, outputTokens: 20, cachedTokens: 0, thinkingTokens: 0 } as StreamEvent;
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

// ── declarar_tareas: la lista, pasada por la EVIDENCIA ──────────────────────
//
// 🔴 El fallo de los turnos largos: hacer la primera, perder el hilo a la
// tercera y cerrar enumerando las tres como hechas. No hace falta que el modelo
// mienta — basta con que se despiste, y bastaba con que UNA llamada saliera bien
// para que el texto final hablara en plural.
describe("runAgentLoop — declarar_tareas", () => {
  const declara = (n: number) => ({
    type: "function_call" as const,
    name: "declarar_tareas",
    args: { tareas: Array.from({ length: n }, (_, i) => `tarea ${i + 1}`) },
  });
  const edita = { type: "function_call" as const, name: "editar_pagina", args: {} };

  /** El doble: `declarar_tareas` devuelve la lista, `editar_pagina` cambia algo
   *  de verdad, y `leer_estado` sale bien SIN cambiar nada — que es justo el
   *  `ok:true` que no debe contar como evidencia. */
  const runTool = async (name: string, args: Record<string, unknown>) => {
    if (name === "declarar_tareas") return { response: { ok: true }, tareas: args.tareas as string[] };
    if (name === "editar_pagina") {
      return {
        response: { ok: true, cambio: "cambio" },
        updatedHtml: "<!doctype html><html><body>v2</body></html>",
      };
    }
    return { response: { ok: true } };
  };

  it("con evidencia para todas, cierra sin decir nada", async () => {
    const streams: Message[][] = [];
    const stream = scripted(
      [declara(2), edita, edita, done],
      [{ type: "text_delta", text: "Hechas las dos." }, done],
    );
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "dos cosas" }], tools: [],
      openStream: (m) => { streams.push([...m]); return stream(m); },
      runTool,
      emit: () => {},
    });
    expect(r.finalText).toBe("Hechas las dos.");
    expect(streams.length).toBe(2); // sin vuelta extra
  });

  it("🔴 si falta evidencia, no le deja cerrar: se le nombran las que faltan", async () => {
    const streams: Message[][] = [];
    const stream = scripted(
      [declara(3), edita, done],
      [{ type: "text_delta", text: "Listo, hice las tres." }, done],
      [edita, edita, done],
      [{ type: "text_delta", text: "Ahora sí las tres." }, done],
    );
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "tres cosas" }], tools: [],
      openStream: (m) => { streams.push([...m]); return stream(m); },
      runTool,
      emit: () => {},
    });
    const reclamo = [...streams[2]!].reverse().find((m) => m.role === "user")!.content;
    expect(reclamo).toContain("declaraste 3");
    expect(reclamo).toContain("1 cambio");
    // Por su NOMBRE, no «faltan dos»: el modelo tiene que saber cuáles.
    expect(reclamo).toContain("«tarea 2»");
    expect(reclamo).toContain("«tarea 3»");
    expect(r.finalText).toBe("Ahora sí las tres.");
  });

  it("un ok:true que no cambió nada NO es evidencia", async () => {
    const streams: Message[][] = [];
    const stream = scripted(
      // Dos lecturas que salen bien y no mueven un byte.
      [declara(2), { type: "function_call", name: "leer_estado", args: {} }, { type: "function_call", name: "leer_estado", args: {} }, done],
      [{ type: "text_delta", text: "Listo." }, done],
      [edita, edita, done],
      [{ type: "text_delta", text: "Hechas." }, done],
    );
    await runAgentLoop({
      messages: [{ role: "user", content: "dos cosas" }], tools: [],
      openStream: (m) => { streams.push([...m]); return stream(m); },
      runTool,
      emit: () => {},
    });
    const reclamo = [...streams[2]!].reverse().find((m) => m.role === "user")!.content;
    expect(reclamo).toContain("0 cambio");
  });

  it("se reclama UNA vez: si vuelve a cerrar sin completarla, se le deja", async () => {
    const streams: Message[][] = [];
    const stream = scripted(
      [declara(3), edita, done],
      [{ type: "text_delta", text: "Hechas." }, done],
      [{ type: "text_delta", text: "Dos quedaron pendientes, te lo digo." }, done],
    );
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "tres cosas" }], tools: [],
      openStream: (m) => { streams.push([...m]); return stream(m); },
      runTool,
      emit: () => {},
    });
    // Tres streams, no cuatro: insistir dos veces es quemarle el presupuesto al
    // usuario en una discusión.
    expect(streams.length).toBe(3);
    expect(r.finalText).toContain("pendientes");
    expect(r.terminalError).toBe(false);
  });

  it("sin presupuesto para terminarlas, NO se reclama", async () => {
    const streams: Message[][] = [];
    const stream = scripted(
      [declara(3), edita, done],
      [{ type: "text_delta", text: "Hechas." }, done],
    );
    const r = await runAgentLoop({
      // El presupuesto de acciones se agota con la única edición del primer
      // turno. (`maxTurns: 1` no serviría: mataría el turno entero antes de
      // llegar al cierre, que es otro camino.)
      messages: [{ role: "user", content: "tres cosas" }], tools: [], maxToolCalls: 1,
      openStream: (m) => { streams.push([...m]); return stream(m); },
      runTool,
      emit: () => {},
    });
    // Pedirle que termine algo que ya no puede hacer es gastarle una vuelta al
    // usuario para llegar al mismo sitio.
    expect(streams.length).toBe(2);
    expect(r.finalText).toBe("Hechas.");
  });

  it("declarar no gasta presupuesto de acciones", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "dos cosas" }], tools: [], maxToolCalls: 2,
      openStream: scripted(
        [declara(2), edita, edita, done],
        [{ type: "text_delta", text: "Hechas." }, done],
      ),
      runTool,
      emit: () => {},
    });
    // Con `declarar_tareas` contando, las dos ediciones habrían reventado el
    // tope de 2 y el turno cerraría en rojo.
    expect(r.finalText).toBe("Hechas.");
    expect(r.terminalError).toBe(false);
  });
});

// ── preguntar: la parada la ejecuta el SERVIDOR ─────────────────────────────
//
// 🔴 «Esto lo decide el usuario» viajaba como `ok:false` con una ORDEN dentro
// —«NO vuelvas a llamar a publicar en este turno; termina preguntándole»— más un
// flag de sesión para cazarle si la desobedecía. Está MEDIDO que la desobedecía:
// con un ejemplo en el texto reclamaba «mi-negocio» 3 de 3 veces, y sin ejemplo
// se inventaba el nombre del contexto. Pedirle a un modelo que se pare y luego
// vigilar si se paró son las dos mitades del mismo parche.
describe("runAgentLoop — preguntar", () => {
  it("una pregunta CIERRA el turno, aunque el modelo tuviera más que decir", async () => {
    const seen: string[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "publícala" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "preguntar", args: { texto: "¿Qué dirección quieres?" } }, done],
        // Este segundo stream NO debe llegar a abrirse: el turno terminó.
        [{ type: "function_call", name: "publicar", args: { subdominio: "mi-negocio" } }, done],
      ),
      runTool: async (name, args) => {
        seen.push(name);
        return name === "preguntar"
          ? { response: { ok: true }, pregunta: String(args.texto) }
          : { response: { ok: true } };
      },
      emit: () => {},
    });
    expect(seen).toEqual(["preguntar"]);
    expect(r.finalText).toBe("¿Qué dirección quieres?");
    expect(r.terminalError).toBe(false);
  });

  it("y el usuario la LEE: se emite como texto", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "publícala" }], tools: [],
      openStream: scripted([
        { type: "function_call", name: "preguntar", args: { texto: "¿Qué dirección quieres?" } },
        done,
      ]),
      runTool: async (_n, args) => ({ response: { ok: true }, pregunta: String(args.texto) }),
      emit: (e) => events.push(e),
    });
    const textos = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text);
    expect(textos.join("")).toContain("¿Qué dirección quieres?");
  });

  it("no la dice DOS veces cuando el modelo ya la escribió en su prosa", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "publícala" }], tools: [],
      openStream: scripted([
        { type: "text_delta", text: "Claro. ¿Qué dirección quieres?" },
        { type: "function_call", name: "preguntar", args: { texto: "¿Qué dirección quieres?" } },
        done,
      ]),
      runTool: async (_n, args) => ({ response: { ok: true }, pregunta: String(args.texto) }),
      emit: (e) => events.push(e),
    });
    const textos = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text);
    // Una sola vez: la del propio modelo.
    expect(textos.join("").split("¿Qué dirección quieres?")).toHaveLength(2);
  });

  it("🔴 la tanda se termina de correr: una edición y una pregunta en la misma vuelta NO pierde la edición", async () => {
    const events: AgentStreamEvent[] = [];
    const seen: string[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero y publícala" }], tools: [],
      openStream: scripted([
        { type: "function_call", name: "editar_pagina", args: {} },
        { type: "function_call", name: "preguntar", args: { texto: "¿Y la dirección?" } },
        done,
      ]),
      runTool: async (name, args) => {
        seen.push(name);
        return name === "preguntar"
          ? { response: { ok: true }, pregunta: String(args.texto) }
          : { response: { ok: true }, updatedHtml: "<!doctype html><html><body>v2</body></html>" };
      },
      emit: (e) => events.push(e),
    });
    expect(seen).toEqual(["editar_pagina", "preguntar"]);
    // El lienzo recibió el cambio: cortar en seco al ver la pregunta habría
    // perdido trabajo que el usuario ya tiene delante.
    expect(events.some((e) => e.type === "html")).toBe(true);
  });

  it("preguntar no gasta presupuesto de acciones", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxToolCalls: 1,
      openStream: scripted([
        { type: "function_call", name: "editar_pagina", args: {} },
        { type: "function_call", name: "preguntar", args: { texto: "¿sí o no?" } },
        done,
      ]),
      runTool: async (name, args) =>
        name === "preguntar"
          ? { response: { ok: true }, pregunta: String(args.texto) }
          : { response: { ok: true } },
      emit: () => {},
    });
    // Con `preguntar` contando, la segunda llamada habría reventado el tope de 1
    // y el turno cerraría con un error rojo en vez de con la pregunta.
    expect(r.finalText).toBe("¿sí o no?");
    expect(r.terminalError).toBe(false);
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
      verifyTurn: async () => { verifies++; return { estado: "bien" as const }; },
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
      verifyTurn: async ({ html }) => { sawHtml = html; return { estado: "bien" as const }; },
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
        return { estado: "roto" as const, critique: "- el hero quedó con texto encimado" };
      },
      emit: (e) => events.push(e),
    });
    // DOS verificaciones: la completa que encuentra la rotura y la determinista
    // que comprueba si el arreglo arregló. Hasta el 2026-09-01 era UNA, así que
    // el ciclo de arreglo cerraba sin que nadie volviera a mirar — y la única
    // frase que el usuario recibía sobre el resultado la escribía el mismo que
    // acababa de fallar.
    expect(verifies).toBe(2);
    // El tercer stream vio la instrucción de arreglo como último mensaje user.
    const fixMessages = streams[2];
    const lastUser = [...fixMessages].reverse().find((m) => m.role === "user");
    expect(lastUser?.content).toContain("verificación visual automática");
    expect(lastUser?.content).toContain("texto encimado");
    // El cierre final es el texto del ciclo de arreglo.
    expect(r.finalText).toContain("Arreglado");
    expect(r.terminalError).toBe(false);
    const verify = events.filter((e) => e.type === "action" && (e as any).tool === "verificar_diseno");
    // La segunda vuelve a encontrar los mismos problemas (el doble devuelve
    // siempre lo mismo): no bajó, así que no hay tercera vuelta y se cierra
    // diciéndolo.
    expect(verify.map((v: any) => v.summary)).toEqual(["", "issues", "", "issues"]);
  });

  // ── LA SEGUNDA MIRADA: ¿el arreglo arregló? ────────────────────────────────
  //
  // 🔴 Se miraba UNA vez por turno: se encontraba la rotura, se le daba al
  // modelo su ciclo de arreglo, y el turno cerraba sin que nadie volviera a
  // mirar. Así que «ya está» lo decía el mismo que acababa de fallar y nadie lo
  // contrastaba — la avería que este repo persigue por su nombre.
  describe("la segunda verificación", () => {
    const dosCiclos = () =>
      scripted(
        [{ type: "function_call", name: "editar_pagina", args: { resumen: "hero" } }, done],
        [{ type: "text_delta", text: "Listo." }, done],
        [{ type: "function_call", name: "editar_pagina", args: { resumen: "contraste" } }, done],
        [{ type: "text_delta", text: "Arreglado." }, done],
        [{ type: "function_call", name: "editar_pagina", args: { resumen: "otra vez" } }, done],
        [{ type: "text_delta", text: "Ahora sí." }, done],
      );

    it("es DETERMINISTA — la primera mira con visión, la segunda no", async () => {
      const flags: (boolean | undefined)[] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "cambia el hero" }], tools: [],
        openStream: editThenClose(),
        runTool: okEdit,
        verifyTurn: async ({ soloDeterminista }) => {
          flags.push(soloDeterminista);
          return { estado: "roto" as const, critique: "- roto", problemas: 3 };
        },
        emit: () => {},
      });
      // La cara: la primera paga la llamada con visión, la segunda no. Es lo que
      // hace que comprobar el arreglo salga gratis en créditos de IA.
      expect(flags).toEqual([false, true]);
    });

    it("si el arreglo BAJÓ el número, se concede otra vuelta", async () => {
      const cuentas = [3, 1];
      let i = 0;
      const events: AgentStreamEvent[] = [];
      const r = await runAgentLoop({
        messages: [{ role: "user", content: "cambia el hero" }], tools: [],
        openStream: dosCiclos(),
        runTool: okEdit,
        verifyTurn: async () => ({
          estado: "roto" as const,
          critique: "- sigue algo",
          problemas: cuentas[i++] ?? 0,
        }),
        emit: (e) => events.push(e),
      });
      // De 3 a 1: el modelo está arreglando, así que se le deja la vuelta que le
      // queda. El cierre es el del tercer turno.
      expect(r.finalText).toContain("Ahora sí");
      expect(i).toBe(2);
    });

    it("y si NO bajó, se cierra ahí — otra vuelta sería quemar presupuesto para llegar al mismo sitio", async () => {
      const events: AgentStreamEvent[] = [];
      const r = await runAgentLoop({
        messages: [{ role: "user", content: "cambia el hero" }], tools: [],
        openStream: dosCiclos(),
        runTool: okEdit,
        // Mismo número las dos veces: el modelo oscila, no avanza.
        verifyTurn: async () => ({ estado: "roto" as const, critique: "- roto", problemas: 2 }),
        emit: (e) => events.push(e),
      });
      // Cierra con el texto del PRIMER ciclo de arreglo, no del segundo.
      expect(r.finalText).toContain("Arreglado");
      expect(r.terminalError).toBe(false);
      const verify = events.filter(
        (e) => e.type === "action" && (e as any).tool === "verificar_diseno",
      );
      // Y lo DICE: cerrar en «ok» sería el visto bueno de una página que sigue
      // rota, que es exactamente lo que no puede pasar.
      expect(verify.map((v: any) => v.summary)).toEqual(["", "issues", "", "issues"]);
    });

    // ── KEEP-BEST ────────────────────────────────────────────────────────────
    //
    // 🔴 Cerrar cuando el número no baja estaba bien; cerrar EN EL DAÑO no.
    // MEDIDO el 2026-09-02: cuatro rondas persiguiendo un contraste que el
    // medidor se había inventado dejaron la portada con media pantalla en
    // sólido tapando la foto de fachada que el usuario había pedido — y ahí se
    // quedó, porque nadie deshace. Una reparación que no repara tampoco puede
    // cobrar el daño que hizo.
    it("🔴 si el ciclo no bajó el número, DESHACE: el turno no termina peor de como empezó", async () => {
      const restaurados: { html: string; page: string | null }[] = [];
      let vez = 0;
      const r = await runAgentLoop({
        messages: [{ role: "user", content: "cambia el hero" }], tools: [],
        openStream: dosCiclos(),
        runTool: async () => {
          vez += 1;
          return {
            response: { ok: true },
            // La primera edición es la buena; la del ciclo de arreglo es la que
            // destroza. Sin keep-best, el turno cierra con ésta.
            updatedHtml:
              vez === 1
                ? "<!doctype html><html><body>BUENO</body></html>"
                : "<!doctype html><html><body>DANADO</body></html>",
          };
        },
        verifyTurn: async () => ({ estado: "roto" as const, critique: "- roto", problemas: 2 }),
        restaurarHtml: async (info) => { restaurados.push(info); },
        emit: () => {},
      });
      expect(r.terminalError).toBe(false);
      expect(restaurados).toHaveLength(1);
      expect(restaurados[0].html).toContain("BUENO");
      expect(restaurados[0].html).not.toContain("DANADO");
      expect(restaurados[0].page).toBe(null);
    });

    // BRAZO DE CONTROL: si el arreglo SÍ mejoró, no se toca nada. Sin esto, un
    // keep-best demasiado ansioso tiraría el trabajo bueno.
    it("y si el arreglo SÍ bajó el número, no deshace nada", async () => {
      const restaurados: unknown[] = [];
      let i = 0;
      await runAgentLoop({
        messages: [{ role: "user", content: "cambia el hero" }], tools: [],
        openStream: editThenClose(),
        runTool: okEdit,
        verifyTurn: async () =>
          i++ === 0
            ? { estado: "roto" as const, critique: "- contraste 1.3:1", problemas: 1 }
            : { estado: "bien" as const },
        restaurarHtml: async (info) => { restaurados.push(info); },
        emit: () => {},
      });
      expect(restaurados).toEqual([]);
    });

    // ── OBSERVAR NO ES ACUSAR ────────────────────────────────────────────────
    //
    // 🔴 PARIDAD CON CREAR, que ya aprendió esto y lo dejó escrito en
    // app/api/generate/route.ts: «El crítico informa; ya no gasta. Medido dos
    // veces: puntuó la página baja por las FOTOS —"Bolillo muestra un océano"—
    // y pidió regenerarla. […] Cada una de esas regeneraciones costaba una
    // página entera de tokens y un crédito del usuario sin arreglar nada.»
    //
    // El Agente no tenía esa regla: el juicio del crítico abría ciclo igual que
    // un TypeError. El 2026-09-02 eso costó ocho búsquedas de foto para un
    // rubro que el catálogo no cubre — una queja sobre la que el bucle no podía
    // actuar, abriendo un bucle.
    it("🔴 una observación del crítico NO abre ciclo de arreglo", async () => {
      let vueltas = 0;
      const stream = editThenClose();
      const r = await runAgentLoop({
        messages: [{ role: "user", content: "cambia el hero" }], tools: [],
        openStream: (msgs) => { vueltas += 1; return stream(msgs); },
        runTool: okEdit,
        verifyTurn: async () => ({
          estado: "observado" as const,
          notas: ["tres tarjetas muestran un rectángulo de color plano"],
        }),
        emit: () => {},
      });
      // DOS vueltas: la de la herramienta y la del texto de cierre. Una tercera
      // significaría que la observación abrió ciclo de arreglo.
      expect(vueltas).toBe(2);
      expect(r.finalText).toContain("Listo");
      expect(r.terminalError).toBe(false);
    });

    // ⚠️ Y la tarjeta cierra en «ok», no en «issues»: una observación no es una
    // rotura, y pintarla como tal le diría al usuario que su página está mal
    // cuando no lo está.
    it("la tarjeta de una observación cierra en 'ok', no en 'issues'", async () => {
      const events: AgentStreamEvent[] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "cambia el hero" }], tools: [],
        openStream: editThenClose(),
        runTool: okEdit,
        verifyTurn: async () => ({
          estado: "observado" as const,
          notas: ["tres tarjetas sin foto, con degradado"],
        }),
        emit: (e) => events.push(e),
      });
      const verify = events.filter(
        (e) => e.type === "action" && (e as any).tool === "verificar_diseno",
      );
      expect(verify.map((v: any) => v.summary)).toEqual(["", "ok"]);
    });

    // BRAZO DE CONTROL: un HECHO del navegador sigue abriendo ciclo, como
    // siempre. Sin esto, «no abre ciclo» pasaría por éxito aunque hubiéramos
    // desarmado los ojos enteros.
    it("y una rotura medida SÍ abre ciclo de arreglo", async () => {
      let vueltas = 0;
      let mirada = 0;
      const stream = editThenClose();
      await runAgentLoop({
        messages: [{ role: "user", content: "cambia el hero" }], tools: [],
        openStream: (msgs) => { vueltas += 1; return stream(msgs); },
        runTool: okEdit,
        verifyTurn: async () => {
          mirada += 1;
          return mirada === 1
            ? { estado: "roto" as const, critique: "- un TypeError mata la página", problemas: 1 }
            : { estado: "bien" as const };
        },
        emit: () => {},
      });
      expect(vueltas).toBe(3);
    });

    // Sin la dependencia inyectada el bucle se comporta byte a byte como antes:
    // no revierte, y desde luego no revienta.
    it("sin `restaurarHtml` inyectado, cierra igual que siempre", async () => {
      const r = await runAgentLoop({
        messages: [{ role: "user", content: "cambia el hero" }], tools: [],
        openStream: dosCiclos(),
        runTool: okEdit,
        verifyTurn: async () => ({ estado: "roto" as const, critique: "- roto", problemas: 2 }),
        emit: () => {},
      });
      expect(r.terminalError).toBe(false);
      expect(r.finalText).toContain("Arreglado");
    });

    it("🔴 y cuando el arreglo SÍ arregló, la tarjeta cierra en 'ok' — la prueba que no existía", async () => {
      let i = 0;
      const events: AgentStreamEvent[] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "cambia el hero" }], tools: [],
        openStream: editThenClose(),
        runTool: okEdit,
        verifyTurn: async () =>
          i++ === 0
            ? { estado: "roto" as const, critique: "- contraste 1.3:1", problemas: 1 }
            : { estado: "bien" as const },
        emit: (e) => events.push(e),
      });
      const verify = events.filter(
        (e) => e.type === "action" && (e as any).tool === "verificar_diseno",
      );
      expect(verify.map((v: any) => v.summary)).toEqual(["", "issues", "", "ok"]);
    });

    it("si la primera dio el visto bueno, NO hay segunda: no hay nada que re-comprobar", async () => {
      let verifies = 0;
      await runAgentLoop({
        messages: [{ role: "user", content: "cambia el hero" }], tools: [],
        openStream: editThenClose(),
        runTool: okEdit,
        verifyTurn: async () => { verifies++; return { estado: "bien" as const }; },
        emit: () => {},
      });
      expect(verifies).toBe(1);
    });
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
      verifyTurn: async () => { verifies++; return { estado: "roto" as const, critique: "- roto" }; },
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

  // ── NO PUDE MIRAR ≠ ESTÁ BIEN ───────────────────────────────────────────
  //
  // Los ojos fallan ABIERTOS por diseño: Chrome caído, sin key, timeout o JSON
  // malformado devuelven un veredicto benigno. Eso está bien —una verificación
  // que no arranca no puede tumbar el turno del usuario—, pero la ruta lo
  // convertía en `ok: true`, así que dentro del producto no quedaba NADA que
  // distinguiera «miré y está bien» de «no pude mirar». Con Chromium caído en
  // el box, la verificación aprobaba todo en silencio.
  it("no_mirado NO dispara ciclo de arreglo (no hay nada que arreglar)", async () => {
    let verifies = 0;
    const streams: Message[][] = [];
    const stream = editThenClose();
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: (msgs) => { streams.push([...msgs]); return stream(msgs); },
      runTool: okEdit,
      verifyTurn: async () => {
        verifies++;
        return { estado: "no_mirado" as const, motivo: "chrome no arrancó" };
      },
      emit: () => {},
    });
    expect(verifies).toBe(1);
    // Un solo par de streams: no hubo vuelta de arreglo. Cobrarle al usuario un
    // ciclo por una comprobación que no ocurrió sería peor que no comprobar.
    expect(streams.length).toBe(2);
    expect(r.finalText).toContain("Listo");
    expect(r.terminalError).toBe(false);
  });

  it("pero SÍ se dice: la tarjeta cierra en 'no-mirado', no en 'ok'", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: editThenClose(),
      runTool: okEdit,
      verifyTurn: async () => ({ estado: "no_mirado" as const, motivo: "sin key" }),
      emit: (e) => events.push(e),
    });
    const verify = events.filter(
      (e) => e.type === "action" && (e as any).tool === "verificar_diseno",
    );
    expect(verify.map((v: any) => [v.status, v.summary])).toEqual([
      ["running", ""],
      ["done", "no-mirado"],
    ]);
  });

  it("y un verifyTurn que revienta cae en no_mirado, no en el visto bueno", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: editThenClose(),
      runTool: okEdit,
      verifyTurn: async () => { throw new Error("chrome murió"); },
      emit: (e) => events.push(e),
    });
    // Sigue siendo fail-open: el turno cierra normal.
    expect(r.finalText).toContain("Listo");
    expect(r.terminalError).toBe(false);
    // Pero ya no miente sobre haber mirado.
    const verify = events.filter(
      (e) => e.type === "action" && (e as any).tool === "verificar_diseno",
    );
    expect(verify.map((v: any) => v.summary)).toEqual(["", "no-mirado"]);
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

// ─────────────────────────────────────────────────────────────────────────────
// HALLAZGO 4B — «un turno que ya mutó no puede terminar como fallo puro».
//
// Una herramienta guarda y emite html; el stream siguiente se cae (503,
// cancelado, max_tokens). El turno se pintaba ROJO, no se persistía en la
// transcripción y no dejaba Undo — con el cambio ya vivo en la base. El usuario
// pulsaba «Reintentar» y aplicaba el mismo cambio DOS veces.
//
// El Chat clásico lleva este arreglo desde el 24/08 (`cambioDurable` en
// ai-design). El bucle del Agente se quedó sin él.
describe("runAgentLoop: la mutación durable sobrevive al fallo terminal", () => {
  const errorTerminal: StreamEvent = {
    type: "done",
    stopReason: { kind: "error", error: "Gemini 503" },
  };

  it("una herramienta que escribió el documento marca mutoDurable pese al 503", async () => {
    const mutaciones: number[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cámbiame el titular" }],
      tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, usage(10), done],
        [errorTerminal],
      ),
      runTool: async (name) => ({
        response: { ok: true },
        action: { tool: name, ok: true, summary: "titular" },
        updatedHtml: "<html>nuevo</html>",
        page: null,
      }),
      emit: () => {},
      onMutacion: () => mutaciones.push(1),
    });

    expect(r.terminalError).toBe(true);
    expect(r.mutoDurable).toBe(true);
    // Una sola vez, aunque el turno mute varias: el route sólo necesita saber
    // que YA no hay vuelta atrás.
    expect(mutaciones).toHaveLength(1);
  });

  // Los cambios de AJUSTES (módulos, tema, motion, música, 3D, datos vivos) son
  // igual de durables y NO emiten html. `updatedHtml` sola los habría perdido.
  it("un cambio de AJUSTES cuenta igual, aunque no emita html", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "ponme la música" }],
      tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "poner_musica", args: {} }, usage(10), done],
        [errorTerminal],
      ),
      runTool: async (name) => ({
        response: { ok: true },
        action: { tool: name, ok: true, summary: "música" },
        mutoDurable: true,
      }),
      emit: () => {},
    });

    expect(r.terminalError).toBe(true);
    expect(r.mutoDurable).toBe(true);
  });

  it("cancelado y max_tokens se comportan igual que el 503", async () => {
    for (const stop of [
      { kind: "cancelled" as const },
      { kind: "max_tokens" as const },
    ]) {
      const r = await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: scripted(
          [{ type: "function_call", name: "editar_pagina", args: {} }, usage(10), done],
          [{ type: "done", stopReason: stop } as StreamEvent],
        ),
        runTool: async (name) => ({
          response: { ok: true },
          action: { tool: name, ok: true, summary: "s" },
          updatedHtml: "<html>nuevo</html>",
          page: null,
        }),
        emit: () => {},
      });
      expect(r.terminalError, stop.kind).toBe(true);
      expect(r.mutoDurable, stop.kind).toBe(true);
    }
  });

  // ── CONTRA-PRUEBAS ────────────────────────────────────────────────────────
  // El arreglo NO puede convertir cualquier fallo en «aplicado». Un turno que
  // sólo leyó y se cayó sigue siendo un fallo puro, y tiene que pintarse rojo.
  it("CONTRA-PRUEBA: un turno que sólo LEYÓ y se cayó no mutó nada", async () => {
    const mutaciones: number[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "¿qué tiene mi página?" }],
      tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "leer_estado", args: {} }, usage(10), done],
        [errorTerminal],
      ),
      runTool: async () => ({ response: { ok: true, resumen: "una home" } }),
      emit: () => {},
      onMutacion: () => mutaciones.push(1),
    });

    expect(r.terminalError).toBe(true);
    expect(r.mutoDurable).toBe(false);
    expect(mutaciones).toHaveLength(0);
  });

  it("CONTRA-PRUEBA: un turno limpio sigue sin ser terminal, y reporta su mutación", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cámbiame el titular" }],
      tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, usage(10), done],
        [{ type: "text_delta", text: "Listo." }, usage(5), done],
      ),
      runTool: async (name) => ({
        response: { ok: true },
        action: { tool: name, ok: true, summary: "titular" },
        updatedHtml: "<html>nuevo</html>",
        page: null,
      }),
      emit: () => {},
    });

    expect(r.terminalError).toBe(false);
    expect(r.mutoDurable).toBe(true);
  });
});

// ── ANUNCIÓ LA EDICIÓN Y NO LA HIZO ──────────────────────────────────────────
//
// 🔴 MEDIDO en producción el 2026-08-31, dos veces en tres minutos. A «agregame
// en el menu un link para ir a la page de nosotros» el modelo contestó «¡Claro!
// Agrego un enlace… El nav está en data-op-id="9"… Listo, agregué el enlace» —
// con el id CORRECTO— y no llamó a nada. 203 tokens de salida: sólo la prosa.
// El usuario vio «Listo» junto a «Nothing on the page changed» y tuvo que
// escribir «no agregaste el nosotros» para que funcionara.
describe("cierra sin llamar a nada", () => {
  it("🔴 se le insiste UNA vez, y entonces sí edita", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "agregame un link a nosotros" }],
      tools: [], maxTurns: 6,
      openStream: scripted(
        // Primera vuelta: sólo prosa, como en producción.
        [{ type: "text_delta", text: "¡Claro! Agrego el enlace. Listo." }, done],
        // Segunda: tras el empujón, la llamada de verdad.
        [{ type: "function_call", name: "editar_pagina", args: {} }, done],
        [{ type: "text_delta", text: "Ahora sí." }, done],
      ),
      runTool: async () => ({ response: { ok: true }, mutoDurable: true }),
      emit: () => {},
    });
    expect(r.toolCalls).toBe(1);
    expect(r.terminalError).toBe(false);
  });

  it("y sólo UNA: si vuelve a cerrar de vacío, el turno acaba", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxTurns: 6,
      openStream: scripted(
        [{ type: "text_delta", text: "¡Claro! Lo hago." }, done],
        [{ type: "text_delta", text: "Insisto en que ya está." }, done],
        [{ type: "text_delta", text: "no debería llegar aquí" }, done],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
    });
    expect(r.finalText).toBe("Insisto en que ya está.");
    expect(r.terminalError).toBe(false);
  });

  // 🔴 BRAZO DE CONTROL, y no es teórico: la primera versión de esto miraba
  // `mutoDurable` en vez de `toolCalls`, y una prueba que YA existía lo cazó.
  // Son cosas distintas — `activar_modulo` y `publicar` llaman a una
  // herramienta sin marcar mutación durable— así que con aquella guarda se
  // pagaba una vuelta de más al final de turnos que habían hecho su trabajo.
  it("pero a un turno que ya llamó a una herramienta no se le insiste", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxTurns: 6,
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, done],
        [{ type: "text_delta", text: "Hecho." }, done],
        [{ type: "text_delta", text: "no debería llegar aquí" }, done],
      ),
      // SIN `mutoDurable`: llamó a una herramienta y con eso basta. Si la
      // guarda vuelve a mirar la mutación en vez de la llamada, esto se pone
      // rojo — que es justo lo que tiene que pasar.
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
    });
    expect(r.finalText).toBe("Hecho.");
  });
});
