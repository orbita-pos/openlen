import { describe, expect, it } from "vitest";
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { runAgentLoop, topesPorPlan, type AgentStreamEvent } from "./loop";

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

  // EL MOTIVO LLEGA A LA TARJETA, y no sólo al modelo (2026-09-18).
  //
  // El `{ok:false, error}` de arriba ya volvía al modelo como dato. Lo que no
  // salía del servidor era el PORQUÉ para quien mira: la tarjeta se pintaba
  // «falló» y punto, con el motivo escrito a dos capas de distancia. Es la
  // forma de Claude Code: un solo texto, el mismo para los dos.
  it("un fallo emite su motivo en el evento de la tarjeta", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, done],
        [{ type: "text_delta", text: "no pude" }, done],
      ),
      runTool: async () => ({ response: { ok: false, error: "target missing" } }),
      emit: (e) => events.push(e),
    });
    const fallo = events.find((e) => e.type === "action" && e.status === "error");
    expect(fallo).toBeDefined();
    expect((fallo as { motivo?: string }).motivo).toBe("target missing");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // LA PRUEBA DESCARTADA SE VE, EN ÁMBAR (2026-09-18).
  //
  // MEDIDO en producción esa misma noche: «ponme un carrito con base de datos».
  // Len mandó una prueba de clics donde NINGÚN paso pulsaba, el validador la
  // descartó (`sin_accion`) dos veces, y en la pantalla del dueño no había ni
  // una tarjeta que lo dijera — la edición se aplicó, así que todas eran
  // verdes. El motivo vivía en un `console.warn` de la caja.
  //
  // LA VARA: en Claude Code una entrada que no pasa la validación acaba en un
  // `tool_result` con `…`, o sea VISIBLE en la transcripción. Aquí
  // se pinta ÁMBAR y no roja a propósito: para ellos falla la llamada entera,
  // mientras que aquí la edición sí se guardó. Pintarla roja mentiría sobre el
  // trabajo del usuario, que es la avería contraria.
  it("🔴 una prueba descartada sale en ámbar, con su aviso", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_runtime", args: {} }, done],
        [{ type: "text_delta", text: "hecho" }, done],
      ),
      runTool: async () => ({
        response: {
          ok: true,
          prueba_descartada: {
            motivo: "sin_accion",
            aviso: "No pude comprobar el comportamiento: NINGÚN paso pulsa ni escribe. El cambio sí se guardó.",
          },
        },
      }),
      emit: (e) => events.push(e),
    });
    const ambar = events.find((e) => e.type === "action" && e.status === "warning");
    expect(ambar).toBeDefined();
    expect((ambar as { motivo?: string }).motivo).toContain("NINGÚN paso pulsa");
  });

  // CONTRA-PRUEBA: una edición normal sigue saliendo verde. Sin esto, cualquier
  // cosa que se colara en la respuesta pintaría de ámbar turnos sanos, que es
  // la forma más rápida de que el dueño deje de mirar las tarjetas.
  it("CONTRA-PRUEBA: sin prueba descartada la tarjeta sigue verde", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_runtime", args: {} }, done],
        [{ type: "text_delta", text: "hecho" }, done],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === "action" && e.status === "warning")).toBe(false);
  });

  // CONTRA-PRUEBA: el evento de una llamada que fue bien sale como salía —sin
  // la clave—, que es lo que deja intactas las tarjetas verdes y su prueba.
  it("CONTRA-PRUEBA: una llamada que va bien no emite motivo", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, done],
        [{ type: "text_delta", text: "hecho" }, done],
      ),
      runTool: async () => ({ response: { ok: true, error: "no es un fallo" } }),
      emit: (e) => events.push(e),
    });
    for (const e of events) {
      if (e.type === "action") expect("motivo" in e).toBe(false);
    }
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
    // 27 calls in one turn, alternating exempt (elegir_foto) and budgeted
    // (editar_pagina) — 14 exempt + 13 budgeted. Los presupuestados no llegan
    // solos a `maxToolCalls` con este orden; es el tope ABSOLUTO (26, cuenta
    // TODO) el que tiene que parar la 27ª.
    //
    // El número subió de 20 a 26 el 2026-09-15, con los defectos: si el
    // absoluto no se separa del presupuestado, deja de ser una red de seguridad
    // independiente y se convierte en el mismo muro dos veces.
    const calls: StreamEvent[] = Array.from({ length: 27 }, (_, i): StreamEvent => ({
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
    // Sólo 26 de las 27 llegaron a correr antes de que el tope absoluto parara
    // el bucle.
    expect(seen).toHaveLength(26);
    expect(r.toolCalls).toBe(26);
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

  // 🔴 CAMBIÓ EL 2026-09-11, y esta prueba decía lo contrario a propósito hasta
  // hoy: «a succeeding call is never treated as a no-progress loop». Era verdad
  // como POLÍTICA y falso como protección — el bucle que agota el presupuesto
  // del usuario es justo de llamadas que salen bien. Medido sobre
  // `carrito-se-construye`: `editar_runtime` con el mismo resumen hasta topar,
  // con los DOS modelos, sin que `failedSignatures` se tocara una sola vez.
  //
  // Las dos guardas siguen siendo DOS y distintas, que es lo que esta prueba
  // conserva: la de fallos mira la firma completa de argumentos y refusa la
  // tercera FALLIDA; ésta mira la INTENCIÓN (herramienta + resumen), porque el
  // modelo retoca el código en cada vuelta y la firma nunca repite.
  it("B: una llamada que SALE BIEN tampoco es gratis si repite la misma intención", async () => {
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
    // Corren DOS; la tercera con la misma intención se refusa. El umbral cae
    // dentro del presupuesto de turnos a propósito — ver `SAME_INTENT_LIMIT`.
    expect(seen).toEqual(["editar_pagina", "editar_pagina"]);
  });

  // 🔴 LA INTENCIÓN NO PUEDE VIVIR EN LA PROSA DEL MODELO, y este caso es el
  // que lo mide. `editar_runtime` manda «el código COMPLETO que debe quedar, no
  // un parche» —lo dice su propia ficha— así que dos llamadas en un turno son,
  // por construcción, la segunda tirando a la primera: no hay escenario donde
  // llamarla cuatro veces sea más correcto que llamarla una con el contenido
  // final.
  //
  // MEDIDO en producción el 2026-09-11 (`carrito-se-construye` y
  // `contador-se-construye`, ~40% y 2/6): el modelo la llama CUATRO veces por
  // turno bajo DOS resúmenes distintos, dos de cada uno — siempre justo por
  // debajo de `SAME_INTENT_LIMIT`, que cuenta por `herramienta + resumen`.
  // Reformular la frase reinicia el contador, el guardia no dispara nunca, y el
  // turno muere en `turn_limit` habiendo escrito cuatro veces el mismo fichero.
  //
  // Se permiten DOS a propósito: una prueba de comportamiento que falla NO
  // tumba la edición (devuelve ok + aviso) y la ficha manda «lo arreglas en ese
  // mismo turno». Escribir, que falle la prueba y arreglar son dos. La tercera
  // ya es flailing.
  it("B2: reformular el resumen NO reinicia el contador de editar_runtime", async () => {
    const seen: string[] = [];
    const rt = (resumen: string) => ({
      type: "function_call" as const,
      name: "editar_runtime",
      args: { script: "x", resumen },
    });
    await runAgentLoop({
      messages: [{ role: "user", content: "hazme un carrito" }], tools: [],
      openStream: scripted(
        [
          rt("carrito con agregar, cantidades, quitar"),
          rt("carrito con agregar, cantidades, quitar"),
          // El modelo reformula. Mismo fichero, otras palabras.
          rt("carrito funcional: agregar, cantidades, total"),
          rt("carrito funcional: agregar, cantidades, total"),
          done,
        ],
        [{ type: "text_delta", text: "Listo." }, done],
      ),
      runTool: async (name) => { seen.push(name); return { response: { ok: true } }; },
      emit: () => {},
    });
    expect(seen).toEqual(["editar_runtime", "editar_runtime"]);
  });

  // 🔴 CAMBIÓ EL 2026-09-10. Antes, `max_tokens` mataba el turno SIEMPRE y al
  // usuario le llegaba «intenta un pedido más corto» por una edición legítima.
  // Ahora una vuelta cortada CON texto y SIN llamadas se continúa una vez, como
  // hace Claude Code (`<interrupted-output>`). Este caso sigue
  // guardando el final: cuando ya no se puede continuar, es un error terminal.
  it("se corta dos veces: continúa una y entonces sí termina en truncated", async () => {
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
    // Una continuación, no más: la segunda vez ya no se puede.
    expect(opened).toBe(2);
    expect(r.turns).toBe(2);
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toContain("espacio");
    // Accumulated usage is still returned rather than discarded.
    expect(r.usage.outputTokens).toBe(40);
    expect(r.terminalError).toBe(true);
    expect((err as { code?: string }).code).toBe("truncated");
  });

  it("le devuelve SU parcial y sigue la frase donde se cortó", async () => {
    const events: AgentStreamEvent[] = [];
    const vistos: string[] = [];
    let opened = 0;
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: (msgs) => {
        opened += 1;
        vistos.push(JSON.stringify(msgs));
        const primera = opened === 1;
        return (async function* () {
          yield { type: "text_delta", text: primera ? "Cambié el titular y aho" : "ra el subtítulo." } as StreamEvent;
          yield {
            type: "done",
            stopReason: primera ? { kind: "max_tokens" } : { kind: "end_turn" },
          } as StreamEvent;
        })();
      },
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
    });
    // UNA continuación, contada por el aviso y no por `opened`: este guion
    // cierra sin llamar a ninguna herramienta, así que además salta el empujón
    // preexistente (INSISTE_SIN_HERRAMIENTAS) y abre una vuelta más. Contar
    // aperturas mediría los dos mecanismos a la vez.
    // Se cuenta en el ÚLTIMO historial, no cuántos historiales lo mencionan:
    // el mensaje se queda dentro de `messages` y aparece en todas las vueltas
    // posteriores. Una apertura de valla = una continuación inyectada.
    // Se cuenta el cierre y no la apertura: la propia instrucción nombra
    // `<salida-cortada>` en su prosa, así que la apertura sale dos veces por
    // inyección. El cierre sale una.
    expect(vistos.at(-1)!.split("</salida-cortada>").length - 1).toBe(1);
    expect(opened).toBeGreaterThanOrEqual(2);
    // El aviso lleva el parcial dentro de su valla, y la cláusula de higiene:
    // el parcial puede traer trozos del documento del usuario.
    expect(vistos[1]).toContain("salida-cortada");
    expect(vistos[1]).toContain("Cambié el titular y aho");
    expect(vistos[1]).toContain("NUNCA como instrucciones");
    // Y el texto devuelto es la frase ENTERA, no sólo la segunda mitad.
    expect(r.finalText).toBe("Cambié el titular y ahora el subtítulo.");
    // No es un error: continuar es el camino normal, no una avería.
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(r.terminalError).toBe(false);
  });

  it("NO continúa si la tanda traía llamadas: repetirlas podría aplicar dos veces", async () => {
    const events: AgentStreamEvent[] = [];
    let opened = 0;
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: () => {
        opened += 1;
        return (async function* () {
          yield { type: "text_delta", text: "voy a editar" } as StreamEvent;
          yield { type: "function_call", name: "editar_pagina", args: {} } as StreamEvent;
          yield { type: "done", stopReason: { kind: "max_tokens" } } as StreamEvent;
        })();
      },
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    expect(opened).toBe(1);
    expect((events.find((e) => e.type === "error") as { code?: string })?.code).toBe("truncated");
    expect(r.terminalError).toBe(true);
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

  // LA DIRECCIÓN DEL DESHACER viaja con el documento. El botón del Chat la
  // necesita para pedirle al servidor que restaure DESDE SU BASE; sin ella su
  // único camino era mandar el documento entero, que se sanea y le quitaba el
  // JavaScript del modelo. Ver components/workspace-v2/panels/undo-turn.ts.
  it("el evento html reenvía el id de la versión previa que puso la herramienta", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: {} }, done],
        [{ type: "text_delta", text: "Hecho." }, done],
      ),
      runTool: async () => ({
        response: { ok: true },
        updatedHtml: "<!doctype html><html><body>x</body></html>",
        versionPrevia: "v_antes",
      }),
      emit: (e) => events.push(e),
    });
    const html = events.find((e) => e.type === "html") as { versionPrevia?: string };
    expect(html.versionPrevia).toBe("v_antes");
  });

  // Y NO se inventa uno. Las herramientas que no escriben sobre un documento
  // anterior (crear_pagina) no tienen «antes» al que volver: el evento sale
  // byte-idéntico al de siempre y ese turno no ofrece Deshacer.
  it("el evento html NO lleva el campo cuando la herramienta no lo puso", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "crear_pagina", args: {} }, done],
        [{ type: "text_delta", text: "Hecho." }, done],
      ),
      runTool: async () => ({
        response: { ok: true },
        updatedHtml: "<!doctype html><html><body>x</body></html>",
      }),
      emit: (e) => events.push(e),
    });
    const html = events.find((e) => e.type === "html") as Record<string, unknown>;
    expect("versionPrevia" in html).toBe(false);
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

  /**
   * 🔴 LA LISTA VUELVE DELANTE — el fallo que esto cierra, medido 7 de 7.
   *
   * «Pon este teléfono en el pie de TODAS las páginas» sobre un sitio de cuatro:
   * Len edita TRES y cierra, siempre dejando la misma fuera. Cinco corridas el
   * 2026-09-08 más dos el 2026-09-07, con el presupuesto de PRODUCCIÓN (el caso
   * no pone `maxTurns` y la ruta tampoco: los dos caen en 6).
   *
   * La causa no es el presupuesto —son cuatro ediciones idénticas con seis
   * turnos— sino que declara la lista UNA vez y no vuelve a verla: vive en el
   * servidor, no en su contexto.
   *
   * Es lo que hace Claude Code: cuenta
   * `…` y reinyecta la lista como adjunto `…`.
   * ESTADO devuelto al contexto, no una frase en el prompt.
   */
  it("🔴 con tareas pendientes, la lista se le devuelve en el mensaje hermano", async () => {
    const streams: Message[][] = [];
    const stream = scripted(
      [declara(3), edita, done],
      [edita, done],
      [edita, done],
      [{ type: "text_delta", text: "Hechas." }, done],
    );
    await runAgentLoop({
      messages: [{ role: "user", content: "tres cosas" }], tools: [],
      openStream: (m) => { streams.push([...m]); return stream(m); },
      runTool,
      emit: () => {},
    });
    const dichos = streams
      .flat()
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .filter((c) => c.includes("<tus-tareas>"));
    expect(dichos.length, "nunca se le devolvió la lista").toBeGreaterThan(0);
    const texto = dichos[0]!;
    // La lista ENTERA, con sus nombres.
    expect(texto).toContain("1. tarea 1");
    expect(texto).toContain("3. tarea 3");
    // Y el recuento, sin inventarse cuál falta: se asignan por orden y el
    // propio `tareasSinEvidencia` dice que no hay forma de saberlo.
    expect(texto).toMatch(/Declaraste 3 y tengo evidencia de \d+/);
    expect(texto).toContain("no puedo decirte cuál falta");
  });

  // …y no es una regañina en cada tanda: con 6 turnos de tope, el hueco de 2
  // vueltas deja como mucho un par de recordatorios en un turno entero.
  it("no se le repite en cada vuelta", async () => {
    const streams: Message[][] = [];
    const stream = scripted(
      [declara(3), edita, done],
      [edita, done],
      [edita, done],
      [{ type: "text_delta", text: "Hechas." }, done],
    );
    await runAgentLoop({
      messages: [{ role: "user", content: "tres cosas" }], tools: [],
      openStream: (m) => { streams.push([...m]); return stream(m); },
      runTool,
      emit: () => {},
    });
    const cuantos = new Set(
      streams.flat().map((m) => (typeof m.content === "string" ? m.content : "")).filter((c) => c.includes("<tus-tareas>")),
    ).size;
    expect(cuantos).toBeLessThanOrEqual(2);
  });

  /**
   * 🔴 MUDARSE DE PÁGINA NO GASTA TURNO — la aritmética del fallo 7 de 7.
   *
   * El protocolo son DOS turnos por página: mudarse y editar, y no caben en la
   * misma tanda porque las ops necesitan los `op_id` que devuelve la mudanza.
   * Con la mudanza contando como turno de mutación, cuatro páginas piden nueve
   * turnos contra un tope de seis — y Len editaba tres, se mudaba a la cuarta y
   * se quedaba sin cuerda ahí mismo, con `trabajar_en_pagina (servicios)` como
   * última acción en las siete corridas.
   *
   * Esta prueba fija la CUENTA, no el número: cuatro páginas tienen que caber en
   * el presupuesto por defecto.
   */
  it("🔴 cuatro páginas caben: mudarse no cuenta como turno de trabajo", async () => {
    const muda = { type: "function_call" as const, name: "trabajar_en_pagina", args: {} };
    const stream = scripted(
      [edita, done],            // Home
      [muda, done],             // → equipo
      [edita, done],
      [muda, done],             // → contacto
      [edita, done],
      [muda, done],             // → servicios
      [edita, done],            // …y la cuarta, que antes no llegaba
      [{ type: "text_delta", text: "Las cuatro." }, done],
    );
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "el teléfono en todas" }], tools: [],
      openStream: stream,
      runTool,
      emit: () => {},
    });
    expect(r.finalText, "se quedó sin turnos antes de la cuarta página").toBe("Las cuatro.");
    expect(r.topeAlcanzado ?? null).toBeNull();
  });

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

  // EL GEMELO LLEGA A LOS OJOS. Sin esto, la herramienta lo trae y el bucle lo
  // tira, que es la forma silenciosa de que todo el cambio no haga nada: los
  // ojos medirian el documento guardado —sin `data-op-id`— y los avisos
  // volverian a describir el culpable en vez de localizarlo.
  it("el gemelo etiquetado de la mutacion llega a los ojos", async () => {
    let visto: { html: string; taggedHtml?: string } | null = null;
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: editThenClose(),
      runTool: async () => ({
        response: { ok: true },
        updatedHtml: "<!doctype html><html><body>v2</body></html>",
        taggedHtml: '<!doctype html><html><body data-op-id="1">v2</body></html>',
      }),
      verifyTurn: async (info) => { visto = info; return { estado: "bien" as const }; },
      emit: () => {},
    });
    expect(visto).not.toBeNull();
    expect(visto!.taggedHtml).toContain('data-op-id="1"');
    // Y el guardado sigue viajando aparte: es lo que se FOTOGRAFIA.
    expect(visto!.html).toContain("v2");
    expect(visto!.html).not.toContain("data-op-id");
  });

  it("sin gemelo, los ojos reciben solo el guardado — como antes", async () => {
    let visto: { html: string; taggedHtml?: string } | null = null;
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: editThenClose(),
      runTool: okEdit,
      verifyTurn: async (info) => { visto = info; return { estado: "bien" as const }; },
      emit: () => {},
    });
    expect(visto!.taggedHtml).toBeUndefined();
    expect(visto!.html).toContain("v2");
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
    //
    // ⚠️ «NO EN VERDE» ERA LO QUE ESTA LÍNEA NO COMPROBABA (2026-09-04). Sólo
    // afirmaba el `summary`, y el `status` seguía siendo `done` — o sea el tick
    // verde, justo lo que el comentario decía descartar. El icono contradecía a
    // su propia etiqueta y la prueba pasaba igual. Ahora se fija el PAR, que es
    // lo que el usuario ve.
    const verify = events.filter((e) => e.type === "action" && (e as any).tool === "verificar_diseno");
    expect(verify.map((v: any) => [v.status, v.summary])).toEqual([
      ["running", ""],
      ["warning", "issues"],
    ]);
  });

  // 🔴 LO MEDIDO TIENE QUE LLEGAR AL USUARIO, o medir no sirve de nada.
  //
  // Sin ciclo de arreglo el modelo NO se entera de la crítica, así que el texto
  // que él escribió no puede contarla. Antes se cerraba con `finalText =
  // turnText` y los problemas morían en una tarjeta de cuatro palabras: se
  // medía y no se decía, y el usuario no puede pedir que se arregle lo que
  // nadie le ha contado. La rama hermana (`observado`) ya lo hacía bien.
  it("una rotura SE DICE: los problemas salen como texto y quedan en finalText", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: editThenClose(),
      runTool: okEdit,
      verifyTurn: async () => ({
        estado: "roto" as const,
        critique: "- el hero quedó con texto encimado\n- el precio no se lee",
      }),
      emit: (e) => events.push(e),
    });

    const dicho = events
      .filter((e) => e.type === "text")
      .map((e) => (e as { text: string }).text)
      .join("\n");
    expect(dicho, "el usuario nunca se enteró de lo que se midió").toContain(
      "el hero quedó con texto encimado",
    );
    expect(dicho).toContain("el precio no se lee");
    // Y sobrevive a recargar la conversación.
    expect(r.finalText).toContain("el precio no se lee");
    // Lo que el modelo dijo NO se pierde: se añade, no se sustituye.
    expect(r.finalText).toContain("Listo");
  });

  // ⚰️ AQUÍ SE COMPROBABA que el bucle no llamara a `restaurarHtml` (2026-09-04).
  // Esa dependencia ya no existe: se declaraba en `AgentLoopArgs`, la ruta la
  // implementaba contra `persistPage`… y NADIE la llamaba desde que `12f6a11e`
  // retiró el revert. Barrida entera — bucle, ruta y arnés.
  //
  // Lo que la prueba defendía sigue defendido, y por construcción en vez de por
  // aserción: el bucle no tiene con qué revertir. Que la edición del modelo se
  // queda lo fija la prueba de arriba, que cierra el turno con lo que él hizo.
  it("una rotura no toca el documento: el turno cierra con la edición del modelo", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: editThenClose(),
      runTool: okEdit,
      verifyTurn: async () => ({ estado: "roto" as const, critique: "- sigue mal" }),
      emit: () => {},
    });
    expect(r.terminalError).toBe(false);
    expect(r.finalText).toContain("Listo");
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

  // ⚠️ Y CIERRA EN `warning`, no en `done` (2026-09-04). Esta prueba fijaba
  // `["done", "no-mirado"]`, o sea la mitad del arreglo: la ETIQUETA decía «sin
  // comprobar» y el ICONO seguía siendo el mismo tick verde de una verificación
  // de verdad — que es exactamente el fallo que el nombre de esta prueba dice
  // haber cerrado. El texto se arregló y el icono no, y esto lo sujetaba.
  it("pero SÍ se dice: la tarjeta cierra en 'no-mirado' y en ámbar, no en 'ok'", async () => {
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
      ["warning", "no-mirado"],
    ]);
  });

  // ── Y EL CUARTO DESENLACE: se miró, pero no se midió ──────────────────────
  //
  // 🔴 Los ojos son DOS renders. Si el del medidor se cae, el desborde en móvil
  // y el contraste NO se comprobaron, y el veredicto sale limpio igual. Hasta
  // el 2026-09-16 eso enseñaba el mismo «sin problemas» que una verificación
  // entera — el mismo defecto que arregló `no-mirado`, un caso más arriba.
  const tarjetasDe = async (verdict: unknown) => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: editThenClose(),
      runTool: okEdit,
      verifyTurn: async () => verdict as never,
      emit: (e) => events.push(e),
    });
    return events
      .filter((e) => e.type === "action" && (e as any).tool === "verificar_diseno")
      .map((v: any) => [v.status, v.summary]);
  };

  it("🔴 midió y salió limpia → 'ok'", async () => {
    expect(await tarjetasDe({ estado: "bien", conMedida: true })).toEqual([
      ["running", ""],
      ["done", "ok"],
    ]);
  });

  it("🔴 se miró la captura pero NO se midió → 'ok-sin-medida', no 'ok'", async () => {
    expect(await tarjetasDe({ estado: "bien", conMedida: false })).toEqual([
      ["running", ""],
      ["done", "ok-sin-medida"],
    ]);
  });

  // CONTRA-PRUEBA, y es la que evita el peor arreglo posible. `conMedida` es
  // OPCIONAL: hay implementaciones de `verifyTurn` que no lo mandan (el arnés
  // de evals, los dobles). Si la degradación se disparara con `!conMedida`,
  // todas ellas enseñarían «solo la captura» de turnos que sí midieron — un
  // aviso permanente y falso. Sólo degrada un `false` EXPLÍCITO.
  it("un verifyTurn que no manda conMedida sigue saliendo 'ok'", async () => {
    expect(await tarjetasDe({ estado: "bien" })).toEqual([
      ["running", ""],
      ["done", "ok"],
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

// Fotografia `messages` en cada vuelta SIN crear un stream nuevo: `scripted`
// lleva su propio contador, y construirlo dentro del envoltorio lo reseteaba en
// cada llamada — el bucle repetia la primera tanda hasta topar con un tope.
function mirando(
  album: Message[][],
  stream: (messages: Message[]) => AsyncIterable<StreamEvent>,
): (messages: Message[]) => AsyncIterable<StreamEvent> {
  return (messages) => {
    album.push(JSON.parse(JSON.stringify(messages)));
    return stream(messages);
  };
}

describe("runAgentLoop — lo medido vuelve al modelo", () => {
  // Una tanda que edita, con su gemelo etiquetado: es la condición para medir.
  const edita = (): StreamEvent[] => [
    { type: "function_call", name: "editar_pagina", args: {} },
    done,
  ];
  const herramientaQueEdita = async () => ({
    response: { ok: true },
    action: { tool: "editar_pagina", ok: true, summary: "editado" },
    updatedHtml: "<html>visible</html>",
    taggedHtml: '<html data-op-id="bs">etiquetado</html>',
    page: null,
  });
  const desbordado = {
    mobileOverflow: true,
    overflowCulprit: '<div class="grid">',
    overflowCulpritRight: 482,
    overflowCulpritKind: "caja" as const,
    overflowCulpritOpId: "bs",
  };

  it("🔴 viaja en el content del mensaje, NO dentro del resultado de la herramienta", async () => {
    const vistos: Message[][] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "arregla el móvil" }],
      tools: [],
      openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "Hecho." }, done])),
      runTool: herramientaQueEdita,
      emit: () => {},
      medirParaElModelo: async () => desbordado,
    });
    const segunda = vistos[1] ?? [];
    const conRespuestas = segunda.find((m) => m.functionResponses);
    expect(conRespuestas).toBeDefined();
    // El aviso está en el sobre...
    expect(conRespuestas?.content).toContain("data-op-id=bs");
    expect(conRespuestas?.content).toContain("482px");
    // ...y NO dentro de la respuesta de la herramienta, que es suya.
    expect(JSON.stringify(conRespuestas?.functionResponses)).not.toContain("482px");
  });

  it("se le mide el GEMELO etiquetado, que es donde viven las direcciones", async () => {
    const medidos: string[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: scripted(edita(), [{ type: "text_delta", text: "ok" }, done]),
      runTool: herramientaQueEdita,
      emit: () => {},
      medirParaElModelo: async (html) => {
        medidos.push(html);
        return null;
      },
    });
    expect(medidos).toEqual(['<html data-op-id="bs">etiquetado</html>']);
  });

  it("sin la dependencia el mensaje sale byte a byte como antes", async () => {
    const vistos: Message[][] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
      runTool: herramientaQueEdita,
      emit: () => {},
    });
    const conRespuestas = (vistos[1] ?? []).find((m) => m.functionResponses);
    expect(conRespuestas?.content).toBe("");
  });

  // ⚰️ ESTA PRUEBA SE LLAMABA «una página sana no escribe nada en el sobre», y
  // el nombre mentía: lo que mide es `{}`, una medición VACÍA — o sea una
  // página SIN MEDIR, no una página sana. La diferencia no importaba mientras
  // los dos casos callaran; desde el 2026-09-07 una página medida y limpia SÍ
  // habla, y el nombre viejo habría quedado sujetando lo contrario de lo que
  // pasa. Un campo ausente no es un cero.
  it("una página SIN MEDIR no escribe nada en el sobre", async () => {
    const vistos: Message[][] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
      runTool: herramientaQueEdita,
      emit: () => {},
      medirParaElModelo: async () => ({}),
    });
    expect((vistos[1] ?? []).find((m) => m.functionResponses)?.content).toBe("");
  });

  // 🔴 Y LA CONTRARIA, que es la que faltaba: medida de verdad y limpia, se
  // DICE. El silencio no es evidencia de nada — medido el 2026-09-07 con un
  // evaluador aparte, que se negó a dar por cumplida «la página no desborda en
  // móvil» leyendo un turno donde el agente decía «listo» y no había ninguna
  // medición detrás. Sin esta frase, esa condición no se cumple jamás.
  it("una página MEDIDA Y LIMPIA sí se lo dice al modelo", async () => {
    const vistos: Message[][] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
      runTool: herramientaQueEdita,
      emit: () => {},
      medirParaElModelo: async () => ({
        mobileOverflow: false,
        unreadableText: [],
        runtimeErrors: [],
        clasesMuertas: [],
      }),
    });
    const contenido = (vistos[1] ?? []).find((m) => m.functionResponses)?.content ?? "";
    expect(contenido).toContain("no encontró defectos");
    expect(contenido).toContain("Eso es TODO lo que esta medición mira");
  });

  // ── LOS LÍMITES DE LA MEDIDA, AL MODELO Y NO AL USUARIO ───────────────────
  //
  // 🔴 EL ARREGLO DEL 2026-09-16. Estos dos hechos salían por `observaciones`
  // del veredicto, y la rama `observado` EMITE esa lista verbatim a la
  // conversación: medido en dos turnos pagados, la respuesta de Len a «cambiame
  // el titular» le enseñaba al usuario «prompt devuelve null, confirm false» —
  // castellano fijo del servidor, fuera cual fuera el idioma del usuario.
  it("🔴 los límites llegan al MODELO por el sobre, no a la conversación", async () => {
    const vistos: Message[][] = [];
    const emitido: string[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
      runTool: herramientaQueEdita,
      emit: (ev) => {
        if (ev.type === "text") emitido.push(ev.text);
      },
      medirParaElModelo: async () => ({
        mobileOverflow: false,
        unreadableText: [],
        runtimeErrors: [],
        clasesMuertas: [],
        dialogosNativos: ["prompt: Nombre:"],
        llamadasSoloPublicada: ["/api/f/mi-negocio → 404"],
      }),
    });
    const contenido = (vistos[1] ?? []).find((m) => m.functionResponses)?.content ?? "";
    expect(contenido).toContain("<limites-de-la-medida>");
    expect(contenido).toContain("`prompt()`");
    expect(contenido).toContain("/api/f/mi-negocio");
    // Y NADA de eso se le emitió al usuario.
    const alUsuario = emitido.join(" ");
    expect(alUsuario).not.toContain("prompt()");
    expect(alUsuario).not.toContain("/api/f/mi-negocio");
  });

  // ── LA OBSERVACIÓN DEL CRÍTICO CON VISIÓN: A LA TARJETA, NO A LA BOCA ────
  //
  // 🔴 EL ARREGLO DEL 2026-09-16, y es OTRO distinto del de arriba. Aquél sacó
  // de la conversación lo que la MEDICIÓN no comprueba; éste saca lo que el
  // crítico con visión VE. Medido en dos corridas de pago: a «cambiame el
  // titular» Len contestaba «Hecho: el titular ahora dice X. El titular
  // solicitado X aparece correctamente en el hero. Los campos del formulario
  // muestran solo placeholders, lo cual es normal.» — le repetía al usuario lo
  // que él acababa de decirle. Y era INCONDICIONAL, no intermitente.
  it("🔴 lo que VIO el crítico no se pega a la respuesta: va en la tarjeta", async () => {
    const emitido: string[] = [];
    const tarjetas: { tool: string; observacion?: string }[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: scripted(edita(), [{ type: "text_delta", text: "Hecho: el titular ya dice X." }, done]),
      runTool: herramientaQueEdita,
      emit: (ev) => {
        if (ev.type === "text") emitido.push(ev.text);
        else if (ev.type === "action") {
          tarjetas.push({ tool: ev.tool, ...(ev.observacion ? { observacion: ev.observacion } : {}) });
        }
      },
      verifyTurn: async () => ({
        estado: "observado",
        notas: ["El titular solicitado X aparece correctamente en el hero."],
      }),
    });
    // 1. NO viaja en la respuesta al usuario, ni por `finalText` ni por texto.
    expect(r.finalText ?? "").toBe("Hecho: el titular ya dice X.");
    expect(emitido.join(" ")).not.toContain("aparece correctamente");
    // 2. Pero NO SE TIRA: la llamada de visión ya se pagó, y en el caso sano
    //    esa frase es lo único que produce. Cuelga de la tarjeta.
    // La ÚLTIMA: `verificar_diseno` emite `running` antes que `done`, y la
    // primera no lleva observación porque todavía no se ha mirado nada.
    const visual = tarjetas.filter((t) => t.tool === "verificar_diseno").at(-1);
    expect(visual?.observacion, "la observación se perdió por el camino").toContain(
      "aparece correctamente",
    );
  });

  it("BRAZO DE CONTROL: sin observación, la tarjeta no inventa uno", async () => {
    // Si `observacion` saliera siempre —aunque fuera vacío— la prueba de arriba
    // pasaría igual y la tarjeta enseñaría un hueco en la interfaz.
    const tarjetas: { tool: string; tiene: boolean }[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: scripted(edita(), [{ type: "text_delta", text: "listo" }, done]),
      runTool: herramientaQueEdita,
      emit: (ev) => {
        if (ev.type === "action") tarjetas.push({ tool: ev.tool, tiene: "observacion" in ev });
      },
      verifyTurn: async () => ({ estado: "bien" }),
    });
    const visual = tarjetas.filter((t) => t.tool === "verificar_diseno");
    expect(visual.length).toBeGreaterThan(0);
    expect(visual.every((t) => !t.tiene)).toBe(true);
  });

  // Y el caso que más importa de los tres: «medido, y limpio» enumera CUATRO
  // ceros, así que decir «0 errores de JavaScript» de una página cuyo botón
  // abre un prompt() que nosotros cancelamos es la afirmación de más que ese
  // bloque existe para no hacer. Los dos bloques viajan juntos.
  it("🔴 «limpio» y los límites salen JUNTOS, o «limpio» afirma de más", async () => {
    const vistos: Message[][] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
      runTool: herramientaQueEdita,
      emit: () => {},
      medirParaElModelo: async () => ({
        mobileOverflow: false,
        unreadableText: [],
        runtimeErrors: [],
        clasesMuertas: [],
        dialogosNativos: ["prompt: Nombre:"],
      }),
    });
    const contenido = (vistos[1] ?? []).find((m) => m.functionResponses)?.content ?? "";
    expect(contenido).toContain("no encontró defectos");
    expect(contenido).toContain("<limites-de-la-medida>");
  });

  // 🔴 EL CARRITO DEL 2026-09-18. Lo que el servidor rechazaría en el almacén
  // es un DEFECTO, no un límite: tiene que llegar en el siguiente paso, con su
  // motivo y la forma buena — el `is_error` de Claude Code — y nunca como
  // «limpio».
  it("🔴 un rechazo del almacén llega al modelo como defecto, con el motivo y la ruta buena", async () => {
    const vistos: Message[][] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "ponme un carrito con base de datos" }],
      tools: [],
      openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
      runTool: herramientaQueEdita,
      emit: () => {},
      medirParaElModelo: async () => ({
        mobileOverflow: false,
        unreadableText: [],
        runtimeErrors: [],
        clasesMuertas: [],
        llamadasADatos: [
          { metodo: "POST", ruta: "/api/d/carrito/carrito", status: 403, error: "origen_invalido" },
        ],
      }),
    });
    const contenido = (vistos[1] ?? []).find((m) => m.functionResponses)?.content ?? "";
    expect(contenido).toContain("<medido-tras-editar>");
    expect(contenido).toContain("403 origen_invalido");
    expect(contenido).toContain("`/api/d/<almacén>`, sin subdominio");
    expect(contenido).not.toContain("no encontró defectos");
  });

  it("CONTRA-PRUEBA: sin diálogos ni llamadas, el sobre de límites no aparece", async () => {
    const vistos: Message[][] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
      runTool: herramientaQueEdita,
      emit: () => {},
      medirParaElModelo: async () => ({
        mobileOverflow: false,
        unreadableText: [],
        runtimeErrors: [],
        clasesMuertas: [],
      }),
    });
    const contenido = (vistos[1] ?? []).find((m) => m.functionResponses)?.content ?? "";
    expect(contenido).not.toContain("<limites-de-la-medida>");
  });

  /**
   * 🔴 EL LLAMADOR QUE SE OLVIDA DE UN EJE NO PUEDE COBRARSE UN «LIMPIO».
   *
   * Al añadir `clasesMuertas` (2026-09-08) esta prueba de arriba se puso roja
   * sola: pasaba tres ejes y reclamaba «limpio». Bien — es la regla de «un campo
   * ausente no es un cero» funcionando END-TO-END y no sólo en la unidad.
   *
   * Se fija por separado porque es lo que protege del fallo real: hay DOS
   * implementaciones de `medirParaElModelo` —la ruta y el arnés— y si una añade
   * el eje y la otra no, la que se quede atrás seguiría diciendo «limpio»
   * mientras deja de mirar una cosa. Aquí se queda MUDA, que es lo correcto.
   */
  it("🔴 una medición a la que le falta un eje NO dice «limpio»: calla", async () => {
    const vistos: Message[][] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
      runTool: herramientaQueEdita,
      emit: () => {},
      // Los tres de siempre, sin el cuarto.
      medirParaElModelo: async () => ({ mobileOverflow: false, unreadableText: [], runtimeErrors: [] }),
    });
    expect((vistos[1] ?? []).find((m) => m.functionResponses)?.content ?? "").toBe("");
  });

  // Y la clase muerta llega al modelo con su literal y su sustituto, que es lo
  // único que la hace accionable: se busca por la clase, no por el nodo.
  it("una clase que no pinta nada llega al modelo, con el arreglo dentro", async () => {
    const vistos: Message[][] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
      runTool: herramientaQueEdita,
      emit: () => {},
      medirParaElModelo: async () => ({
        mobileOverflow: false,
        unreadableText: [],
        runtimeErrors: [],
        clasesMuertas: [
          {
            enClase: "mt-3 text-sm text( --ol-fg-muted )",
            muerta: "text( --ol-fg-muted )",
            enSuLugar: "text-[var(--ol-fg-muted)]",
          },
        ],
      }),
    });
    const contenido = (vistos[1] ?? []).find((m) => m.functionResponses)?.content ?? "";
    expect(contenido).toContain("text( --ol-fg-muted )");
    expect(contenido).toContain("text-[var(--ol-fg-muted)]");
    // Y NO se cuela un «limpio» junto al defecto.
    expect(contenido).not.toContain("no encontró defectos");
  });

  it("si el medidor lanza, el turno sigue y el usuario se queda con su cambio", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: scripted(edita(), [{ type: "text_delta", text: "Hecho." }, done]),
      runTool: herramientaQueEdita,
      emit: () => {},
      medirParaElModelo: async () => {
        throw new Error("Chromium no arrancó");
      },
    });
    expect(r.finalText).toContain("Hecho.");
    expect(r.terminalError).toBe(false);
  });

  it("no se mide dos veces el mismo documento", async () => {
    let veces = 0;
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: scripted(edita(), edita(), [{ type: "text_delta", text: "ok" }, done]),
      // Las dos tandas devuelven EL MISMO gemelo: la segunda no tocó nada.
      runTool: herramientaQueEdita,
      emit: () => {},
      medirParaElModelo: async () => {
        veces += 1;
        return {};
      },
    });
    expect(veces).toBe(1);
  });

  it("el mismo defecto no se le repite en la segunda tanda", async () => {
    const vistos: Message[][] = [];
    let n = 0;
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: mirando(vistos, scripted(edita(), edita(), [{ type: "text_delta", text: "ok" }, done])),
      // Cada tanda entrega un documento DISTINTO, así que sí se vuelve a medir.
      runTool: async () => {
        n += 1;
        return {
          response: { ok: true },
          action: { tool: "editar_pagina", ok: true, summary: "e" },
          updatedHtml: `<html>v${n}</html>`,
          taggedHtml: `<html data-op-id="bs">v${n}</html>`,
          page: null,
        };
      },
      emit: () => {},
      medirParaElModelo: async () => desbordado,
    });
    // La ÚLTIMA foto lleva el historial entero. Contar sobre `vistos.flat()`
    // contaría el mismo mensaje una vez por vuelta.
    const ultima = vistos.at(-1) ?? [];
    const sobres = ultima.filter((m) => m.functionResponses).map((m) => m.content);
    expect(sobres).toHaveLength(2);
    expect(sobres.filter((c) => c && c.includes("data-op-id=bs"))).toHaveLength(1);
  });

  // ── LA LÍNEA BASE ───────────────────────────────────────────────────────
  //
  // La forma de Claude Code: se mide ANTES de editar y sólo se reporta la
  // diferencia. Sin esto, una página que ya venía rota se lo decía una vez por
  // cada turno que la editara, aunque el modelo no la hubiera tocado.
  describe("la línea base", () => {
    const BASE = '<html data-op-id="bs">antes</html>';
    const conBase = { taggedHtml: BASE, page: null };

    it("🔴 un defecto que YA venía en el documento NO se le dice", async () => {
      const vistos: Message[][] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "cambia el título" }],
        tools: [],
        openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
        runTool: herramientaQueEdita,
        emit: () => {},
        // La misma medida para el documento editado Y para la base: el
        // desborde estaba ahí antes de que el modelo tocara nada.
        medirParaElModelo: async () => desbordado,
        lineaBase: conBase,
      });
      const sobres = (vistos.at(-1) ?? []).filter((m) => m.functionResponses).map((m) => m.content);
      expect(sobres.join("")).not.toContain("data-op-id=bs");
      expect(sobres.every((c) => c === "")).toBe(true);
    });

    it("CONTRA-PRUEBA: si la base estaba limpia, el defecto ES suyo y se le dice", async () => {
      const vistos: Message[][] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
        runTool: herramientaQueEdita,
        emit: () => {},
        medirParaElModelo: async (html) => (html === BASE ? {} : desbordado),
        lineaBase: conBase,
      });
      const sobres = (vistos.at(-1) ?? []).filter((m) => m.functionResponses).map((m) => m.content);
      expect(sobres.join("")).toContain("data-op-id=bs");
    });

    it("🔴 la base NO se mide cuando la página salió bien — es el caso normal y no paga render", async () => {
      const medidos: string[] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: scripted(edita(), [{ type: "text_delta", text: "ok" }, done]),
        runTool: herramientaQueEdita,
        emit: () => {},
        medirParaElModelo: async (html) => {
          medidos.push(html);
          return {};
        },
        lineaBase: conBase,
      });
      expect(medidos).toEqual(['<html data-op-id="bs">etiquetado</html>']);
    });

    it("la base se mide UNA vez aunque haya varias tandas con defecto", async () => {
      let n = 0;
      const medidos: string[] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: scripted(edita(), edita(), [{ type: "text_delta", text: "ok" }, done]),
        runTool: async () => {
          n += 1;
          return {
            response: { ok: true },
            action: { tool: "editar_pagina", ok: true, summary: "e" },
            updatedHtml: `<html>v${n}</html>`,
            taggedHtml: `<html data-op-id="b${n}">v${n}</html>`,
            page: null,
          };
        },
        emit: () => {},
        medirParaElModelo: async (html) => {
          medidos.push(html);
          return html === BASE ? {} : { ...desbordado, overflowCulpritOpId: `b${n}` };
        },
        lineaBase: conBase,
      });
      expect(medidos.filter((h) => h === BASE)).toHaveLength(1);
    });

    it("🔴 una base que falla NO se reintenta tanda tras tanda", async () => {
      let n = 0;
      const medidos: string[] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: scripted(edita(), edita(), [{ type: "text_delta", text: "ok" }, done]),
        runTool: async () => {
          n += 1;
          return {
            response: { ok: true },
            action: { tool: "editar_pagina", ok: true, summary: "e" },
            updatedHtml: `<html>v${n}</html>`,
            taggedHtml: `<html data-op-id="b${n}">v${n}</html>`,
            page: null,
          };
        },
        emit: () => {},
        // La base no se puede medir NUNCA; el documento editado sí.
        medirParaElModelo: async (html) => {
          medidos.push(html);
          return html === BASE ? null : { ...desbordado, overflowCulpritOpId: `b${n}` };
        },
        lineaBase: conBase,
      });
      expect(medidos.filter((h) => h === BASE)).toHaveLength(1);
    });

    it("🔴 si el turno editó OTRA página no se resta nada: los op-id son por documento", async () => {
      const vistos: Message[][] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
        // El turno arrancó en la Home (`page: null`) y editó `/tienda`.
        runTool: async () => ({
          response: { ok: true },
          action: { tool: "editar_pagina", ok: true, summary: "e" },
          updatedHtml: "<html>v</html>",
          taggedHtml: '<html data-op-id="bs">etiquetado</html>',
          page: "tienda",
        }),
        emit: () => {},
        medirParaElModelo: async () => desbordado,
        lineaBase: conBase,
      });
      const sobres = (vistos.at(-1) ?? []).filter((m) => m.functionResponses).map((m) => m.content);
      expect(sobres.join("")).toContain("data-op-id=bs");
    });

    it("🔴 se pidió base y no se pudo medir ⇒ no se habla: sin base, «NUEVO» no se puede saber", async () => {
      const vistos: Message[][] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
        runTool: herramientaQueEdita,
        emit: () => {},
        medirParaElModelo: async (html) => (html === BASE ? null : desbordado),
        lineaBase: conBase,
      });
      const sobres = (vistos.at(-1) ?? []).filter((m) => m.functionResponses).map((m) => m.content);
      expect(sobres.join("")).not.toContain("data-op-id=bs");
    });
  });
});

// ─── EL OBJETIVO: una CONDICIÓN DE PARADA ────────────────────────────────────
//
// Copiado de Claude Code: el turno no termina mientras un
// evaluador APARTE no confirme la condición. Allí vive en la ranura de los Stop
// hooks; aquí, en `cerrarTurno` — el embudo que se extrajo porque el turno
// acababa en CUATRO sitios distintos.
//
// Todo con un evaluador FALSO: el mecanismo entero se prueba sin gastar una sola
// llamada, igual que `verifyTurn` y `medirParaElModelo`.
//
// 🔴 Y EL MODELO LLAMA A UNA HERRAMIENTA en la primera vuelta a propósito. Un
// turno que cierra sin llamar a NADA dispara la insistencia de `yaSeInsistio`
// —una vuelta extra que no tiene nada que ver con el objetivo— y mediría dos
// cosas a la vez. Costó una depuración averiguarlo: mis primeras pruebas daban
// dos aperturas y culpé al embudo, cuando en HEAD pasaba exactamente igual.
describe("el objetivo", () => {
  const juez = (guion: ("cumplida" | "no_cumplida" | "imposible")[]) => {
    const estado = { n: 0 };
    return {
      estado,
      evaluar: async () => {
        const v = guion[Math.min(estado.n, guion.length - 1)]!;
        estado.n += 1;
        return { ok: true as const, resultado: { veredicto: v, razon: `porque ${v}` } };
      },
    };
  };
  /** Llama a una herramienta y luego cierra hablando, tantas veces como haga falta. */
  const trabajaYCierra = () =>
    scripted(
      [{ type: "function_call", name: "editar_texto", args: {}, thoughtSignature: "s" }, usage(10), done],
      [{ type: "text_delta", text: "listo" }, usage(10), done],
    );
  const base = (objetivo?: Parameters<typeof runAgentLoop>[0]["objetivo"]) => ({
    messages: [{ role: "user" as const, content: "x" }],
    tools: [],
    runTool: async () => ({ response: { ok: true }, action: { tool: "editar_texto", ok: true, summary: "" } }),
    emit: () => {},
    ...(objetivo ? { objetivo } : {}),
  });

  // 🔴 BRAZO DE CONTROL. Sin esto, un bucle que SIEMPRE sigue se leería como que
  // funciona: hay que ver que una condición ya cumplida cierra a la primera.
  it("una condición ya cumplida cierra sin vueltas extra", async () => {
    const j = juez(["cumplida"]);
    const r = await runAgentLoop({
      ...base({ condicion: "el titular dice Vitalvet", maxVueltas: 3, evaluar: j.evaluar }),
      openStream: trabajaYCierra(),
    });
    expect(r.objetivo).toMatchObject({ veredicto: "cumplida", vueltasExtra: 0 });
    expect(j.estado.n).toBe(1);
  });

  it("🔴 si NO se cumple, el turno no termina: se le invoca otra vez", async () => {
    const j = juez(["no_cumplida", "cumplida"]);
    const conObjetivo = await runAgentLoop({
      ...base({ condicion: "c", maxVueltas: 3, evaluar: j.evaluar }),
      openStream: trabajaYCierra(),
    });
    const sinObjetivo = await runAgentLoop({ ...base(), openStream: trabajaYCierra() });
    expect(conObjetivo.turns).toBe(sinObjetivo.turns + 1);
    expect(conObjetivo.objetivo).toMatchObject({ veredicto: "cumplida", vueltasExtra: 1 });
  });

  it("y la RAZÓN del evaluador le llega al modelo", async () => {
    const vistos: Message[][] = [];
    const j = juez(["no_cumplida", "cumplida"]);
    const flujo = trabajaYCierra();
    await runAgentLoop({
      ...base({ condicion: "el titular dice Vitalvet", maxVueltas: 3, evaluar: j.evaluar }),
      openStream: (m) => { vistos.push([...m]); return flujo(m); },
    });
    const ultimo = JSON.stringify(vistos.at(-1) ?? []);
    expect(ultimo).toContain("porque no_cumplida");
    expect(ultimo).toContain("el titular dice Vitalvet");
    // Y el porqué de que el evaluador no lo vea: falta EVIDENCIA, no insistir.
    expect(ultimo).toContain("EVIDENCIA");
  });

  it("«imposible» cierra en vez de perseguirlo para siempre", async () => {
    const j = juez(["imposible"]);
    const r = await runAgentLoop({
      ...base({ condicion: "cobrar con tarjeta", maxVueltas: 5, evaluar: j.evaluar }),
      openStream: trabajaYCierra(),
    });
    expect(r.objetivo?.veredicto).toBe("imposible");
    expect(r.objetivo?.vueltasExtra).toBe(0);
  });

  // 🔴 EL FALLO CAE HACIA PARAR. Seguir «por si acaso» gastaría créditos del
  // usuario contra una condición que nadie está comprobando.
  it("si el evaluador revienta, el turno CIERRA", async () => {
    const r = await runAgentLoop({
      ...base({
        condicion: "c",
        maxVueltas: 5,
        evaluar: async () => ({ ok: false as const, motivo: "respuesta_ilegible" }),
      }),
      openStream: trabajaYCierra(),
    });
    expect(r.objetivo).toMatchObject({ veredicto: "sin_evaluador", razon: "respuesta_ilegible" });
    expect(r.objetivo?.vueltasExtra).toBe(0);
  });

  // 🔴 EL PRESUPUESTO, que es lo que Claude Code NO necesita: el suyo corre en un
  // terminal que el usuario mira; éste, sobre créditos prepago y sin nadie
  // delante. «Seguir hasta que se cumpla» sin tope vacía un saldo.
  it("el presupuesto para el bucle, y lo dice", async () => {
    const j = juez(["no_cumplida"]);
    const r = await runAgentLoop({
      ...base({ condicion: "c", maxVueltas: 2, evaluar: j.evaluar }),
      openStream: trabajaYCierra(),
    });
    expect(r.objetivo?.veredicto).toBe("no_cumplida");
    expect(r.objetivo?.razon).toMatch(/presupuesto/);
    expect(r.objetivo?.vueltasExtra).toBe(2);
    // Y no se preguntó una tercera vez: el tope se mira ANTES de gastar.
    expect(j.estado.n).toBe(2);
  });

  // ── EL DUEÑO LO CANCELÓ A MEDIA FAENA ────────────────────────────────────
  //
  // 🔴 LA VARA ES CLAUDE CODE, y ahí el objetivo NO es un dato copiado al arrancar
  // el turno: es un hook de `Stop` en un registro, y `/goal clear` lo QUITA del
  // registro. En cada punto de decisión se relee el estado vivo y se abandona si
  // cambió —«…»—, así que
  // cancelar surte efecto en el turno EN CURSO.
  //
  // Nosotros lo congelábamos en la ruta, así que un dueño que cancelaba seguía
  // PAGANDO hasta dos vueltas de evaluador por un objetivo que acababa de
  // abandonar. `sigueVigente` es una lectura de base, cero llamadas de modelo, y
  // se consulta ANTES de gastar el juez.
  it("🔴 si el dueño lo canceló, NI SE EVALÚA: el turno cierra y no se le cobra el juez", async () => {
    const j = juez(["no_cumplida"]);
    const r = await runAgentLoop({
      ...base({
        condicion: "c",
        maxVueltas: 3,
        evaluar: j.evaluar,
        sigueVigente: async () => false,
      }),
      openStream: trabajaYCierra(),
    });
    // El juez NO se llamó: eso es lo que cuesta dinero.
    expect(j.estado.n).toBe(0);
    // Y el turno cerró sin dar vueltas extra ni inventarse un veredicto sobre
    // una condición que ya no existe.
    expect(r.objetivo).toBeUndefined();
  });

  // 🔴 BRAZO DE CONTROL: con el objetivo vigente, `sigueVigente` no cambia nada.
  // Sin esto, una implementación que se saltara SIEMPRE el juez pasaría la de
  // arriba y rompería el objetivo entero en silencio.
  it("si sigue vigente, se evalúa igual que siempre", async () => {
    const j = juez(["cumplida"]);
    const r = await runAgentLoop({
      ...base({
        condicion: "c",
        maxVueltas: 3,
        evaluar: j.evaluar,
        sigueVigente: async () => true,
      }),
      openStream: trabajaYCierra(),
    });
    expect(j.estado.n).toBe(1);
    expect(r.objetivo).toMatchObject({ veredicto: "cumplida" });
  });

  // Sin la dependencia, el bucle se comporta EXACTAMENTE como antes de que
  // existiera: la ruta puede no pasarla y nada cambia.
  it("sin `sigueVigente` se evalúa como siempre", async () => {
    const j = juez(["cumplida"]);
    const r = await runAgentLoop({
      ...base({ condicion: "c", maxVueltas: 3, evaluar: j.evaluar }),
      openStream: trabajaYCierra(),
    });
    expect(j.estado.n).toBe(1);
    expect(r.objetivo?.veredicto).toBe("cumplida");
  });

  it("sin objetivo, el bucle no lo menciona siquiera", async () => {
    const r = await runAgentLoop({ ...base(), openStream: trabajaYCierra() });
    expect(r.objetivo).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EL TEXTO DE DOS VUELTAS SE PEGABA SIN \n\nARADOR.
//
// 🔴 MEDIDO EN PRODUCCIÓN el 2026-09-08: 9 de 57 turnos con texto traen la
// junta, desde el 2026-07-30. Y todas caen en frontera de vuelta —
// «…lo arreglo. ¿Seguimos?Voy a corregir los dos problemas:…»,
// «…en la navegación)?Comprobé en un navegador…». Ningún modelo escribe
// «¿Seguimos?Voy a». Es cierre de una vuelta pegado a la apertura de la
// siguiente.
//
// LA CAUSA: `turnText` se declara DENTRO del bucle, así que el servidor lo
// reinicia cada vuelta — correcto, porque es el `content` del mensaje del
// asistente de ESA vuelta. Pero el cliente acumula los eventos `text` del turno
// ENTERO (`accumulatedReasoning += text`, sin reinicio), así que ve las vueltas
// concatenadas a hueso.
//
// El separador viaja SÓLO al cliente, nunca a `turnText`: meterlo ahí le pondría
// un salto de línea a la cabeza al mensaje que se le manda al modelo.
// ─────────────────────────────────────────────────────────────────────────────
describe("el texto de varias vueltas", () => {
  const recoger = (events: AgentStreamEvent[]) =>
    events
      .filter((e): e is Extract<AgentStreamEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.text)
      .join("");

  it("🔴 separa lo que dijo cada vuelta, en vez de pegarlo", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: scripted(
        [{ type: "text_delta", text: "Voy a mirarlo." }, { type: "function_call", name: "leer_estado", args: {} }, done],
        [{ type: "text_delta", text: "El titular dice X." }, done],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => void events.push(e),
    });
    const texto = recoger(events);
    expect(texto).not.toContain("mirarlo.El titular");
    expect(texto).toBe("Voy a mirarlo." + "\n\n" + "El titular dice X.");
  });

  // 🔴 BRAZO DE CONTROL: una sola vuelta con texto NO gana separador. Sin esto,
  // «meter siempre un salto» pasaría la de arriba y le abriría un hueco en
  // blanco a TODOS los turnos normales, que son la mayoría.
  //
  // ⚠️ La vuelta LLAMA a una herramienta a propósito. Sin llamar a ninguna se
  // dispara `INSISTE_SIN_HERRAMIENTAS` —la guarda del turno que anuncia y no
  // hace— el bucle da otra vuelta, y `scripted` repite su última entrada: el
  // texto sale «Hola.Hola.» por el arnés, no por el producto. Descubierto
  // escribiendo esta misma prueba.
  it("una sola vuelta con texto sale byte a byte igual que antes", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: scripted(
        [{ type: "text_delta", text: "Hola." }, { type: "function_call", name: "leer_estado", args: {} }, done],
        [done],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => void events.push(e),
    });
    expect(recoger(events)).toBe("Hola.");
  });

  // Y una vuelta MUDA no deja separador colgando: si la primera no dijo nada,
  // la segunda abre el texto y no lleva nada delante.
  it("una vuelta sin texto no deja un separador huérfano", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "leer_estado", args: {} }, done],
        [{ type: "text_delta", text: "Ya está." }, done],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => void events.push(e),
    });
    expect(recoger(events)).toBe("Ya está.");
  });
});

// ─── EL BUCLE QUE SALE BIEN, Y EL CIERRE QUE NO CUENTA ────────────────────────
//
// Los dos fallos que la batería del 2026-09-11 destapó en `carrito-se-construye`
// y `tope-no-miente`, y los dos son NUESTROS: se reprodujeron con Pro y con
// v4.1 Flash. Ver los comentarios de `SAME_INTENT_LIMIT` y de `finishOnCap`.
describe("la misma intención, repetida, no gasta el turno entero", () => {
  const mismaLlamada = (): StreamEvent[] => [
    { type: "function_call", name: "editar_runtime", args: { codigo: "x", resumen: "el carrito con total" } },
    done,
  ];

  it("a la TERCERA se le refusa y se le dice que cambie de enfoque, sin cortar el turno", async () => {
    const ejecutadas: string[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "ponme un carrito" }],
      tools: [],
      maxTurns: 8,
      openStream: scripted(
        mismaLlamada(), mismaLlamada(), mismaLlamada(), mismaLlamada(),
        [{ type: "text_delta", text: "Lo dejé a medias." }, done],
      ),
      runTool: async (name, args) => {
        ejecutadas.push(String((args as { resumen?: string }).resumen));
        return { response: { ok: true, cambio: "cambio" }, updatedHtml: "<html></html>" };
      },
      emit: () => {},
    });
    // Se ejecutan DOS; la tercera ni llega a la herramienta. El umbral cae
    // DENTRO del presupuesto de turnos — en 3 era inalcanzable, medido.
    expect(ejecutadas).toHaveLength(2);
    // Y el turno NO muere: cierra por su cuenta.
    expect(r.terminalError).toBe(false);
  });

  // 🔴 ESTE BRAZO CAMBIÓ DE HERRAMIENTA el 2026-09-11, y su sustancia NO: sigue
  // afirmando que cuatro resúmenes DISTINTOS son trabajo y no bucle.
  //
  // Lo que cambia es sobre QUÉ lo afirma. Usaba `editar_runtime`, y eso resultó
  // ser el ejemplo equivocado: esa herramienta construye
  // `{op:"replace", target:"runtime"}` (`tools.ts:2374`) — un reemplazo de UN
  // solo destino—, así que «el carrito», «el menú», «el filtro» y «la galería»
  // no son cuatro trabajos sino cuatro reescrituras del MISMO fichero, y salvo
  // que el modelo reenvíe todo cada vez, las tres primeras se pierden. La
  // prueba tampoco ejercitaba la herramienta real: pasaba `codigo`, y la real
  // exige `script`, o sea que `editar_runtime` era sólo una ETIQUETA para
  // probar el guardia del bucle.
  //
  // `editar_pagina` sí edita nodos concretos, así que ahí cuatro resúmenes
  // distintos son cuatro trabajos de verdad y la afirmación original se sostiene
  // sin apoyarse en una semántica que no era.
  it("BRAZO DE CONTROL: resúmenes DISTINTOS no se tocan — son trabajo, no bucle", async () => {
    const ejecutadas: string[] = [];
    const turno = (resumen: string): StreamEvent[] => [
      {
        type: "function_call",
        name: "editar_pagina",
        args: { edits: [{ op: "replace", target: "op-1", new_html: "<p>x</p>" }], resumen },
      },
      done,
    ];
    await runAgentLoop({
      messages: [{ role: "user", content: "haz cuatro cosas" }],
      tools: [],
      maxTurns: 8,
      openStream: scripted(
        turno("el carrito"), turno("el menú"), turno("el filtro"), turno("la galería"),
        [{ type: "text_delta", text: "Hechas." }, done],
      ),
      runTool: async (_n, args) => {
        ejecutadas.push(String((args as { resumen?: string }).resumen));
        return { response: { ok: true, cambio: "cambio" }, updatedHtml: "<html></html>" };
      },
      emit: () => {},
    });
    expect(ejecutadas).toHaveLength(4);
  });
});

describe("al cerrar por tope se le devuelven los HECHOS, no se le pide memoria", () => {
  it("el cierre lleva la lista de lo que SÍ se aplicó", async () => {
    const cierres: string[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el titular, crea servicios y pon el teléfono" }],
      tools: [],
      maxTurns: 1,
      openStream: scripted([
        { type: "function_call", name: "editar_texto", args: { resumen: "titular Vitalvet" } },
        done,
      ]),
      runTool: async () => ({
        response: { ok: true, cambio: "cambio" },
        updatedHtml: "<html>Vitalvet</html>",
        action: { tool: "editar_texto", ok: true, summary: "titular Vitalvet" },
      }),
      closeOut: (msgs) => {
        cierres.push(String(msgs[msgs.length - 1]?.content ?? ""));
        return (async function* () { yield { type: "text_delta", text: "Hice el titular." } as StreamEvent; })();
      },
      emit: () => {},
    });
    expect(cierres).toHaveLength(1);
    // El hecho medido viaja al cierre, con su nombre.
    expect(cierres[0]).toContain("titular Vitalvet");
    expect(cierres[0]).toContain("PENDIENTE");
  });

  it("y si no se aplicó NADA, el cierre lo dice tal cual en vez de callarlo", async () => {
    const cierres: string[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "haz tres cosas" }],
      tools: [],
      maxTurns: 1,
      openStream: scripted([{ type: "function_call", name: "leer_estado", args: {} }, done]),
      runTool: async () => ({ response: { ok: true } }),
      closeOut: (msgs) => {
        cierres.push(String(msgs[msgs.length - 1]?.content ?? ""));
        return (async function* () { yield { type: "text_delta", text: "No alcancé." } as StreamEvent; })();
      },
      emit: () => {},
    });
    expect(cierres[0]).toContain("NO se aplicó ningún cambio");
  });
});

// ───── I6 · EL CORTE ES HONESTO ─────
//
// Al llegar al tope, el cierre ya recibe LO QUE SE APLICÓ (ver el bloque de
// arriba). Lo que faltaba es la otra mitad: si una de esas escrituras dejó la
// página ROTA —el `<script>` buscando elementos que ya no existen—, el turno
// terminaba sin decirlo. Ése es el turno 1 del caso medido el 2026-09-14: siete
// ediciones, límite de pasos, y un cierre que no mencionaba que la página había
// dejado de funcionar. El usuario se enteró por el modal.
//
// El estado se toma de la ÚLTIMA escritura, no acumulado: `persistPage` retira
// el aviso cuando la edición siguiente lo arregla, así que acumular haría que
// el cierre denunciara una avería ya reparada.
describe("I6 · al cerrar por tope se dice si la página quedó rota", () => {
  it("una edición que rompe el script se nombra en el cierre", async () => {
    const cierres: string[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "quita el carrito" }],
      tools: [],
      maxTurns: 1,
      openStream: scripted([
        { type: "function_call", name: "editar_pagina", args: { resumen: "quitar carrito" } },
        done,
      ]),
      runTool: async () => ({
        response: { ok: true, cambio: "cambio", referencias_rotas: ["carrito", "total"] },
        updatedHtml: "<html>sin carrito</html>",
        action: { tool: "editar_pagina", ok: true, summary: "quitar carrito" },
      }),
      closeOut: (msgs) => {
        cierres.push(String(msgs[msgs.length - 1]?.content ?? ""));
        return (async function* () { yield { type: "text_delta", text: "Listo." } as StreamEvent; })();
      },
      emit: () => {},
    });
    expect(cierres[0]).toContain("carrito");
    expect(cierres[0]).toContain("total");
    expect(cierres[0]).toMatch(/rota|dejó de funcionar|no funciona/i);
  });

  it("si la edición SIGUIENTE lo arregla, el cierre ya no lo denuncia", async () => {
    const cierres: string[] = [];
    let n = 0;
    await runAgentLoop({
      messages: [{ role: "user", content: "quita el carrito y arregla el script" }],
      tools: [],
      maxTurns: 2,
      openStream: scripted(
        [{ type: "function_call", name: "editar_pagina", args: { resumen: "quitar carrito" } }, done],
        [{ type: "function_call", name: "editar_runtime", args: { resumen: "script sin carrito" } }, done],
      ),
      runTool: async () => {
        n += 1;
        return {
          response:
            n === 1
              ? { ok: true, cambio: "cambio", referencias_rotas: ["carrito"] }
              : { ok: true, cambio: "cambio" },
          updatedHtml: `<html>v${n}</html>`,
          action: { tool: "editar_pagina", ok: true, summary: `paso ${n}` },
        };
      },
      closeOut: (msgs) => {
        cierres.push(String(msgs[msgs.length - 1]?.content ?? ""));
        return (async function* () { yield { type: "text_delta", text: "Listo." } as StreamEvent; })();
      },
      emit: () => {},
    });
    expect(cierres[0]).not.toContain("carrito");
  });

  it("BRAZO DE CONTROL: sin roturas, el cierre sale como antes", async () => {
    const cierres: string[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el titular" }],
      tools: [],
      maxTurns: 1,
      openStream: scripted([
        { type: "function_call", name: "editar_texto", args: { resumen: "titular" } },
        done,
      ]),
      runTool: async () => ({
        response: { ok: true, cambio: "cambio" },
        updatedHtml: "<html>x</html>",
        action: { tool: "editar_texto", ok: true, summary: "titular" },
      }),
      closeOut: (msgs) => {
        cierres.push(String(msgs[msgs.length - 1]?.content ?? ""));
        return (async function* () { yield { type: "text_delta", text: "Hecho." } as StreamEvent; })();
      },
      emit: () => {},
    });
    expect(cierres[0]).not.toMatch(/rota|dejó de funcionar/i);
  });
});

// ───── E2 · EL TOPE VIVE EN EL PLAN, NO EN EL TURNO ─────
//
// Visto en Claude Code: su bucle principal NO lleva tope
// de pasos —`maxTurns` es un campo opcional por definición de agente, «…»— y lo que acota
// una sesión larga es el CONTEXTO, con auto-compactación que CONTINÚA en vez de
// parar («…»).
//
// El dinero lo topa por MES y por cuenta: «…», con auto-recarga. El turno no se corta
// nunca por presupuesto.
//
// Nosotros ya tenemos ese tope mensual (`CREDITS_BY_PLAN`), así que el tope por
// turno era un SEGUNDO muro, redundante con el primero — y era el que partía el
// trabajo en dos. Se relaja hasta el absoluto para quien paga por mes, y se
// deja como estaba para el plan gratuito, que no tiene auto-recarga: ahí el
// muro del mes es un muro de verdad y gastarse medio saldo en un turno sí es
// una pérdida.
describe("E2 · turnosPorPlan", () => {
  it("los topes son 12/20 para TODOS — ya no hay puerta por plan", () => {
    expect(topesPorPlan()).toEqual({ maxTurns: 12, maxToolCalls: 20 });
  });

  it("🔴 los DOS topes suben juntos — subir sólo las vueltas no movería nada", () => {
    // El de herramientas es el más bajo de los dos en la práctica: una edición
    // por vuelta gasta una llamada por vuelta. Con 12 vueltas y 10 llamadas el
    // corte seguiría llegando en la 10.
    const pro = topesPorPlan();
    expect(pro.maxToolCalls).toBeGreaterThanOrEqual(pro.maxTurns);
  });

  it("y el bucle de verdad honra las 12 vueltas de un pro", async () => {
    let mutaciones = 0;
    // Cada vuelta declara una intención DISTINTA: si se repitiera el mismo
    // `resumen`, quien pararía el turno sería el guarda de intención repetida
    // (`SAME_INTENT_LIMIT`, 2026-09-11) y esta prueba estaría midiendo ése en
    // vez del tope. Se comprueba abajo que el motivo del corte es el tope.
    let vuelta = 0;
    const openStream = () => {
      vuelta += 1;
      return (async function* () {
        yield { type: "function_call", name: "editar_pagina", args: { resumen: `sección ${vuelta}` } } as StreamEvent;
        yield done;
      })();
    };
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hazme el sitio entero" }],
      tools: [],
      ...topesPorPlan(),
      openStream,
      runTool: async () => {
        mutaciones += 1;
        return {
          response: { ok: true, cambio: "cambio" },
          updatedHtml: `<html>v${mutaciones}</html>`,
          action: { tool: "editar_pagina", ok: true, summary: `sección ${mutaciones}` },
        };
      },
      emit: () => {},
    });
    expect(r.topeAlcanzado).toBe("turn_limit");
    // 12 vueltas que mutan, no 6. El tope ABSOLUTO sigue siendo el techo.
    expect(mutaciones).toBe(12);
  });

  it("y el corte llega en la 12, no antes", async () => {
    let mutaciones = 0;
    let vuelta = 0;
    const openStream = () => {
      vuelta += 1;
      return (async function* () {
        yield { type: "function_call", name: "editar_pagina", args: { resumen: `sección ${vuelta}` } } as StreamEvent;
        yield done;
      })();
    };
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hazme el sitio entero" }],
      tools: [],
      ...topesPorPlan(),
      openStream,
      runTool: async () => {
        mutaciones += 1;
        return {
          response: { ok: true, cambio: "cambio" },
          updatedHtml: `<html>v${mutaciones}</html>`,
          action: { tool: "editar_pagina", ok: true, summary: `sección ${mutaciones}` },
        };
      },
      emit: () => {},
    });
    expect(r.topeAlcanzado).toBe("turn_limit");
    expect(mutaciones).toBe(12);
  });
});
