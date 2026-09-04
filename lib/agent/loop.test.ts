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
    // 🔴 Y EL RESULTADO TAMBIÉN LO DICE, no sólo el evento.
    //
    // El código viajaba al CLIENTE y se perdía de vuelta: la ruta sólo recibía
    // `terminalError: boolean`, así que su línea del diario era la misma para
    // «el dueño pulsó ■» y «Fireworks se cayó». El 2026-09-03 eso costó una
    // investigación entera — un turno abortado al remontarse el panel se
    // persiguió como si fuera un fallo del proveedor, incluida una re-corrida
    // de un documento de 206 KB para descartar el tamaño.
    expect(r.errorCode).toBe("cancelled");
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
    expect(r.errorCode, "una caída del proveedor no puede leerse igual que un ■").toBe("upstream");
  });

  /** CONTRA-PRUEBA: un turno limpio no inventa código. */
  it("un turno que acaba bien no lleva código de error", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted([{ type: "text_delta", text: "hola" }, done]),
      runTool: async () => { throw new Error("must not run"); },
      emit: () => {},
    });
    expect(r.terminalError).toBe(false);
    expect(r.errorCode).toBeNull();
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

  /**
   * ⚰️ EL CICLO DE ARREGLO Y EL REVERT — RETIRADOS (Jesús, 2026-09-04).
   *
   * Aquí vivían nueve pruebas que sujetaban dos comportamientos:
   *
   *  - que una rotura le INYECTARA al modelo una instrucción de arreglo que el
   *    usuario no pidió («verificación visual automática»), y
   *  - que si ese ciclo no bajaba el número de problemas, se DESHICIERA su
   *    edición (`restaurarHtml`).
   *
   * Lo segundo es lo mismo que se retiró de Crear el mismo día: tirar el
   * trabajo del modelo porque nuestro medidor no lo aprueba. La regla es que
   * corrige el USUARIO, no la tubería. Para deshacer ya está el Undo, que es
   * suyo.
   *
   * No se borran a secas: las sustituyen las dos de abajo, que vigilan el
   * sentido contrario. Los ojos siguen mirando y siguen DICIÉNDOLO —la tarjeta
   * cierra en `issues`— pero el turno acaba con lo que el modelo hizo.
   */
  it("una rotura NO abre ciclo de arreglo: cierra con lo que hizo el modelo", async () => {
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

    // UNA mirada. La segunda existía sólo para comprobar si el arreglo arregló,
    // y ya no hay arreglo que comprobar.
    expect(verifies).toBe(1);
    // Y a nadie se le manda arreglar nada: ningún turno lleva la instrucción.
    const inyectada = streams.some((msgs) =>
      msgs.some((m) => m.role === "user" && String(m.content).includes("verificación visual automática")),
    );
    expect(inyectada, "le inyectamos un arreglo que el usuario no pidió").toBe(false);
    expect(r.terminalError).toBe(false);
    // Pero SE DICE: la tarjeta cierra en `issues`, no en verde.
    const verify = events.filter((e) => e.type === "action" && (e as any).tool === "verificar_diseno");
    expect(verify.map((v: any) => v.summary)).toEqual(["", "issues"]);
  });

  it("y NO se deshace: la edicion del modelo se queda", async () => {
    // El brazo que importa. `restaurarHtml` sigue existiendo como dependencia
    // —la usa quien quiera ofrecer un Undo— pero el bucle no la llama sola.
    let restauraciones = 0;
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: editThenClose(),
      runTool: okEdit,
      verifyTurn: async () => ({ estado: "roto" as const, critique: "- sigue mal" }),
      restaurarHtml: async () => { restauraciones += 1; },
      emit: () => {},
    });

    expect(restauraciones, "le deshicimos el trabajo al modelo").toBe(0);
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

describe("corregirle el rumbo a media faena", () => {
  const doneEv: StreamEvent = { type: "done", stopReason: { kind: "end_turn" } };

  it("la correccion entra como mensaje del usuario y se anuncia", async () => {
    const events: AgentStreamEvent[] = [];
    const vistos: Message[][] = [];
    let dada = false;
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hazme un hero" }],
      tools: [],
      openStream: (msgs) => {
        vistos.push(msgs.map((m) => ({ ...m })));
        return (async function* () {
          if (vistos.length === 1) {
            yield { type: "function_call", name: "editar_pagina", args: {} } as StreamEvent;
            yield usage(5);
            yield doneEv;
          } else {
            yield { type: "text_delta", text: "Ajustado." } as StreamEvent;
            yield usage(5);
            yield doneEv;
          }
        })();
      },
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
      // Llega UNA vez, entre la primera y la segunda vuelta.
      leerDireccion: () => {
        if (dada) return null;
        dada = true;
        return "no toques la foto";
      },
    });

    expect(r.finalText).toBe("Ajustado.");
    // El texto del usuario viaja VERBATIM dentro del mensaje.
    const inyectado = vistos[0].find((m) => m.role === "user" && String(m.content).includes("no toques la foto"));
    expect(inyectado).toBeTruthy();
    // Y se anuncia, para que el panel pueda pintarlo en su sitio.
    expect(events.some((e) => e.type === "direccion" && e.texto === "no toques la foto")).toBe(true);
  });

  it("BRAZO DE CONTROL: sin `leerDireccion` el bucle se comporta igual que antes", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hola" }],
      tools: [],
      openStream: scripted([{ type: "text_delta", text: "¡Hola!" }, usage(5), doneEv]),
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
    });
    expect(r.finalText).toBe("¡Hola!");
    expect(events.some((e) => e.type === "direccion")).toBe(false);
  });

  it("se lee UNA vez por vuelta, no una vez por herramienta", async () => {
    // Si se leyera por herramienta, dos llamadas en la misma vuelta partirian
    // la correccion en dos y el modelo la veria duplicada.
    let lecturas = 0;
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: scripted(
        [
          { type: "function_call", name: "leer_estado", args: {} },
          { type: "function_call", name: "leer_estado", args: {} },
          usage(5),
          doneEv,
        ],
        [{ type: "text_delta", text: "ya" }, usage(5), doneEv],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
      leerDireccion: () => { lecturas += 1; return null; },
    });
    // Dos vueltas del bucle ⇒ dos lecturas, aunque la primera hiciera 2 tools.
    expect(lecturas).toBe(2);
  });

  it("una correccion que llega EN EL TOPE todavia se lee y da margen", async () => {
    // Leer despues del tope seria lo peor de los dos mundos: se lee y se sale.
    const events: AgentStreamEvent[] = [];
    let dada = false;
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      maxTurns: 1,
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, usage(5), doneEv],
        [{ type: "text_delta", text: "corregido" }, usage(5), doneEv],
      ),
      runTool: async () => ({ response: { ok: true }, updatedHtml: "<p>x</p>" }),
      emit: (e) => events.push(e),
      leerDireccion: () => {
        if (dada) return null;
        dada = true;
        return "espera, asi no";
      },
    });
    expect(events.some((e) => e.type === "direccion")).toBe(true);
    // Y NO murio por tope en la vuelta en la que llego la correccion.
    const limite = events.find((e) => e.type === "error" && String((e as { message?: string }).message ?? "").includes("límite de pasos"));
    expect(limite).toBeUndefined();
  });
});

// ─── LA LLAMADA MAL ESCRITA (el sobre, tarea 6) ─────────────────────────────
//
// Hasta aquí, una errata en el nombre de una herramienta costaba tres cosas: la
// plaza de presupuesto (se cobra ANTES de ejecutar), una firma fallida, y una
// tarjeta roja en el taller con un nombre que no existe. El turno seguía, pero
// más pobre, y por un fallo de tecleo.
//
// OpenCode tiene dos redes que aquí no había: `experimental_repairToolCall`
// (`llm.ts:296-312`), que arregla el nombre cuando sólo difiere en mayúsculas y
// lo reintenta, y la herramienta `invalid` (`tool/invalid.ts:9-21`), que
// devuelve una corrección legible en vez de romper el turno — y que está
// excluida de la lista que ve el modelo (`llm.ts:317`).
//
// Con las cuatro puertas de la tarea 3 —`editar_texto`, `editar_html`,
// `editar_atributos`— los nombres se parecen entre sí, así que esto pasó de
// conveniente a necesario.
describe("la llamada mal escrita se repara, no se cobra", () => {
  // Las declaradas del turno: es de donde salen los nombres contra los que se
  // repara. Con `tools: []` no hay nada contra qué comparar, y no se repara
  // nada — que es lo correcto, no un fallo.
  const DECLARADAS = [
    { name: "editar_texto" }, { name: "editar_atributos" },
    { name: "editar_html" }, { name: "editar_runtime" }, { name: "leer_estado" },
  ] as unknown as Parameters<typeof runAgentLoop>[0]["tools"];
  const runNombre = async (nombre: string) => {
    const events: AgentStreamEvent[] = [];
    const vistos: string[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cambia el titular" }],
      tools: DECLARADAS,
      openStream: scripted(
        [{ type: "function_call", name: nombre, args: { ediciones: [{ target: "2f", texto: "Hola" }], resumen: "titular" }, thoughtSignature: "s" }, usage(10), done],
        [{ type: "text_delta", text: "Hecho." }, usage(5), done],
      ),
      runTool: async (n) => { vistos.push(n); return { response: { ok: true } }; },
      emit: (e) => events.push(e),
    });
    return { r, vistos, events };
  };

  it("MAYÚSCULAS: se normaliza y se ejecuta la de verdad", async () => {
    const { r, vistos } = await runNombre("EDITAR_TEXTO");
    expect(vistos).toEqual(["editar_texto"]);
    expect(r.finalText).toBe("Hecho.");
  });

  it("una letra de menos: se arregla y se ejecuta", async () => {
    const { vistos } = await runNombre("editar_txto");
    expect(vistos).toEqual(["editar_texto"]);
  });

  it("una letra de más, también", async () => {
    const { vistos } = await runNombre("editar_textoo");
    expect(vistos).toEqual(["editar_texto"]);
  });

  it("un nombre irreconocible NO gasta presupuesto ni ejecuta nada", async () => {
    const events: AgentStreamEvent[] = [];
    const vistos: string[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "haz algo" }],
      tools: DECLARADAS,
      openStream: scripted(
        [{ type: "function_call", name: "inventar_universo", args: {}, thoughtSignature: "s" }, usage(10), done],
        [{ type: "text_delta", text: "Perdón." }, usage(5), done],
      ),
      runTool: async (n) => { vistos.push(n); return { response: { ok: true } }; },
      emit: (e) => events.push(e),
    });
    // No se ejecuta nada, y no se cobra: `toolCalls` no cuenta una llamada que
    // no existió.
    expect(vistos).toEqual([]);
    expect(r.toolCalls).toBe(0);
    // Y no se pinta una tarjeta roja de una herramienta inexistente: el usuario
    // no tiene por qué enterarse de una errata que el sistema resolvió solo.
    expect(events.filter((e) => e.type === "action" && e.tool === "inventar_universo")).toEqual([]);
  });

  it("y al modelo se le devuelve una corrección legible, con la más parecida", async () => {
    const vueltas: Message[][] = [];
    const guion = scripted(
      [{ type: "function_call", name: "editar_texxxto", args: {}, thoughtSignature: "s" }, usage(10), done],
      [{ type: "text_delta", text: "ok" }, usage(5), done],
    );
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el titular" }],
      tools: DECLARADAS,
      openStream: (m: Message[]) => { vueltas.push(structuredClone(m)); return guion(m); },
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
    });
    // La vuelta siguiente lleva la corrección, y nombra la herramienta buena.
    const ultima = JSON.stringify(vueltas.at(-1) ?? []);
    expect(ultima).toContain("error_de_uso");
    expect(ultima).toContain("editar_texto");
  });
});

// ─── EL CIERRE SE ESCRIBÍA SOBRE UN HISTORIAL SIN LO QUE ACABABA DE HACER ──
//
// `finishOnCap` se llama DESDE DENTRO del bucle de llamadas, y el push del par
// assistant+functionResponses está DESPUÉS del bucle. Así que al agotar el tope
// a mitad de tanda, las herramientas que ya se habían ejecutado —con sus
// escrituras YA en la base— no estaban en `messages`, y el modelo que redacta
// el cierre no las veía. Cerraba contando un turno en el que no había hecho
// nada, sobre una página que sí había cambiado.
//
// Es el peor sitio para perder esa información: el cierre por tope es
// justamente el turno donde el usuario más necesita saber qué se hizo y qué no.
describe("al agotar el tope, el cierre ve lo que YA se ejecutó", () => {
  const DECLARADAS = [
    { name: "editar_texto" }, { name: "editar_html" },
  ] as unknown as Parameters<typeof runAgentLoop>[0]["tools"];

  it("las respuestas de la tanda llegan al cierre", async () => {
    const vistoPorElCierre: Message[][] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cambia dos cosas" }],
      tools: DECLARADAS,
      maxToolCalls: 1,
      openStream: scripted([
        { type: "function_call", name: "editar_texto", args: { resumen: "titular" }, thoughtSignature: "s1" },
        { type: "function_call", name: "editar_html", args: { resumen: "seccion" }, thoughtSignature: "s2" },
        usage(10),
        done,
      ]),
      runTool: async () => ({ response: { ok: true, edits_aplicados: 1, cambio: "cambio" } }),
      closeOut: (m) => {
        vistoPorElCierre.push(structuredClone(m));
        return (async function* () {
          yield { type: "text_delta", text: "Cambié el titular; me quedé sin pasos para la sección." } as StreamEvent;
          yield usage(4);
          yield done;
        })();
      },
      emit: () => {},
    });

    expect(r.topeAlcanzado ?? true).toBeTruthy();
    const visto = JSON.stringify(vistoPorElCierre.at(-1) ?? []);
    // La PRIMERA llamada sí se ejecutó: su respuesta tiene que estar delante
    // del modelo que redacta el cierre.
    expect(visto, "el cierre no vio la edición que sí se aplicó").toContain("edits_aplicados");
    expect(visto).toContain("editar_texto");
  });

  it("y el protocolo queda equilibrado: una respuesta por llamada anunciada", async () => {
    const vistoPorElCierre: Message[][] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia dos cosas" }],
      tools: DECLARADAS,
      maxToolCalls: 1,
      openStream: scripted([
        { type: "function_call", name: "editar_texto", args: { resumen: "a" }, thoughtSignature: "s1" },
        { type: "function_call", name: "editar_html", args: { resumen: "b" }, thoughtSignature: "s2" },
        usage(10),
        done,
      ]),
      runTool: async () => ({ response: { ok: true } }),
      closeOut: (m) => {
        vistoPorElCierre.push(structuredClone(m));
        return (async function* () { yield { type: "text_delta", text: "ok" } as StreamEvent; yield done; })();
      },
      emit: () => {},
    });

    const msgs = vistoPorElCierre.at(-1) ?? [];
    const conCalls = msgs.filter((m) => (m as { functionCalls?: unknown[] }).functionCalls?.length);
    const conResp = msgs.filter((m) => (m as { functionResponses?: unknown[] }).functionResponses?.length);
    const nCalls = conCalls.reduce((n, m) => n + ((m as { functionCalls?: unknown[] }).functionCalls?.length ?? 0), 0);
    const nResp = conResp.reduce((n, m) => n + ((m as { functionResponses?: unknown[] }).functionResponses?.length ?? 0), 0);
    // La que hizo saltar el tope NO se ejecutó, así que NO se anuncia: anunciar
    // una llamada sin respuesta desequilibra el protocolo de function-calling.
    expect(nCalls).toBe(nResp);
    expect(nResp).toBe(1);
  });
});
