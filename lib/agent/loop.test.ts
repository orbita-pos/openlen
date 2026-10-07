import { describe, expect, it } from "vitest";
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { runAgentLoop, sobreQue, type AgentStreamEvent } from "./loop";

// Repite el ÚLTIMO guion cuando se acaba: así una prueba con \`maxTurns\` llega
// al tope sin escribir doce vueltas. Desde H1 (2026-09-25) el bucle no topa por
// defecto, así que una prueba SIN tope cuyo último guion llama herramientas
// daría vueltas para siempre —sólo microtareas: ni el testTimeout la para, y el
// proceso muere sin memoria—. A las 200 repeticiones, falla con su nombre.
const REPETICIONES_MAXIMAS = 200;
function scripted(...turns: StreamEvent[][]): (messages: Message[]) => AsyncIterable<StreamEvent> {
  let i = 0;
  return () => {
    if (i > REPETICIONES_MAXIMAS) {
      const prueba = expect.getState().currentTestName ?? "(sin nombre)";
      console.warn(`[scripted] SIN FIN en «${prueba}»`);
      throw new Error(`scripted: el guion se repitió ${REPETICIONES_MAXIMAS} veces y el bucle no terminó en «${prueba}» — ¿falta un maxTurns o un último guion que cierre?`);
    }
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

  it("F6a · un bash con `terminal` emite el evento terminal justo detrás de su tarjeta; sin él, no", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "busca Marejada" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "bash", args: { command: "grep -rn Marejada /" } }, { type: "function_call", name: "Read", args: { file_path: "/index.html" } }, usage(10), done],
        [{ type: "text_delta", text: "Está en la portada." }, usage(5), done],
      ),
      runTool: async (name) =>
        name === "bash"
          ? {
              response: { ok: true, tool_result: "/index.html:3:Marejada\n[Command finished with exit code 0]" },
              action: { tool: "bash", ok: true, summary: "grep -rn Marejada /" },
              terminal: { command: "grep -rn Marejada /", salida: "/index.html:3:Marejada\n[Command finished with exit code 0]", exitCode: 0 },
            }
          : { response: { ok: true, tool_result: "1\t<h1>" }, action: { tool: name, ok: true, summary: "/index.html" } },
      emit: (e) => events.push(e),
    });
    const tipos = events.filter((e) => e.type === "action" || e.type === "terminal").map((e) => (e.type === "action" ? `${e.tool}:${e.status}` : e.type));
    expect(tipos).toEqual(["bash:running", "bash:done", "terminal", "Read:running", "Read:done"]);
    expect(events.find((e) => e.type === "terminal")).toEqual({
      type: "terminal",
      command: "grep -rn Marejada /",
      salida: "/index.html:3:Marejada\n[Command finished with exit code 0]",
      exitCode: 0,
    });
  });

  it("one tool call → functionResponse turn → final text", async () => {
    const events: AgentStreamEvent[] = [];
    const seen: string[] = [];
    const callsSeen: Message[][] = [];
    const scriptedStream = scripted(
      [{ type: "function_call", name: "toggle_module", args: { module: "members" } }, usage(10, 30), done],
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
    expect(seen).toEqual(["toggle_module"]);
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
    expect(assistantTurn?.functionCalls?.[0]).toEqual({ name: "toggle_module", args: { module: "members" } });
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

  // 🔴 N41 (taller, 03/10): LO QUE LEE EL MODELO NO VA A LA TARJETA.
  //
  // Desde el 2026-09-18 la tarjeta roja pintaba el `error` que la herramienta
  // le devolvía al modelo («un solo texto, como Claude Code»). Con Len en inglés
  // el dueño leía «falló · the user has never said "reformas-bernal" — you made
  // that name up…». Ahora la tarjeta lleva el motivo DEL DUEÑO, en código, y
  // sólo si la herramienta lo declaró; el chat compone la frase en su idioma.
  it("🔴 un fallo lleva el motivo del dueño que declaró la herramienta, no el texto del modelo", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "publish", args: {} }, done],
        [{ type: "text_delta", text: "¿qué dirección quieres?" }, done],
      ),
      runTool: async () => ({
        response: { ok: false, error: 'the user has never said "reformas-bernal" — you made that name up' },
        ownerReason: { code: "address_needed" },
      }),
      emit: (e) => events.push(e),
    });
    const fallo = events.find((e) => e.type === "action" && e.status === "error");
    expect(fallo).toBeDefined();
    expect((fallo as { ownerReason?: unknown }).ownerReason).toEqual({ code: "address_needed" });
    expect("motivo" in fallo!).toBe(false);
  });

  it("un fallo sin motivo del dueño no lleva ninguno: la tarjeta dirá «No pudo»", async () => {
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
    expect("motivo" in fallo!).toBe(false);
    expect("ownerReason" in fallo!).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // UN AVISO DEL SERVIDOR SE VE, EN ÁMBAR (2026-09-18).
  //
  // MEDIDO en producción esa noche: «ponme un carrito con base de datos». La
  // herramienta le avisó al modelo dos veces y en la pantalla del dueño no había
  // ni una tarjeta que lo dijera — la edición se aplicó, así que todas eran
  // verdes. El motivo vivía en un `console.warn` de la caja.
  //
  // ÁMBAR Y NO ROJA: la edición SÍ se guardó, y la roja diría que el trabajo del
  // usuario se perdió. (Nació para la prueba descartada, que desde el
  // 2026-09-22 rechaza la llamada entera y sale roja con razón.)
  it("🔴 una llamada que fue bien CON aviso sale en ámbar, con su aviso", async () => {
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
          aviso_critico: "Esta edición ha quitado 1 formulario(s) que la página SÍ tenía.",
        },
      }),
      emit: (e) => events.push(e),
    });
    const ambar = events.find((e) => e.type === "action" && e.status === "warning");
    expect(ambar).toBeDefined();
    expect((ambar as { motivo?: string }).motivo).toContain("ha quitado 1 formulario");
  });

  // CONTRA-PRUEBA: una edición normal sigue saliendo verde. Sin esto, cualquier
  // cosa que se colara en la respuesta pintaría de ámbar turnos sanos, que es
  // la forma más rápida de que el dueño deje de mirar las tarjetas.
  it("CONTRA-PRUEBA: sin aviso la tarjeta sigue verde", async () => {
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
      // Ni el motivo del dueño: sólo viaja con un fallo.
      runTool: async () => ({ response: { ok: true, error: "no es un fallo" }, ownerReason: { code: "page_changed" } }),
      emit: (e) => events.push(e),
    });
    for (const e of events) {
      if (e.type === "action") {
        expect("motivo" in e).toBe(false);
        expect("ownerReason" in e).toBe(false);
      }
    }
  });

  it("caps runaway loops at maxTurns", async () => {
    const events: AgentStreamEvent[] = [];
    // editar_pagina is a mutating tool — Read/find_photo are read-only
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
    // read-only find_photo and died on turn_limit before it ever edited.
    // Read-only tools are exempt from maxToolCalls (F3-T5) — they must be
    // exempt from maxTurns too, or the turn cap defeats that exemption. Only
    // ABSOLUTE_MAX_TOOL_CALLS bounds a pure read-only chain.
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hero de terror" }], tools: [], maxTurns: 2,
      openStream: scripted(
        [{ type: "function_call", name: "find_photo", args: {} }, done],
        [{ type: "function_call", name: "find_photo", args: {} }, done],
        [{ type: "function_call", name: "Read", args: { file_path: "/index.html" } }, done],
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
        { type: "function_call", name: "find_photo", args: {} },
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
    // editar_pagina is a budgeted (non-read-only) tool — Read/find_photo
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

  it("F3-T5: read-only tools (find_photo) don't count toward maxToolCalls — a photo hunt doesn't burn the budget", async () => {
    const events: AgentStreamEvent[] = [];
    const seen: string[] = [];
    const photoCalls: StreamEvent[] = Array.from({ length: 12 }, (): StreamEvent => ({
      type: "function_call",
      name: "find_photo",
      args: {},
    }));
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "ponme fotos" }], tools: [], maxToolCalls: 10,
      openStream: scripted(
        [
          ...photoCalls,
          { type: "function_call", name: "editar_pagina", args: {} },
          { type: "function_call", name: "toggle_module", args: { module: "chat" } },
          done,
        ],
        [{ type: "text_delta", text: "Listo, puse las fotos." }, done],
      ),
      runTool: async (name) => { seen.push(name); return { response: { ok: true } }; },
      emit: (e) => events.push(e),
    });
    // All 14 calls actually ran — the 12 find_photo ones just didn't count
    // against the 10-call budget, which only the 2 non-exempt calls touch.
    expect(seen).toHaveLength(14);
    expect(seen.filter((n) => n === "find_photo")).toHaveLength(12);
    expect(r.finalText).toBe("Listo, puse las fotos.");
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(r.terminalError).toBe(false);
  });

  // 🔴 LEER NO GASTA PRESUPUESTO — Len 2.0 (plans/len-2/ficheros-plan.md, T8d).
  //
  // En Claude Code, Read, Grep y Glob son lo que se hace ANTES de cada Edit: sin
  // leer no se edita. Si leer descontara del presupuesto de acciones, el
  // contrato que obliga a leer sería justo el que deja el encargo a medias —
  // el mismo fallo que ya se midió con las fotos, aquí arriba.
  it("Read, Grep y Glob no cuentan: buscar, leer y arreglar tres páginas cabe", async () => {
    const seen: string[] = [];
    const events: AgentStreamEvent[] = [];
    const fc = (name: string, args: Record<string, unknown> = {}): StreamEvent => ({ type: "function_call", name, args });
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cambia el teléfono" }], tools: [], maxToolCalls: 3,
      openStream: scripted(
        [fc("Glob", { pattern: "**/*.html" }), fc("Grep", { pattern: "600112233" }), done],
        [fc("Read", { file_path: "/index.html" }), fc("Read", { file_path: "/nosotros/index.html" }), fc("Read", { file_path: "/contacto/index.html" }), done],
        [fc("Edit", { file_path: "/index.html" }), fc("Edit", { file_path: "/nosotros/index.html" }), fc("Edit", { file_path: "/contacto/index.html" }), done],
        [{ type: "text_delta", text: "Cambiado en las tres páginas." }, done],
      ),
      runTool: async (name) => { seen.push(name); return { response: { ok: true } }; },
      emit: (e) => events.push(e),
    });
    // Las ocho corrieron: sólo las tres Edit tocan el presupuesto de 3.
    expect(seen).toHaveLength(8);
    expect(r.finalText).toBe("Cambiado en las tres páginas.");
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(r.terminalError).toBe(false);
  });

  // LA TARJETA DICE SOBRE QUÉ, como Claude Code pinta `Read(index.html)` o
  // `Grep(pattern)`: el argumento principal de la llamada. Sin `resumen` en
  // ninguna herramienta (Len 2.0), la tarjeta en marcha enseñaba el nombre
  // crudo —«Read»— y el historial se lo reenviaba al modelo como resumen.
  it("la tarjeta en marcha dice el fichero o el patrón, no el nombre de la herramienta", async () => {
    const events: AgentStreamEvent[] = [];
    const fc = (name: string, args: Record<string, unknown>): StreamEvent => ({ type: "function_call", name, args });
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [fc("Read", { file_path: "/menu/index.html" }), fc("Grep", { pattern: "600 11" }), fc("Glob", { pattern: "*/index.html" }), fc("view_page", {}), done],
        [{ type: "text_delta", text: "Listo." }, done],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    const enMarcha = events.filter((e) => e.type === "action" && e.status === "running") as { tool: string; summary: string }[];
    expect(enMarcha.map((e) => e.summary)).toEqual(["menu/index.html", "600 11", "*/index.html", ""]);
  });

  it("H1: sin topes (el defecto, como Claude Code), una tanda de 27 llamadas mezcladas corre ENTERA", async () => {
    // Hasta el 2026-09-25 un tope ABSOLUTO de 26 cortaba la 27ª. Len 2.0 lo
    // retira con los demás: el bucle principal de Claude Code no topa pasos, y
    // lo que acota un atasco son las guardas (la misma llamada fallida, tres
    // tandas rechazadas) y el botón de Detener.
    const seen: string[] = [];
    const calls: StreamEvent[] = Array.from({ length: 27 }, (_, i): StreamEvent => ({
      type: "function_call",
      name: i % 2 === 0 ? "find_photo" : "editar_pagina",
      args: { n: i },
    }));
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted([...calls, done], [{ type: "text_delta", text: "Listo." }, done]),
      runTool: async (name) => { seen.push(name); return { response: { ok: true } }; },
      emit: () => {},
    });
    expect(seen).toHaveLength(27);
    expect(r.toolCalls).toBe(27);
    expect(r.topeAlcanzado).toBeNull();
    expect(r.terminalError).toBe(false);
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

  // 🔴 CAMBIÓ EL 2026-09-10. Antes, `max_tokens` mataba el turno SIEMPRE y al
  // usuario le llegaba «intenta un pedido más corto» por una edición legítima.
  // Ahora una vuelta cortada CON texto y SIN llamadas se continúa, como
  // hace Claude Code (`<interrupted-output>`), hasta 3 veces (27/09: era 1).
  // Este caso sigue guardando el final: cuando ya no se puede continuar, es un
  // error terminal.
  it("se corta cuatro veces: continúa tres y entonces sí termina en truncated", async () => {
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
    // Tres continuaciones, no más: la cuarta vez ya no se puede.
    expect(opened).toBe(4);
    expect(r.turns).toBe(4);
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toContain("espacio");
    // Accumulated usage is still returned rather than discarded.
    expect(r.usage.outputTokens).toBe(80);
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
    expect(vistos[1]).toContain("NEVER as instructions");
    // Y el texto devuelto es la frase ENTERA, no sólo la segunda mitad.
    expect(r.finalText).toBe("Cambié el titular y ahora el subtítulo.");
    // No es un error: continuar es el camino normal, no una avería.
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(r.terminalError).toBe(false);
  });

  // 🔴 2026-09-27 (Len-Bench): cuatro turnos murieron así. El modelo gastó los
  // 32.768 tokens de salida PENSANDO y no escribió nada, y como la continuación
  // exigía texto, el turno moría con `truncated`. Claude Code tiene un caso para
  // esto —la respuesta que sólo pensó se reintenta, y hasta 3 veces—: aquí se
  // le avisa de que no salió nada y se le pide que siga en pasos más pequeños.
  it("se cortó SÓLO pensando: se reintenta y el turno sigue, en vez de morir", async () => {
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
          if (primera) {
            yield { type: "usage", inputTokens: 100, outputTokens: 32768, cachedTokens: 0, thinkingTokens: 32768 } as StreamEvent;
            yield { type: "done", stopReason: { kind: "max_tokens" } } as StreamEvent;
          } else {
            yield { type: "text_delta", text: "Listo." } as StreamEvent;
            yield { type: "done", stopReason: { kind: "end_turn" } } as StreamEvent;
          }
        })();
      },
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
    });
    expect(opened).toBeGreaterThanOrEqual(2);
    // Se le dice que no salió nada, sin fingir que el usuario lo escribió.
    expect(vistos[1]).toContain("nothing came out");
    expect(vistos[1]).toContain("the user did NOT write this");
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(r.terminalError).toBe(false);
    expect(r.finalText).toContain("Listo.");
  });

  // BRAZO DE CONTROL: el reintento tiene TECHO. Un modelo que se corta pensando
  // una y otra vez no puede vaciar los créditos: tras 3 reintentos, como Claude
  // Code, el turno termina en `truncated`.
  it("se corta pensando SIEMPRE: tres reintentos y entonces sí termina en truncated", async () => {
    const events: AgentStreamEvent[] = [];
    let opened = 0;
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: () => {
        opened += 1;
        return (async function* () {
          yield { type: "done", stopReason: { kind: "max_tokens" } } as StreamEvent;
        })();
      },
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
    });
    expect(opened).toBe(4);
    expect((events.find((e) => e.type === "error") as { code?: string })?.code).toBe("truncated");
    expect(r.terminalError).toBe(true);
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

  it("a confirm outcome emits a confirm event, feeds the model waiting_for_user_confirmation, and continues", async () => {
    const events: AgentStreamEvent[] = [];
    const callsSeen: Message[][] = [];
    const stream = scripted(
      [{ type: "function_call", name: "publish", args: { subdomain: "mi-negocio" } }, done],
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
        action: { tool: "publish", ok: true, summary: "mi-negocio" },
        confirm: { action: "publish", subdominio: "mi-negocio", idiomas: ["es"], republicar: false },
      }),
      emit: (e) => events.push(e),
    });

    const confirmEv = events.find((e) => e.type === "confirm");
    expect(confirmEv).toMatchObject({
      type: "confirm",
      action: "publish",
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
    expect(fr.name).toBe("publish");
    expect(fr.response.ok).toBe(true);
    expect(fr.response.state).toBe("waiting_for_user_confirmation");
    expect(fr.response.subdomain).toBe("mi-negocio");
    // A turn that ends waiting on a confirm card still finishes clean —
    // charges credits (F2-T9); it's the model's own end_turn, not an error.
    expect(r.terminalError).toBe(false);
  });

  // EL BORRADOR DE RESPUESTA (plans/len-resultados/): mismo camino que publicar,
  // otra espera. El modelo lee «nada enviado», nunca algo que suene a hecho.
  it("el borrador de draft_reply sale como confirm y el modelo lee que NADA se envió", async () => {
    const events: AgentStreamEvent[] = [];
    const callsSeen: Message[][] = [];
    const stream = scripted(
      [{ type: "function_call", name: "draft_reply", args: { channel: "chat", id: "c1", text: "Sí, abrimos el domingo" } }, done],
      [{ type: "text_delta", text: "Te dejé el borrador; revísalo y mándalo con «Enviar»." }, done],
    );
    const borrador = {
      action: "responder" as const, para: "chat" as const, id: "c1", con: "Juan", texto: "Sí, abrimos el domingo",
      botones: ["enviar" as const], correo: null, whatsapp: null,
    };
    await runAgentLoop({
      messages: [{ role: "user", content: "dile que sí" }], tools: [],
      openStream: (messages) => {
        callsSeen.push([...messages]);
        return stream(messages);
      },
      runTool: async () => ({
        response: { ok: true },
        action: { tool: "draft_reply", ok: true, summary: "Juan" },
        confirm: borrador,
      }),
      emit: (e) => events.push(e),
    });

    expect(events.find((e) => e.type === "confirm")).toEqual({ type: "confirm", ...borrador });
    const frTurn = callsSeen[1].find((m) => m.functionResponses);
    const fr = (frTurn as { functionResponses: { name: string; response: Record<string, unknown> }[] })
      .functionResponses[0];
    expect(fr.response.state).toBe("draft_in_a_card_nothing_sent");
    expect(fr.response).not.toHaveProperty("subdomain");
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

  it("F4-T4: each html event carries the page its write landed on, not the turn's starting one", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [
          { type: "function_call", name: "Edit", args: { file_path: "/index.html" } },
          { type: "function_call", name: "Edit", args: { file_path: "/menu/index.html" } },
          done,
        ],
        [{ type: "text_delta", text: "Listo, cambié ambos." }, done],
      ),
      runTool: async (_name, args) => {
        // Len 2.0 no tiene página activa: cada Edit dice su fichero, y la
        // herramienta devuelve la página en la que escribió.
        const page = args.file_path === "/menu/index.html" ? "menu" : null;
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

// ── TodoWrite, retirada (F4 de plans/len-agente-2026) ────────────────────────
//
// ⚰️ Aquí vivían las pruebas de la lista de tareas pasada por la EVIDENCIA: el
// recordatorio a las 10 vueltas, el reclamo al cerrar y el aviso de «completed»
// sin nada detrás. Se fueron con la herramienta (Claude Code la quitó a los
// modelos nuevos; Len la usaba en el 1,4 % de los pasos). Queda la lápida.
describe("runAgentLoop — TodoWrite, retirada (F4)", () => {
  const edita = { type: "function_call" as const, name: "editar_pagina", args: {} };
  const runTool = async (name: string) => {
    if (name === "editar_pagina") {
      return {
        response: { ok: true, cambio: "cambio" },
        updatedHtml: "<!doctype html><html><body>v2</body></html>",
      };
    }
    return { response: { ok: true } };
  };

  it("🔴 llamarla es llamar a un nombre que no existe: se rechaza y no hace nada", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "tres cosas" }],
      tools: [{ name: "Read" }, { name: "editar_pagina" }],
      openStream: scripted(
        [{ type: "function_call", name: "TodoWrite", args: { todos: [{ content: "a", status: "in_progress", activeForm: "a" }] } }, done],
        [edita, done],
        [{ type: "text_delta", text: "Hecho." }, done],
      ),
      runTool,
      emit: () => {},
    });
    expect(r.rechazos.map((x) => x.tool)).toContain("TodoWrite");
    expect(r.finalText).toBe("Hecho.");
  });

  /**
   * 🔴 LEER NO GASTA VUELTA — la aritmética del fallo 7 de 7, con ficheros.
   *
   * Con Len 2.0 cada página es Read y luego Edit: Edit exige haber leído, y el
   * `old_string` sale de lo leído, así que no caben en la misma tanda. Si la
   * lectura contara como vuelta de trabajo, «el teléfono en las cuatro» pediría
   * ocho contra el tope — la cuenta que antes pagaba `trabajar_en_pagina`.
   *
   * Esta prueba fija la CUENTA: con tope 5, cuatro páginas caben.
   */
  it("🔴 cuatro páginas caben: leer no cuenta como vuelta de trabajo", async () => {
    const lee = { type: "function_call" as const, name: "Read", args: {} };
    const stream = scripted(
      [lee, done], [edita, done],
      [lee, done], [edita, done],
      [lee, done], [edita, done],
      [lee, done], [edita, done],
      [{ type: "text_delta", text: "Las cuatro." }, done],
    );
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "el teléfono en todas" }], tools: [], maxTurns: 5,
      openStream: stream,
      runTool,
      emit: () => {},
    });
    expect(r.finalText, "se quedó sin vueltas antes de la cuarta página").toBe("Las cuatro.");
    expect(r.topeAlcanzado ?? null).toBeNull();
  });
});

// ── EL ■ ANTES DE QUE LLEGUE EL USO (crear-es-len, 07/10) ────────────────────
//
// Fireworks manda el uso al FINAL del stream: un ■ a mitad no lo trae, y el
// turno cobraba 0 aunque el proveedor sí factura lo generado hasta el corte.
// Como DeepSeek («el usuario paga cada token que el modelo llegó a gastar,
// también en un turno cancelado»): sin uso del proveedor, se cuenta lo que llegó.
describe("runAgentLoop — el uso de un intento cortado sin «usage»", () => {
  it("🔴 un ■ a mitad del stream cuenta lo que se generó y la petición", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "reescribe la portada entera" }], tools: [],
      openStream: scripted([
        { type: "text_delta", text: "La escribo entera." },
        { type: "function_call_delta", index: 0, name: "Write", argsDelta: '{"content":"' + "x".repeat(700) },
        { type: "done", stopReason: { kind: "cancelled" } },
      ]),
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
    });
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    expect(r.usage.outputTokens).toBeGreaterThanOrEqual(200);
  });

  it("BRAZO DE CONTROL: con el uso del proveedor se cuenta ése, sin estimar nada", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hola" }], tools: [],
      openStream: scripted([
        { type: "text_delta", text: "Hola." },
        { type: "usage", inputTokens: 10, outputTokens: 3, cachedTokens: 0, thinkingTokens: 0 },
        { type: "done", stopReason: { kind: "cancelled" } },
      ]),
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
    });
    expect(r.usage).toMatchObject({ inputTokens: 10, outputTokens: 3 });
  });

  it("y un ■ antes del primer trozo no cuenta nada", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hola" }], tools: [],
      openStream: scripted([{ type: "done", stopReason: { kind: "cancelled" } }]),
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
    });
    expect(r.usage).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });
});

// ── ask_user_question (antes preguntar): la parada la ejecuta el SERVIDOR ─────────────────────────────
//
// 🔴 «Esto lo decide el usuario» viajaba como `ok:false` con una ORDEN dentro
// —«NO vuelvas a llamar a publicar en este turno; termina preguntándole»— más un
// flag de sesión para cazarle si la desobedecía. Está MEDIDO que la desobedecía:
// con un ejemplo en el texto reclamaba «mi-negocio» 3 de 3 veces, y sin ejemplo
// se inventaba el nombre del contexto. Pedirle a un modelo que se pare y luego
// vigilar si se paró son las dos mitades del mismo parche.
describe("runAgentLoop — ask_user_question (antes preguntar)", () => {
  const preguntaDe = (a: Record<string, unknown>) => String((a.questions as { question: string }[])[0].question);
  it("una pregunta CIERRA el turno, aunque el modelo tuviera más que decir", async () => {
    const seen: string[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "publícala" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "ask_user_question", args: { questions: [{ id: "q", question: "¿Qué dirección quieres?" }] } }, done],
        // Este segundo stream NO debe llegar a abrirse: el turno terminó.
        [{ type: "function_call", name: "publish", args: { subdomain: "mi-negocio" } }, done],
      ),
      runTool: async (name, args) => {
        seen.push(name);
        return name === "ask_user_question"
          ? { response: { ok: true }, pregunta: preguntaDe(args) }
          : { response: { ok: true } };
      },
      emit: () => {},
    });
    expect(seen).toEqual(["ask_user_question"]);
    expect(r.finalText).toBe("¿Qué dirección quieres?");
    expect(r.terminalError).toBe(false);
  });

  it("y el usuario la LEE: se emite como texto", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "publícala" }], tools: [],
      openStream: scripted([
        { type: "function_call", name: "ask_user_question", args: { questions: [{ id: "q", question: "¿Qué dirección quieres?" }] } },
        done,
      ]),
      runTool: async (_n, args) => ({ response: { ok: true }, pregunta: preguntaDe(args) }),
      emit: (e) => events.push(e),
    });
    const textos = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text);
    expect(textos.join("")).toContain("¿Qué dirección quieres?");
  });

  // Ensayo de caja de crear-es-len (07/10): la pregunta de `enter_plan_mode`
  // es NUESTRA, fija y en inglés, y la tarjeta la pinta traducida por su
  // `intent`. Emitirla como texto dejaba al dueño un «Switch to plan mode?…» en
  // inglés como respuesta de Len. Como DeepSeek: la pregunta va en su tarjeta.
  it("🔴 una pregunta con intent (la del modo plan) cierra el turno SIN emitir su texto", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hazme la página" }], tools: [],
      openStream: scripted([{ type: "function_call", name: "enter_plan_mode", args: {} }, done]),
      runTool: async () => ({
        response: { ok: true, preguntado: true },
        pregunta: "Switch to plan mode?",
        preguntas: [{ id: "plan-mode", question: "Switch to plan mode?", intent: { kind: "plan-consent" } }],
      }),
      emit: (e) => events.push(e),
    });
    expect(r.endedOnQuestion).toBe(true);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).not.toContain("Switch to plan mode?");
    expect(r.finalText).not.toContain("Switch to plan mode?");
  });

  it("no la dice DOS veces cuando el modelo ya la escribió en su prosa", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "publícala" }], tools: [],
      openStream: scripted([
        { type: "text_delta", text: "Claro. ¿Qué dirección quieres?" },
        { type: "function_call", name: "ask_user_question", args: { questions: [{ id: "q", question: "¿Qué dirección quieres?" }] } },
        done,
      ]),
      runTool: async (_n, args) => ({ response: { ok: true }, pregunta: preguntaDe(args) }),
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
        { type: "function_call", name: "ask_user_question", args: { questions: [{ id: "q", question: "¿Y la dirección?" }] } },
        done,
      ]),
      runTool: async (name, args) => {
        seen.push(name);
        return name === "ask_user_question"
          ? { response: { ok: true }, pregunta: preguntaDe(args) }
          : { response: { ok: true }, updatedHtml: "<!doctype html><html><body>v2</body></html>" };
      },
      emit: (e) => events.push(e),
    });
    expect(seen).toEqual(["editar_pagina", "ask_user_question"]);
    // El lienzo recibió el cambio: cortar en seco al ver la pregunta habría
    // perdido trabajo que el usuario ya tiene delante.
    expect(events.some((e) => e.type === "html")).toBe(true);
  });

  it("pieza 3: contestada DENTRO del turno, el turno sigue y la tarjeta lleva la pregunta y la respuesta", async () => {
    const events: AgentStreamEvent[] = [];
    const vistos: Message[][] = [];
    const preguntas = [{ id: "plazo", question: "¿Cuánto tarda?" }];
    const guion = scripted(
      [{ type: "function_call", name: "ask_user_question", args: { questions: preguntas } }, done],
      [{ type: "text_delta", text: "Puesto: 48 horas." }, done],
    );
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "pon el plazo" }], tools: [],
      openStream: (m) => { vistos.push(structuredClone(m)); return guion(m); },
      runTool: async () => ({ response: { ok: true, answers: [{ id: "plazo", selected: ["48 horas"] }] }, preguntas, respuesta: "48 horas" }),
      emit: (e) => events.push(e),
    });
    expect(r.finalText).toBe("Puesto: 48 horas.");
    expect(vistos[1]!.at(-1)!.functionResponses![0]!.response).toEqual({ ok: true, answers: [{ id: "plazo", selected: ["48 horas"] }] });
    const tarjeta = events.find((e) => e.type === "action" && (e as { status: string }).status === "done") as Record<string, unknown>;
    expect(tarjeta.preguntas).toEqual(preguntas);
    expect(tarjeta.respuesta).toBe("48 horas");
  });

  it("LOTE 7-8 · DESCARTADA para hablar: el turno cierra sin otra llamada, la tarjeta es `done` y el modelo leerá el error", async () => {
    const events: AgentStreamEvent[] = [];
    const seen: string[] = [];
    const preguntas = [{ id: "plan-review", question: "Approve this plan and leave plan mode?" }];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "planea las reseñas" }], tools: [],
      openStream: scripted(
        [{ type: "text_delta", text: "Aquí va el plan." }, { type: "function_call", name: "exit_plan_mode", args: { plan: "# Reseñas" } }, done],
        // No debe abrirse: el dueño tomó la palabra.
        [{ type: "text_delta", text: "Sigo." }, done],
      ),
      runTool: async (name) => {
        seen.push(name);
        return { response: { ok: false, error: "dismissed to speak" }, preguntas, dismissed: true };
      },
      emit: (e) => events.push(e),
    });
    expect(seen).toEqual(["exit_plan_mode"]);
    expect(r.terminalError).toBe(false);
    const tarjeta = events.find((e) => e.type === "action" && (e as { status: string }).status !== "running") as Record<string, unknown>;
    expect(tarjeta.status).toBe("done");
    expect(tarjeta.preguntas).toEqual(preguntas);
    expect(tarjeta.pregunta).toBeUndefined();
    // ALINEAR: y la marca de «cancelada», como el `ASK_CANCELLED` de DeepSeek.
    expect(tarjeta.dismissed).toBe(true);
    // La transcripción termina con la llamada y su error: es lo que lee el turno siguiente.
    const ultimo = r.transcripcion!.at(-1)!;
    expect(ultimo.functionResponses?.[0]?.response).toEqual({ ok: false, error: "dismissed to speak" });
    expect(r.transcripcion!.at(-2)!.functionCalls?.[0]?.name).toBe("exit_plan_mode");
    // Y nadie lee la pregunta como texto de Len.
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toBe("Aquí va el plan.");
  });

  it("LOTE 7-8 (2) · lo que el dueño escribió mientras la pregunta esperaba: el turno NO cierra, Len lo lee y sigue", async () => {
    const events: AgentStreamEvent[] = [];
    const vistos: Message[][] = [];
    const guion = scripted(
      [{ type: "function_call", name: "ask_user_question", args: { questions: [{ id: "q", question: "¿Cuánto tarda?" }] } }, done],
      [{ type: "text_delta", text: "Puesto: 48 horas." }, done],
    );
    const direcciones: (string | null)[] = [null, "mejor 48 horas"];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "pon el plazo" }], tools: [],
      openStream: (m) => { vistos.push(structuredClone(m)); return guion(m); },
      runTool: async (_n, args) => ({ response: { ok: true, preguntado: true }, pregunta: preguntaDe(args) }),
      leerDireccion: () => direcciones.shift() ?? null,
      emit: (e) => events.push(e),
    });
    expect(r.finalText).toBe("Puesto: 48 horas.");
    expect(String(vistos[1]!.at(-1)!.content)).toContain("mejor 48 horas");
    expect(vistos[1]!.at(-2)!.functionResponses?.[0]?.name).toBe("ask_user_question");
    expect(events.some((e) => e.type === "direccion")).toBe(true);
  });

  it("ALINEAR · el resultado dice si el turno ACABÓ esperando al dueño (pregunta vencida o descartada), y no si siguió", async () => {
    const pregunta = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted([{ type: "function_call", name: "ask_user_question", args: { questions: [{ id: "q", question: "¿?" }] } }, done]),
      runTool: async (_n, args) => ({ response: { ok: true, preguntado: true }, pregunta: preguntaDe(args) }),
      emit: () => {},
    });
    expect(pregunta.endedOnQuestion).toBe(true);
    const descartada = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted([{ type: "function_call", name: "exit_plan_mode", args: { plan: "# P" } }, done]),
      runTool: async () => ({ response: { ok: false, error: "dismissed" }, dismissed: true }),
      emit: () => {},
    });
    expect(descartada.endedOnQuestion).toBe(true);
    const direcciones: (string | null)[] = [null, "sigue"];
    const siguio = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "ask_user_question", args: { questions: [{ id: "q", question: "¿?" }] } }, done],
        [{ type: "text_delta", text: "Vale." }, done],
      ),
      runTool: async (_n, args) => ({ response: { ok: true, preguntado: true }, pregunta: preguntaDe(args) }),
      leerDireccion: () => direcciones.shift() ?? null,
      emit: () => {},
    });
    expect(siguio.endedOnQuestion).toBeUndefined();
  });

  it("LOTE 7-8 (2) · BRAZO DE CONTROL: sin nada escrito, la pregunta sigue cerrando el turno", async () => {
    let llamadas = 0;
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "pon el plazo" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "ask_user_question", args: { questions: [{ id: "q", question: "¿Cuánto tarda?" }] } }, done],
        [{ type: "text_delta", text: "No debería llegar." }, done],
      ),
      runTool: async (_n, args) => ({ response: { ok: true, preguntado: true }, pregunta: preguntaDe(args) }),
      leerDireccion: () => { llamadas += 1; return null; },
      emit: () => {},
    });
    expect(r.finalText).toBe("¿Cuánto tarda?");
    // Una al empezar la vuelta y otra al cerrar por la pregunta.
    expect(llamadas).toBe(2);
  });

  it("LOTE 7-8 (2) · y lo mismo tras DESCARTAR la revisión: lo escrito es el mensaje que Len espera", async () => {
    const vistos: Message[][] = [];
    const guion = scripted(
      [{ type: "function_call", name: "exit_plan_mode", args: { plan: "# Reseñas" } }, done],
      [{ type: "text_delta", text: "Lo rehago sin estrellas." }, done],
    );
    const direcciones: (string | null)[] = [null, "sin estrellas"];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "planea las reseñas" }], tools: [],
      openStream: (m) => { vistos.push(structuredClone(m)); return guion(m); },
      runTool: async () => ({ response: { ok: false, error: "dismissed to speak" }, preguntas: [{ id: "plan-review", question: "?" }], dismissed: true }),
      leerDireccion: () => direcciones.shift() ?? null,
      emit: () => {},
    });
    expect(r.finalText).toBe("Lo rehago sin estrellas.");
    expect(String(vistos[1]!.at(-1)!.content)).toContain("sin estrellas");
    expect(vistos[1]!.at(-2)!.functionResponses?.[0]?.response).toEqual({ ok: false, error: "dismissed to speak" });
  });

  it("preguntar (ask_user_question) no gasta presupuesto de acciones", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxToolCalls: 1,
      openStream: scripted([
        { type: "function_call", name: "editar_pagina", args: {} },
        { type: "function_call", name: "ask_user_question", args: { questions: [{ id: "q", question: "¿sí o no?" }] } },
        done,
      ]),
      runTool: async (name, args) =>
        name === "ask_user_question"
          ? { response: { ok: true }, pregunta: preguntaDe(args) }
          : { response: { ok: true } },
      emit: () => {},
    });
    // Con la pregunta contando, la segunda llamada habría reventado el tope de 1
    // y el turno cerraría con un error rojo en vez de con la pregunta.
    expect(r.finalText).toBe("¿sí o no?");
    expect(r.terminalError).toBe(false);
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

  // Los cambios de AJUSTES (hoy, los módulos) son
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
        [{ type: "function_call", name: "Read", args: { file_path: "/index.html" } }, usage(10), done],
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
  // Son cosas distintas — `toggle_module` y `publicar` llaman a una
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
    //
    // Llamadas que ACTÚAN a propósito: desde el 2026-09-22 un turno que sólo
    // leyó recibe la insistencia de «no cambiaste nada», y esa vuelta de más
    // haría contar tres lecturas por una razón que no es la de esta prueba.
    let lecturas = 0;
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: scripted(
        [
          { type: "function_call", name: "editar_pagina", args: {} },
          { type: "function_call", name: "editar_pagina", args: {} },
          usage(5),
          doneEv,
        ],
        [{ type: "text_delta", text: "ya" }, usage(5), doneEv],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
      leerDireccion: () => { lecturas += 1; return null; },
    });
    // Dos vueltas del bucle ⇒ dos lecturas, aunque la primera hiciera 2 tools;
    // y una más al cerrar (2026-10-03: la que llega durante el cierre no se pierde).
    expect(lecturas).toBe(3);
  });

  it("🔴 la que llega MIENTRAS ESCRIBE EL CIERRE no se pierde: el turno sigue y la lee", async () => {
    // Visto en el taller el 2026-10-03: el POST a /api/agent/dirigir llegó
    // durante la última llamada —la que ya no pide herramientas—, se aceptó con
    // 200, y el turno cerró sin leerla. Vuelta 1: edita. Vuelta 2: escribe el
    // cierre, y la corrección «llega» durante esa llamada, así que sólo la puede
    // ver la lectura del cierre (la tercera).
    const events: AgentStreamEvent[] = [];
    const vistos: Message[][] = [];
    let lecturas = 0;
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hazme un hero" }],
      tools: [],
      openStream: (msgs) => {
        vistos.push(msgs.map((m) => ({ ...m })));
        const n = vistos.length;
        return (async function* () {
          if (n === 1) yield { type: "function_call", name: "editar_pagina", args: {} } as StreamEvent;
          else yield { type: "text_delta", text: n === 2 ? "Listo, quedó azul." : "Hecho en verde." } as StreamEvent;
          yield usage(5);
          yield doneEv;
        })();
      },
      runTool: async () => ({ response: { ok: true }, updatedHtml: "<p>x</p>" }),
      emit: (e) => events.push(e),
      leerDireccion: () => (++lecturas === 3 ? "mejor verde" : null),
    });

    expect(events.some((e) => e.type === "direccion" && e.texto === "mejor verde")).toBe(true);
    expect(vistos).toHaveLength(3);
    // La tercera llamada ve lo que acababa de decir Y la corrección, en orden.
    const ultimos = vistos[2].slice(-2);
    expect(ultimos[0]).toMatchObject({ role: "assistant", content: "Listo, quedó azul." });
    expect(ultimos[1]?.role).toBe("user");
    expect(String(ultimos[1]?.content)).toContain("mejor verde");
    expect(r.finalText).toBe("Hecho en verde.");
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
        [{ type: "function_call", name: nombre, args: { ediciones: [{ target: "2f", texto: "Hola" }], resumen: "titular" } }, usage(10), done],
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
        [{ type: "function_call", name: "inventar_universo", args: {} }, usage(10), done],
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
      [{ type: "function_call", name: "editar_texxxto", args: {} }, usage(10), done],
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

  // Las 11 pasaron al inglés el 2026-10-06. Un modelo que todavía recuerde el
  // nombre de antes (de un historial viejo, o de su propia costumbre) no
  // encontraría el nuevo por «la más parecida»: se le dice cuál es.
  it("llamar a una herramienta por su nombre viejo dice cómo se llama ahora", async () => {
    const vueltas: Message[][] = [];
    const vistos: string[] = [];
    const guion = scripted(
      [{ type: "function_call", name: "mirar_pagina", args: { tipo: "medir", pregunta: "¿se lee?" } }, usage(10), done],
      [{ type: "text_delta", text: "ok" }, usage(5), done],
    );
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "mira la página" }],
      tools: [{ name: "view_page" }, ...(DECLARADAS as unknown[])] as unknown as Parameters<typeof runAgentLoop>[0]["tools"],
      openStream: (m: Message[]) => { vueltas.push(structuredClone(m)); return guion(m); },
      runTool: async (n) => { vistos.push(n); return { response: { ok: true } }; },
      emit: () => {},
    });
    expect(vistos).toEqual([]);
    expect(r.toolCalls).toBe(0);
    expect(JSON.stringify(vueltas.at(-1) ?? [])).toContain('It is called \\"view_page\\" now');
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
        { type: "function_call", name: "editar_texto", args: { resumen: "titular" } },
        { type: "function_call", name: "editar_html", args: { resumen: "seccion" } },
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
        { type: "function_call", name: "editar_texto", args: { resumen: "a" } },
        { type: "function_call", name: "editar_html", args: { resumen: "b" } },
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

// ⚰️ Este bloque se llamaba «lo medido vuelve al modelo» y probaba sobre todo
// `medirParaElModelo` —el navegador que medía cada tanda—, retirado el
// 2026-10-06 (plans/crear-es-len). Quedan los diagnósticos ESTÁTICOS de las
// escrituras (`outcome.diagnosticos`), que siguen llegando al modelo.
describe("runAgentLoop — lo que dejan las escrituras vuelve al modelo", () => {
  const edita = (): StreamEvent[] => [
    { type: "function_call", name: "Edit", args: {} },
    done,
  ];
  const VISIBLE = '<html>\n<body>\n<div class="grid">x</div>\n</body>\n</html>';
  const herramientaQueEdita = async () => ({
    response: { ok: true },
    action: { tool: "Edit", ok: true, summary: "editado" },
    updatedHtml: VISIBLE,
    page: null as string | null,
  });

  it("una tanda sin diagnósticos deja el mensaje byte a byte como antes", async () => {
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

  // ⚰️ «un rechazo del almacén llega al modelo como defecto» (el carrito del
  // 2026-09-18): el sustituto de `/api/d` contestaba en la medida con las reglas
  // del servidor y sus rechazos llegaban como diagnóstico. Se retiró con
  // `data-ol-stores` el 2026-10-04.

  // LO QUE DEJÓ LA ESCRITURA —un enlace que marca otro número, una red social
  // que nadie dio— viaja en el `<new-diagnostics>` de la tanda, y una sola vez.
  it("🔴 los diagnósticos de la escritura van en el `<new-diagnostics>` de la tanda, una vez", async () => {
    const vistos: Message[][] = [];
    const diag = {
      ruta: "/index.html",
      linea: 3,
      columna: 1,
      gravedad: "Warning" as const,
      mensaje: "El enlace dice «55 1111 2222» y lleva a tel:5599998888",
      codigo: "enlace-desfasado",
      fuente: "openlen",
    };
    let n = 0;
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: mirando(vistos, scripted(edita(), edita(), [{ type: "text_delta", text: "ok" }, done])),
      runTool: async () => {
        n += 1;
        return { ...(await herramientaQueEdita()), updatedHtml: VISIBLE.replace(">x<", `>x${n}<`), diagnosticos: [diag] };
      },
      emit: () => {},
    });
    const sobres = (vistos.at(-1) ?? []).filter((m) => m.functionResponses).map((m) => m.content as string);
    expect(sobres[0]).toBe(
      "<new-diagnostics>Problems that appeared with this change:\n\n/index.html:\n  ⚠ [Line 3:1] El enlace dice «55 1111 2222» y lleva a tel:5599998888 [enlace-desfasado] (openlen)</new-diagnostics>",
    );
    // La segunda tanda lo trae otra vez y ya no se repite: se le entregó.
    expect(sobres[1]).toBe("");
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
        [{ type: "text_delta", text: "Voy a cambiarlo." }, { type: "function_call", name: "editar_pagina", args: {} }, done],
        [{ type: "text_delta", text: "El titular dice X." }, done],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => void events.push(e),
    });
    const texto = recoger(events);
    expect(texto).not.toContain("cambiarlo.El titular");
    expect(texto).toBe("Voy a cambiarlo." + "\n\n" + "El titular dice X.");
  });

  // 🔴 BRAZO DE CONTROL: una sola vuelta con texto NO gana separador. Sin esto,
  // «meter siempre un salto» pasaría la de arriba y le abriría un hueco en
  // blanco a TODOS los turnos normales, que son la mayoría.
  //
  // ⚠️ La vuelta LLAMA a una herramienta que ACTÚA, a propósito. Sin ella se
  // dispara la insistencia —la guarda del turno que anuncia y no hace— el
  // bucle da otra vuelta, y `scripted` repite su última entrada: el texto sale
  // «Hola.Hola.» por el arnés, no por el producto. Descubierto escribiendo esta
  // misma prueba. Y desde el 2026-09-22 una LECTURA ya no la esquiva.
  it("una sola vuelta con texto sale byte a byte igual que antes", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: scripted(
        [{ type: "text_delta", text: "Hola." }, { type: "function_call", name: "editar_pagina", args: {} }, done],
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
        [{ type: "function_call", name: "editar_pagina", args: {} }, done],
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
// ⚰️ «LA MISMA INTENCIÓN, REPETIDA» (`SAME_INTENT_LIMIT`, `REESCRIBEN_TODO`): la
// guarda contaba llamadas por `herramienta + resumen` para cortar el
// `editar_runtime` en bucle. Len 2.0 no tiene `editar_runtime` y ninguna
// herramienta lleva ya `resumen`, así que no disparaba nunca. Claude Code no
// tiene nada así; la de llamadas que FALLAN igual sigue (FAIL_REPEAT_LIMIT).

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
    expect(cierres[0]).toContain("PENDING");
  });

  it("y si no se aplicó NADA, el cierre lo dice tal cual en vez de callarlo", async () => {
    const cierres: string[] = [];
    // Un Edit que FALLA: gasta la vuelta y no aplica nada. (Hasta H1 esto era
    // una cadena de `leer_estado` que cortaba el tope absoluto de 26; las
    // lecturas no cuentan para `maxTurns` y el absoluto ya no existe.)
    await runAgentLoop({
      messages: [{ role: "user", content: "haz tres cosas" }],
      tools: [],
      maxTurns: 1,
      openStream: scripted([{ type: "function_call", name: "Edit", args: { file_path: "/index.html", old_string: "x", new_string: "y" } }, done]),
      runTool: async () => ({ response: { ok: false, error: "old_string is not in the file." } }),
      closeOut: (msgs) => {
        cierres.push(String(msgs[msgs.length - 1]?.content ?? ""));
        return (async function* () { yield { type: "text_delta", text: "No alcancé." } as StreamEvent; })();
      },
      emit: () => {},
    });
    expect(cierres[0]).toContain("No change was applied");
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
    expect(cierres[0]).toMatch(/broken|stopped working|doesn't work/i);
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
// En Claude Code el bucle principal NO lleva tope de pasos —`maxTurns` es un
// campo opcional por definición de agente— y lo que acota una sesión larga es
// el CONTEXTO, con auto-compactación que CONTINÚA en vez de parar.
//
// El dinero lo topa por MES y por cuenta, con un límite de gasto mensual y
// auto-recarga. El turno no se corta nunca por presupuesto.
//
// Nosotros ya tenemos ese tope mensual (`CREDITS_BY_PLAN`), así que el tope por
// turno era un SEGUNDO muro, redundante con el primero — y era el que partía el
// trabajo en dos. Se relaja hasta el absoluto para quien paga por mes, y se
// deja como estaba para el plan gratuito, que no tiene auto-recarga: ahí el
// muro del mes es un muro de verdad y gastarse medio saldo en un turno sí es
// una pérdida.
describe("H1 · sin tope de vueltas, como Claude Code (2026-09-25)", () => {
  // El bucle cierra cuando el modelo deja de llamar herramientas, cuando el
  // dueño pulsa Detener (la señal de la ruta) o cuando se llena el contexto.
  // `maxTurns`/`maxToolCalls` quedan OPCIONALES, como el `maxTurns` de la
  // definición de un agente de Claude Code: quien los pasa, los tiene.
  const mutaCadaVuelta = (hasta: number) => {
    let vuelta = 0;
    return () => {
      vuelta += 1;
      const n = vuelta;
      return (async function* () {
        if (n <= hasta) {
          yield { type: "function_call", name: "Edit", args: { file_path: "/index.html", old_string: `v${n - 1}`, new_string: `v${n}` } } as StreamEvent;
        } else {
          yield { type: "text_delta", text: "Hecho todo." } as StreamEvent;
        }
        yield done;
      })();
    };
  };
  const mutar = (cuenta: { n: number }) => async () => {
    cuenta.n += 1;
    return {
      response: { ok: true, cambio: "cambio" },
      updatedHtml: `<html>v${cuenta.n}</html>`,
      action: { tool: "Edit", ok: true, summary: `v${cuenta.n}` },
    };
  };

  it("sin topes, 40 vueltas que mutan corren TODAS y el turno cierra cuando el modelo para", async () => {
    const cuenta = { n: 0 };
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hazme el sitio entero" }],
      tools: [],
      openStream: mutaCadaVuelta(40),
      runTool: mutar(cuenta),
      emit: () => {},
    });
    expect(cuenta.n).toBe(40);
    expect(r.topeAlcanzado).toBeNull();
    expect(r.terminalError).toBe(false);
    expect(r.finalText).toContain("Hecho todo.");
  });

  it("y `maxTurns` sigue siendo opcional: si quien llama lo pasa, se honra", async () => {
    const cuenta = { n: 0 };
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hazme el sitio entero" }],
      tools: [],
      maxTurns: 3,
      openStream: mutaCadaVuelta(40),
      runTool: mutar(cuenta),
      emit: () => {},
    });
    expect(r.topeAlcanzado).toBe("turn_limit");
    expect(cuenta.n).toBe(3);
  });
});

// ─── LOS SEIS GUIONES DE LA AUDITORÍA (2026-09-22) ─────────────────────────
//
// `plans/auditoria-len-vs-claude-code-2026-09-22.md`, §4. Cada uno es un rojo
// SEGURO: el mecanismo falla sea cual sea el modelo en cuanto se dispara, así
// que se prueba con un modelo guionado y sin red. Cada prueba afirma lo que el
// dueño debería recibir; el mensaje de cada `expect` dice lo que recibía el día
// de la auditoría.
describe("H01 · H03 — una edición nula no es un hecho, y leer no es actuar", () => {
  const nula = {
    response: { ok: true, cambio: "sin_cambio", sin_cambios: true },
    action: { tool: "editar_texto", ok: true, summary: "teléfono", cambio: "sin_cambio" as const },
    updatedHtml: "<p>igual</p>",
    page: null,
  };
  const insistencia = (m: Message[]) =>
    m.some((x) => x.role === "user" && typeof x.content === "string" && x.content.includes("you ended the turn WITHOUT"));

  it("una edición NULA seguida de «Listo» recibe la insistencia", async () => {
    const vistos: Message[][] = [];
    const stream = scripted(
      [{ type: "function_call", name: "editar_texto", args: { resumen: "teléfono" } }, done],
      [{ type: "text_delta", text: "Listo, cambié el teléfono." }, done],
    );
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: (m) => { vistos.push([...m]); return stream(m); },
      runTool: async () => nula,
      emit: () => {},
    });
    expect(vistos.some(insistencia)).toBe(true);
    // Y no le dice «sin llamar a ninguna herramienta»: sí llamó.
    const texto = vistos.flat().map((m) => (typeof m.content === "string" ? m.content : "")).join(" | ");
    expect(texto).not.toContain("SIN llamar a ninguna herramienta");
  });

  it("BRAZO DE CONTROL: una herramienta que actúa sin tocar la página no recibe insistencia", async () => {
    const vistos: Message[][] = [];
    const stream = scripted(
      [{ type: "function_call", name: "Edit", args: { file_path: "/memoria/dueno.md", old_string: "", new_string: "• Tutéame" } }, done],
      [{ type: "text_delta", text: "Anotado." }, done],
    );
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: (m) => { vistos.push([...m]); return stream(m); },
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
    });
    expect(vistos.some(insistencia)).toBe(false);
    expect(r.finalText).toBe("Anotado.");
  });

  it("…y `aplicado` sólo lleva lo que se movió", async () => {
    let i = 0;
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [
          { type: "function_call", name: "editar_texto", args: { resumen: "teléfono" } },
          { type: "function_call", name: "editar_texto", args: { resumen: "titular" } },
          done,
        ],
        [{ type: "text_delta", text: "Cambié el titular; el teléfono ya estaba." }, done],
      ),
      runTool: async () => {
        i += 1;
        return i === 1
          ? nula
          : { response: { ok: true, cambio: "cambio" }, action: { tool: "editar_texto", ok: true, summary: "titular" }, updatedHtml: "<p>v2</p>", page: null };
      },
      emit: () => {},
    });
    expect(r.aplicado).toEqual(["titular"]);
  });
});

describe("H12 — lo que rechazan las guardas se cuenta y no quema el turno", () => {
  // La guarda que queda: la MISMA llamada que ya falló dos veces se rechaza.
  const falla: StreamEvent[] = [
    { type: "function_call", name: "Edit", args: { file_path: "/index.html", old_string: "carro", new_string: "x" } },
    done,
  ];
  const fallo = async () => ({ response: { ok: false, error: "old_string is not in the file." } });

  it("🔴 cada llamada rechazada se avisa con su motivo, para el diario", async () => {
    const rechazadas: { tool: string; motivo: string }[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(falla, falla, falla, [{ type: "text_delta", text: "Lo dejo así." }, done]),
      runTool: fallo,
      onRechazo: (tool, _a, motivo) => rechazadas.push({ tool, motivo }),
      emit: () => {},
    });
    expect(rechazadas.map((r) => r.tool)).toEqual(["Edit"]);
    expect(rechazadas[0]!.motivo).toContain("DON'T repeat it");
  });

  it("🔴 quien insiste tres vueltas en lo rechazado cierra con los hechos delante, sin tope", async () => {
    let cierre = "";
    const hecho: StreamEvent[] = [
      { type: "function_call", name: "Edit", args: { file_path: "/index.html", old_string: "a", new_string: "b" } },
      done,
    ];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(hecho, falla),
      runTool: async (_n, a) =>
        a.old_string === "a"
          ? { response: { ok: true, cambio: "cambio" }, action: { tool: "Edit", ok: true, summary: "carrito" }, updatedHtml: "<p/>", page: null }
          : fallo(),
      closeOut: (m) => {
        cierre = String(m.at(-1)?.content ?? "");
        return (async function* () { yield { type: "text_delta" as const, text: "Quedó el carrito; no pude más." }; })();
      },
      emit: () => {},
    });
    expect(cierre).toContain("were refused three rounds in a row");
    expect(cierre).toContain("«carrito»");
    expect(r.topeAlcanzado).toBeNull();
    expect(r.terminalError).toBe(false);
    // Una buena, dos que fallan y tres rechazadas.
    expect(r.turns).toBe(6);
    // 🔴 Y NO SE COBRA (revisión pre-deploy del 2026-09-22). Este turno acababa
    // antes en el tope, y el tope no se cobra (regla del 2026-07-07). Cerrarlo
    // con elegancia no puede cambiar quién paga por un modelo que insiste.
    expect(r.sinCobro).toBe("rechazos");
  });
});

describe("auditoría 2026-09-22 · G1–G6", () => {
  const tools = ["editar_texto", "leer_estado", "editar_runtime"].map((name) => ({ name }));
  const llama = (name: string, args: Record<string, unknown>): StreamEvent[] => [
    { type: "function_call", name, args },
    usage(10),
    done,
  ];
  const dice = (t: string): StreamEvent[] => [{ type: "text_delta", text: t }, usage(10), done];
  /** Una edición que movió bytes: lo que devuelve la puerta de edición cuando
   *  `declararCambio` dice `cambio`. */
  const real = (summary: string) => ({
    response: { ok: true, cambio: "cambio" },
    action: { tool: "editar_texto", ok: true, summary, cambio: "cambio" as const },
    updatedHtml: `<p>${summary}</p>`,
    page: null,
  });
  /** Una edición que NO movió un byte. La puerta devuelve igualmente el
   *  documento guardado (`tools.ts`, `updatedHtml: persisted.finalHtml`). */
  const nula = (summary: string) => ({
    response: { ok: true, cambio: "sin_cambio", sin_cambios: true, aviso_critico: "Esto NO cambió NADA" },
    action: { tool: "editar_texto", ok: true, summary, cambio: "sin_cambio" as const },
    updatedHtml: "<p>igual</p>",
    page: null,
  });
  const ultimoDelUsuario = (m: Message[]): string =>
    [...m].reverse().find((x) => x.role === "user" && typeof x.content === "string" && x.content.length > 0)
      ?.content as string ?? "";
  const grabando = (stream: (m: Message[]) => AsyncIterable<StreamEvent>, vistos: Message[][]) =>
    (m: Message[]) => { vistos.push([...m]); return stream(m); };
  // ⚰️ G1, G2 y C07 medían el reclamo de la lista de tareas al cerrar (una
  // edición nula no la daba por hecha; no nombraba la que sí se hizo; la que
  // hizo la misma llamada se confirmaba leyendo). Se fueron con TodoWrite (F4).

  // 🔴 Revisión pre-deploy del 2026-09-22. Desde G4 la insistencia salta también
  // tras una simple lectura, y el aviso le pedía al modelo «repítela tal cual»
  // cuando su respuesta era una explicación. Esa respuesta YA le había llegado
  // al dueño, así que la veía dos veces. Claude Code, cuando algo le impide
  // cerrar, le da el motivo al modelo y éste sigue; no le hace repetir lo dicho.
  it("🔴 leer y contestar: la insistencia no hace repetir la respuesta", async () => {
    const events: AgentStreamEvent[] = [];
    const vistos: Message[][] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "¿sale el teléfono en el pie?" }], tools,
      openStream: grabando(scripted(
        llama("Read", { file_path: "/index.html" }),
        dice("Sí: el pie dice 33 1234 5678."),
        // Tras la insistencia, cierra sin escribir nada más.
        [usage(3), done],
      ), vistos),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    const insistencia = vistos.map(ultimoDelUsuario).find((t) => t.includes("you ended the turn WITHOUT"));
    expect(insistencia, "tras una lectura ya no se insistía").toBeDefined();
    expect(insistencia, "le seguía pidiendo repetir lo que el dueño ya leyó").not.toMatch(/repeat it to them/);
    expect(insistencia).toMatch(/don't repeat it/i);
    const visto = events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");
    expect(visto, "el dueño vio la respuesta dos veces").toBe("Sí: el pie dice 33 1234 5678.");
    // Y lo que queda como cierre del turno es lo que el dueño leyó, no un vacío.
    expect(r.finalText).toBe("Sí: el pie dice 33 1234 5678.");
  });

  // 🔴 MEDIDO con el modelo real (C13, 2 de 2, 2026-09-22): a «no la repitas;
  // cierra sin escribir nada» no se calló — escribió «Ya está respondido: …»,
  // una línea que le habla al aviso y no al dueño, y que además quedaba como
  // cierre del turno. Callarse del todo no lo hace; contestar una sola palabra,
  // sí. Así que se le pide el testigo «OK», y esa vuelta se RETIENE hasta
  // saber qué trae: sólo el testigo no se le enseña al dueño.
  it("🔴 tras la insistencia, contestar sólo «OK» no llega al dueño", async () => {
    const events: AgentStreamEvent[] = [];
    const vistos: Message[][] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "¿qué cambió desde tu último mensaje?" }], tools,
      openStream: grabando(scripted(
        dice("Cambiaste tú el titular a mano: ahora dice «Vitalvet · Urgencias 24h»."),
        dice("OK"),
      ), vistos),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    expect(vistos.map(ultimoDelUsuario).find((t) => t.includes("you ended the turn WITHOUT"))).toMatch(/"OK"/);
    const visto = events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");
    expect(visto, "el testigo le llegó al dueño").toBe("Cambiaste tú el titular a mano: ahora dice «Vitalvet · Urgencias 24h».");
    expect(r.finalText).toBe("Cambiaste tú el titular a mano: ahora dice «Vitalvet · Urgencias 24h».");
  });

  it("BRAZO DE CONTROL: lo que NO es el testigo —una rectificación— sí llega al dueño", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "pon el titular Vitalvet" }], tools,
      openStream: scripted(
        dice("Listo, cambié el titular."),
        dice("Perdona: no lo cambié, no llegué a llamar a ninguna herramienta."),
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    const visto = events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");
    expect(visto).toBe("Listo, cambié el titular.\n\nPerdona: no lo cambié, no llegué a llamar a ninguna herramienta.");
    expect(r.finalText).toBe("Perdona: no lo cambié, no llegué a llamar a ninguna herramienta.");
  });

  it("BRAZO DE CONTROL: si tras la insistencia ACTÚA, lo que dice se ve antes de la tarjeta", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "pon el titular Vitalvet" }], tools,
      openStream: scripted(
        dice("Listo, cambié el titular."),
        [{ type: "text_delta", text: "Ahora sí lo aplico." }, { type: "function_call", name: "editar_texto", args: { resumen: "titular" } }, usage(10), done],
        dice("Hecho."),
      ),
      runTool: async () => real("titular"),
      emit: (e) => events.push(e),
    });
    const orden = events.flatMap((e) =>
      e.type === "text" ? [`t:${e.text}`] : e.type === "action" && e.status === "running" ? [`a:${e.tool}`] : [],
    );
    expect(orden.indexOf("t:Ahora sí lo aplico."), "lo que dijo al actuar se perdió").toBeGreaterThan(-1);
    expect(orden.indexOf("t:Ahora sí lo aplico.")).toBeLessThan(orden.indexOf("a:editar_texto"));
  });

  // ⚰️ G3 decía también «al topar se mira la página» (la tarjeta de los ojos
  // en un turno que topa). Los ojos al cerrar se retiraron el 2026-10-06
  // (plans/crear-es-len); queda la mitad que sigue viva.
  it("G3 · al topar, la edición nula no llega como hecha", async () => {
    let cierre = "";
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "teléfono, titular y otra" }], tools, maxTurns: 2,
      openStream: scripted(
        llama("editar_texto", { resumen: "teléfono en el pie" }),
        llama("editar_texto", { resumen: "titular" }),
        llama("editar_texto", { resumen: "otra" }),
      ),
      runTool: async (_n, a) => a.resumen === "teléfono en el pie" ? nula("teléfono en el pie") : real(String(a.resumen)),
      closeOut: (m) => {
        cierre = ultimoDelUsuario(m);
        return (async function* () { yield { type: "text_delta" as const, text: "Cambié el titular." }; })();
      },
      emit: () => {},
    });
    expect(r.topeAlcanzado).toBe("turn_limit");
    expect(cierre, "el cierre recibía la edición nula como «SÍ se aplicó»").not.toContain("«teléfono en el pie»");
    // BRAZO DE CONTROL: la edición real sí llega como hecha, así que la de
    // arriba no pasa por un cierre vacío.
    expect(cierre).toContain("«titular»");
  });

  it("G4 · leer y luego decir «Listo, cambié…» no escapa a la insistencia", async () => {
    const vistos: Message[][] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "pon el titular Vitalvet" }], tools,
      openStream: grabando(scripted(
        llama("Read", { file_path: "/index.html" }),
        dice("Listo, cambié el titular a Vitalvet."),
      ), vistos),
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
    });
    const insistio = vistos.map(ultimoDelUsuario).some((t) => t.includes("you ended the turn WITHOUT"));
    expect(insistio, "tras una lectura, «Listo, cambié…» salía limpio y cobrado").toBe(true);
  });

  it("G5 · las llamadas rechazadas no se comen las vueltas del turno", async () => {
    let reales = 0;
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hazme un carrito" }], tools: [...tools, { name: "Edit" }],
      // La misma llamada, que falla igual: a la tercera la rechaza la guarda.
      openStream: scripted(llama("Edit", { file_path: "/index.html", old_string: "carro", new_string: "carrito" })),
      closeOut: () => (async function* () { yield { type: "text_delta" as const, text: "cierre" }; })(),
      runTool: async () => {
        reales += 1;
        return { response: { ok: false, error: "old_string is not in the file." } };
      },
      emit: () => {},
    });
    expect(reales).toBe(2);
    expect(
      { turns: r.turns, tope: r.topeAlcanzado },
      "con 2 ejecuciones reales gastaba 12 vueltas y moría en turn_limit",
    ).not.toEqual({ turns: 12, tope: "turn_limit" });
    expect(r.topeAlcanzado).not.toBe("turn_limit");
  });

  // H12-a · la batería completa del 2026-09-22 lo dio en rojo (C22): cinco
  // escrituras contra un conflicto que no iba a ceder. Con sólo el mensaje
  // nuevo bajó a tres, y 2 de 3 corridas seguían probando una más.
  describe("G7 · guardar que choca dos veces seguidas cierra el turno", () => {
    const conEditarHtml = [...tools, { name: "editar_html" }];
    const choque = (sinSalida: boolean) => ({
      response: { ok: false, error: sinSalida ? "reintentar no lo arregla" : "vuelve a intentarlo" },
      ...(sinSalida ? { guardarSinSalida: true as const } : {}),
    });

    it("🔴 la escritura que venía detrás en la misma tanda no se ejecuta, y el turno cierra sin herramientas", async () => {
      const escrituras: string[] = [];
      let instruccion = "";
      const r = await runAgentLoop({
        messages: [{ role: "user", content: "cambia el titular a Vitalvet" }], tools: conEditarHtml,
        openStream: scripted(
          llama("editar_texto", { resumen: "titular" }),
          [
            { type: "function_call", name: "editar_texto", args: { resumen: "titular otra vez" } },
            { type: "function_call", name: "editar_html", args: { resumen: "titular por html" } },
            usage(10),
            done,
          ],
          llama("editar_html", { resumen: "cuarto intento" }),
          dice("Listo."),
        ),
        runTool: async (n, a) => {
          escrituras.push(`${n}:${String(a.resumen)}`);
          return choque(escrituras.length >= 2);
        },
        closeOut: (m) => {
          instruccion = ultimoDelUsuario(m);
          return (async function* () {
            yield { type: "text_delta" as const, text: "No pude guardar: otra escritura cambia la página a la vez." };
          })();
        },
        emit: () => {},
      });
      expect(escrituras, "se ejecutaban las escrituras que venían detrás").toEqual([
        "editar_texto:titular",
        "editar_texto:titular otra vez",
      ]);
      expect(instruccion).toMatch(/couldn't be saved/);
      expect(r.finalText).toBe("No pude guardar: otra escritura cambia la página a la vez.");
      expect(r.rechazos.map((x) => x.tool)).toEqual(["editar_html"]);
      // Un turno que no pudo guardar nada no se cobra (regla del 2026-07-07).
      expect(r.sinCobro).toBe("conflicto");
    });

    it("BRAZO DE CONTROL: un choque y luego un guardado bueno siguen el turno normal", async () => {
      let n = 0;
      let cerro = false;
      const r = await runAgentLoop({
        messages: [{ role: "user", content: "cambia el titular a Vitalvet" }], tools: conEditarHtml,
        openStream: scripted(
          llama("editar_texto", { resumen: "titular" }),
          llama("editar_texto", { resumen: "titular otra vez" }),
          dice("Listo, el titular dice Vitalvet."),
        ),
        runTool: async () => (++n === 1 ? choque(false) : real("titular")),
        closeOut: () => {
          cerro = true;
          return (async function* () { yield { type: "text_delta" as const, text: "x" }; })();
        },
        emit: () => {},
      });
      expect(n).toBe(2);
      expect(cerro).toBe(false);
      expect(r.finalText).toBe("Listo, el titular dice Vitalvet.");
      // Un turno normal se cobra como siempre.
      expect(r.sinCobro).toBeUndefined();
    });
  });

});

// H4, parte 3: la ruta guarda lo que vio el modelo en este turno para
// reconstruir el historial del siguiente desde la base, como Claude Code. El
// bucle trabaja sobre una COPIA de los mensajes, así que lo tiene que devolver.
describe("H4 — el bucle devuelve la transcripción del turno", () => {
  it("las llamadas con sus argumentos, las respuestas enteras y el texto final", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "system", content: "s" }, { role: "user", content: "pon el titular Vitalvet" }],
      tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "Read", args: { file_path: "/index.html" } }, done],
        [{ type: "text_delta", text: "Listo, el titular dice Vitalvet." }, done],
      ),
      runTool: async () => ({ response: { ok: true, tool_result: "1\t<h1>Hola</h1>" } }),
      emit: () => {},
    });
    const t = r.transcripcion ?? [];
    // Nada de lo que llegó de fuera: sólo lo del turno.
    expect(t.some((m) => m.content === "pon el titular Vitalvet")).toBe(false);
    expect(t[0]!.functionCalls![0]).toEqual({ name: "Read", args: { file_path: "/index.html" } });
    expect(t[1]!.functionResponses![0]!.response.tool_result).toBe("1\t<h1>Hola</h1>");
    expect(t.at(-1)).toEqual({ role: "assistant", content: "Listo, el titular dice Vitalvet." });
  });

  it("CONTRA-PRUEBA: un turno sin texto final no inventa un mensaje vacío", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      openStream: scripted([done]),
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
    });
    expect((r.transcripcion ?? []).every((m) => m.content.trim() !== "" || m.functionCalls || m.functionResponses)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LEN 2.1 · EL TECHO DE DINERO DEL TURNO (diagnóstico §3.1, §4.4 punto 4).
//
// Sin topes de vueltas desde H1 y sin cliente delante desde que el turno no
// muere con él, lo único que acota un turno que trabaja es esto. La cuenta en
// créditos es de la ruta; aquí se prueba CUÁNDO se pregunta y cómo se cierra.
describe("el techo de dinero del turno", () => {
  const dosEdiciones = () =>
    scripted(
      [{ type: "function_call", name: "editar_pagina", args: { n: 1 } }, usage(50), done],
      [{ type: "function_call", name: "editar_pagina", args: { n: 2 } }, usage(50), done],
      [{ type: "text_delta", text: "Listo, todo hecho." }, usage(5), done],
    );

  it("🔴 pasado el techo, el turno cierra con su propio cierre y `budget_limit`", async () => {
    const vistos: number[] = [];
    const instrucciones: string[] = [];
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hazme la tienda entera" }], tools: [],
      openStream: dosEdiciones(),
      closeOut: (m) => {
        instrucciones.push(String(m.at(-1)?.content ?? ""));
        return scripted([{ type: "text_delta", text: "Paré al llegar al tope de gasto." }, usage(5), done])(m);
      },
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
      excedePresupuesto: (g) => {
        vistos.push(g.outputTokens);
        return g.outputTokens >= 100;
      },
    });
    expect(r.topeAlcanzado).toBe("budget_limit");
    expect(r.terminalError).toBe(true);
    // Cierre elegante: texto, no la tarjeta roja.
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(r.finalText).toContain("tope de gasto");
    // Se le dice POR QUÉ para: el gasto, no los pasos.
    expect(instrucciones[0]).toContain("spending cap");
    expect(instrucciones[0]).not.toContain("step limit");
    // Se pregunta ANTES de cada llamada, con lo acumulado: 0, 50 y 100.
    expect(vistos).toEqual([0, 50, 100]);
  });

  it("sin texto de cierre, el error lleva el código `budget_limit`", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: dosEdiciones(),
      closeOut: scripted([done]),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
      excedePresupuesto: (g) => g.outputTokens >= 50,
    });
    const err = events.find((e) => e.type === "error") as { code?: string } | undefined;
    expect(err?.code).toBe("budget_limit");
    expect(r.topeAlcanzado).toBe("budget_limit");
  });

  it("BRAZO DE CONTROL: por debajo del techo el turno termina como siempre", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: dosEdiciones(),
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
      excedePresupuesto: () => false,
    });
    expect(r.topeAlcanzado).toBeNull();
    expect(r.terminalError).toBe(false);
    expect(r.finalText).toBe("Listo, todo hecho.");
  });
});

// ── H15 · LEN RECUERDA LO QUE PENSÓ (01/10) ──────────────────────────────────
//
// Len tiraba su razonamiento entre pasos: cada vuelta trabajaba sin el porqué de
// las anteriores, y Fireworks le pintaba cada paso como `<think></think>`. El
// arnés de DeepSeek (con el que se evaluó V4.1) lo devuelve en CADA mensaje del
// asistente que pensó, con llamadas o sin ellas, y conserva lo pensado de una
// respuesta cortada por tope. Al dueño no se le enseña.
describe("H15 · el razonamiento vuelve al modelo dentro del turno", () => {
  const pensado = (text: string): StreamEvent => ({ type: "reasoning", text });
  const razonamientos = (m: Message[]) => m.filter((x) => x.role === "assistant").map((x) => x.reasoning);

  it("🔴 cada mensaje del asistente lleva el razonamiento de SU vuelta", async () => {
    const vistos: Message[][] = [];
    const guion = scripted(
      [pensado("busco la marca"), { type: "function_call", name: "toggle_module", args: { module: "members" } }, usage(5), done],
      [pensado("ahora el pie"), { type: "function_call", name: "toggle_module", args: { module: "bookings" } }, usage(5), done],
      [{ type: "text_delta", text: "Listo." }, usage(5), done],
    );
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "activa las dos" }], tools: [],
      openStream: (m) => { vistos.push(m.map((x) => ({ ...x }))); return guion(m); },
      runTool: async (name) => ({ response: { ok: true }, action: { tool: name, ok: true, summary: name } }),
      emit: () => {},
    });
    expect(r.terminalError).toBe(false);
    expect(vistos).toHaveLength(3);
    expect(razonamientos(vistos[1]!)).toEqual(["busco la marca"]);
    expect(razonamientos(vistos[2]!)).toEqual(["busco la marca", "ahora el pie"]);
  });

  it("🔴 también el paso de sólo texto al que se le insiste", async () => {
    const vistos: Message[][] = [];
    const guion = scripted(
      [pensado("creo que ya está"), { type: "text_delta", text: "¡Claro! Lo agrego. Listo." }, done],
      [{ type: "function_call", name: "editar_pagina", args: {} }, done],
      [{ type: "text_delta", text: "Ahora sí." }, done],
    );
    await runAgentLoop({
      messages: [{ role: "user", content: "agregame un link" }], tools: [], maxTurns: 6,
      openStream: (m) => { vistos.push(m.map((x) => ({ ...x }))); return guion(m); },
      runTool: async () => ({ response: { ok: true }, mutoDurable: true }),
      emit: () => {},
    });
    expect(razonamientos(vistos[1]!)).toEqual(["creo que ya está"]);
  });

  it("🔴 se cortó pensando: lo que pensó vuelve con el aviso, para seguir donde iba", async () => {
    const vistos: Message[][] = [];
    const guion = scripted(
      [pensado("el titular va en el h1, y luego"), usage(32_768), { type: "done", stopReason: { kind: "max_tokens" } }],
      [{ type: "text_delta", text: "Listo." }, done],
    );
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: (m) => { vistos.push(m.map((x) => ({ ...x }))); return guion(m); },
      runTool: async () => { throw new Error("must not run"); },
      emit: () => {},
    });
    expect(r.terminalError).toBe(false);
    const asistente = vistos[1]!.find((x) => x.role === "assistant");
    expect(asistente).toEqual({ role: "assistant", content: "", reasoning: "el titular va en el h1, y luego" });
    expect(vistos[1]!.at(-1)!.content).toContain("nothing came out");
  });

  it("una vuelta que no pensó no lleva el campo", async () => {
    const vistos: Message[][] = [];
    const guion = scripted(
      [{ type: "function_call", name: "toggle_module", args: { module: "members" } }, done],
      [{ type: "text_delta", text: "Listo." }, done],
    );
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: (m) => { vistos.push(m.map((x) => ({ ...x }))); return guion(m); },
      runTool: async (name) => ({ response: { ok: true }, action: { tool: name, ok: true, summary: name } }),
      emit: () => {},
    });
    expect(vistos[1]!.find((x) => x.role === "assistant")).not.toHaveProperty("reasoning");
  });

  it("al dueño no le llega ni una letra de lo pensado", async () => {
    const eventos: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [pensado("SECRETO-PENSADO"), { type: "function_call", name: "toggle_module", args: { module: "members" } }, done],
        [pensado("SECRETO-PENSADO"), { type: "text_delta", text: "Listo." }, done],
      ),
      runTool: async (name) => ({ response: { ok: true }, action: { tool: name, ok: true, summary: name } }),
      emit: (e) => eventos.push(e),
    });
    expect(JSON.stringify(eventos)).not.toContain("SECRETO-PENSADO");
  });
});

describe("pieza 4 · las llamadas de una vuelta, planificadas como DeepSeek", () => {
  const lento = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function correr(
    vuelta: StreamEvent[],
    o: {
      maxParallelToolCalls?: number;
      duracion?: (name: string, a: Record<string, unknown>) => number;
      maxToolCalls?: number;
      alEmpezar?: (name: string, a: Record<string, unknown>) => void;
      signal?: AbortSignal;
    } = {},
  ) {
    const log: string[] = [];
    const events: AgentStreamEvent[] = [];
    let enVuelo = 0;
    let maxEnVuelo = 0;
    let respuestas: string[] = [];
    const guion = scripted(vuelta, [{ type: "text_delta", text: "fin" }, usage(1), done]);
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }],
      tools: [],
      ...(o.maxParallelToolCalls ? { maxParallelToolCalls: o.maxParallelToolCalls } : {}),
      ...(o.maxToolCalls ? { maxToolCalls: o.maxToolCalls } : {}),
      ...(o.signal ? { signal: o.signal } : {}),
      openStream: (messages) => {
        const ultima = messages[messages.length - 1];
        if (ultima?.functionResponses) respuestas = ultima.functionResponses.map((f) => String(f.response.tool_result ?? f.response.error));
        return guion(messages);
      },
      runTool: async (name, a) => {
        enVuelo++;
        maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
        const id = `${name} ${String(a.file_path ?? a.query ?? "")}`;
        log.push(`empieza ${id}`);
        o.alEmpezar?.(name, a);
        await lento(o.duracion?.(name, a) ?? 20);
        enVuelo--;
        log.push(`acaba ${id}`);
        return { response: { ok: true, tool_result: id } };
      },
      emit: (e) => events.push(e),
    });
    return { r, log, maxEnVuelo, respuestas, events };
  }

  const lecturasYEdit = [
    { type: "function_call", name: "Read", args: { file_path: "/a" } },
    { type: "function_call", name: "Read", args: { file_path: "/b" } },
    { type: "function_call", name: "Edit", args: { file_path: "/c" } },
    { type: "function_call", name: "Read", args: { file_path: "/d" } },
    usage(10),
    done,
  ] as StreamEvent[];

  it("las dos lecturas del principio a la vez; el Edit, barrera; la lectura de detrás, después; respuestas en el orden del modelo", async () => {
    const { log, maxEnVuelo, respuestas } = await correr(lecturasYEdit);
    expect(maxEnVuelo).toBe(2);
    expect(log.slice(0, 2)).toEqual(["empieza Read /a", "empieza Read /b"]);
    expect(log.indexOf("empieza Edit /c")).toBeGreaterThan(log.indexOf("acaba Read /b"));
    expect(log.indexOf("empieza Read /d")).toBeGreaterThan(log.indexOf("acaba Edit /c"));
    expect(respuestas).toEqual(["Read /a", "Read /b", "Edit /c", "Read /d"]);
  });

  it("también las de DETRÁS de una barrera van juntas (F1 sólo juntaba las del principio)", async () => {
    const { log } = await correr([
      { type: "function_call", name: "Edit", args: { file_path: "/c" } },
      { type: "function_call", name: "Read", args: { file_path: "/a" } },
      { type: "function_call", name: "Grep", args: { file_path: "/b" } },
      usage(10),
      done,
    ] as StreamEvent[]);
    expect(log.indexOf("empieza Grep /b")).toBeLessThan(log.indexOf("acaba Read /a"));
  });

  it("con tope 1, todo en serie (brazo de control)", async () => {
    const { maxEnVuelo, respuestas } = await correr(lecturasYEdit, { maxParallelToolCalls: 1 });
    expect(maxEnVuelo).toBe(1);
    expect(respuestas).toEqual(["Read /a", "Read /b", "Edit /c", "Read /d"]);
  });

  it("la tarjeta de cada una sale AL EMPEZAR, y su 'done' en el orden del modelo aunque acabe antes", async () => {
    const { events } = await correr(
      [
        { type: "function_call", name: "Read", args: { file_path: "/lenta" } },
        { type: "function_call", name: "Read", args: { file_path: "/rapida" } },
        usage(10),
        done,
      ] as StreamEvent[],
      { duracion: (_n, a) => (a.file_path === "/lenta" ? 40 : 1) },
    );
    const tarjetas = events
      .filter((e) => e.type === "action")
      .map((e) => `${(e as { status: string }).status} ${(e as { summary: string }).summary}`);
    expect(tarjetas).toEqual(["running lenta", "running rapida", "done lenta", "done rapida"]);
  });

  it("🔴 use_page con un clic no se solapa con nada", async () => {
    const { log } = await correr([
      { type: "function_call", name: "Read", args: { file_path: "/a" } },
      { type: "function_call", name: "use_page", args: { steps: [{ click: "Enviar" }] } },
      { type: "function_call", name: "Read", args: { file_path: "/b" } },
      usage(10),
      done,
    ] as StreamEvent[]);
    expect(log.indexOf("empieza use_page ")).toBeGreaterThan(log.indexOf("acaba Read /a"));
    expect(log.indexOf("empieza Read /b")).toBeGreaterThan(log.indexOf("acaba use_page "));
  });

  it("🔴 el ■ a mitad de grupo: las empezadas se quedan, las demás 'abortadas' sin tarjeta, ninguna empieza después, cierra cancelado", async () => {
    const ac = new AbortController();
    const { r, log, respuestas, events } = await correr(
      [
        { type: "function_call", name: "Read", args: { file_path: "/a" } },
        { type: "function_call", name: "Read", args: { file_path: "/b" } },
        { type: "function_call", name: "Read", args: { file_path: "/c" } },
        { type: "function_call", name: "Edit", args: { file_path: "/x" } },
        usage(10),
        done,
      ] as StreamEvent[],
      {
        maxParallelToolCalls: 2,
        signal: ac.signal,
        alEmpezar: (_n, a) => {
          if (a.file_path === "/b") ac.abort();
        },
      },
    );
    expect(log.filter((l) => l.startsWith("empieza"))).toEqual(["empieza Read /a", "empieza Read /b"]);
    expect(r.errorCode).toBe("cancelled");
    expect(events.filter((e) => e.type === "action" && (e as { status: string }).status === "running")).toHaveLength(2);
    // La transcripción del turno queda equilibrada: las cuatro llamadas con su respuesta.
    const ultimo = r.transcripcion?.[r.transcripcion.length - 1];
    expect(ultimo?.functionResponses?.map((f) => String(f.response.tool_result ?? f.response.error))).toEqual([
      "Read /a",
      "Read /b",
      "tool call aborted before dispatch",
      "tool call aborted before dispatch",
    ]);
    expect(respuestas).toEqual([]);
  });

  it("🔴 el tope de acciones a mitad de grupo: no empieza la que topa, la empezada se confirma y el cierre la ve", async () => {
    const { log, r } = await correr(
      [
        { type: "function_call", name: "web_search", args: { query: "uno" } },
        { type: "function_call", name: "web_search", args: { query: "dos" } },
        usage(10),
        done,
      ] as StreamEvent[],
      { maxToolCalls: 1 },
    );
    expect(log.filter((l) => l.startsWith("empieza"))).toEqual(["empieza web_search uno"]);
    expect(r.topeAlcanzado).toBe("tool_limit");
  });

  it("una errata y una inexistente en mitad del grupo responden en su sitio", async () => {
    const { respuestas } = await correr([
      { type: "function_call", name: "Read", args: { file_path: "/a" } },
      { type: "function_call", name: "NoExiste", args: {} },
      { type: "function_call", name: "Read", args: { file_path: "/b" } },
      usage(10),
      done,
    ] as StreamEvent[]);
    expect(respuestas[0]).toBe("Read /a");
    expect(respuestas[2]).toBe("Read /b");
    expect(respuestas).toHaveLength(3);
  });
});

describe("reintentos ante fallos del proveedor (como el arnés de DeepSeek)", () => {
  const fallo = (code?: "server" | "transport" | "rate_limit"): StreamEvent => ({
    type: "done",
    stopReason: { kind: "error", error: "http_503", ...(code ? { code } : {}) },
  });

  it("un 503 se reintenta y el turno termina bien, sin error a la vista", async () => {
    const events: AgentStreamEvent[] = [];
    const esperas: number[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hola" }], tools: [],
      openStream: scripted([fallo("server")], [{ type: "text_delta", text: "¡Hola!" }, usage(5), done]),
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
      sleep: async (ms) => { esperas.push(ms); },
    });
    expect(r.finalText).toBe("¡Hola!");
    expect(r.terminalError).toBe(false);
    expect(events.filter((e) => e.type === "retry")).toHaveLength(1);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(esperas).toHaveLength(1);
    expect(esperas[0]).toBeGreaterThanOrEqual(450);
    expect(esperas[0]).toBeLessThanOrEqual(550);
  });

  it("lo que el intento fallido llegó a escribir se retira y NO entra en la conversación", async () => {
    const vistos: Message[][] = [];
    const guion = scripted(
      [{ type: "text_delta", text: "Voy a mir" }, fallo("transport")],
      [{ type: "text_delta", text: "Listo." }, usage(5), done],
    );
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hola" }], tools: [],
      openStream: (m) => { vistos.push(structuredClone(m)); return guion(m); },
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
      sleep: async () => {},
    });
    const retry = events.find((e) => e.type === "retry") as Extract<AgentStreamEvent, { type: "retry" }>;
    expect(retry.discardChars).toBe("Voy a mir".length);
    expect(r.finalText).toBe("Listo.");
    expect(JSON.stringify(vistos[1])).not.toContain("Voy a mir");
  });

  it("si ya había hablado en una vuelta anterior, el separador del intento fallido también se retira", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "busca" }], tools: [],
      openStream: scripted(
        [{ type: "text_delta", text: "Miro." }, { type: "function_call", name: "Read", args: { file_path: "/index.html" } }, usage(5), done],
        [{ type: "text_delta", text: "Ya v" }, fallo("server")],
        [{ type: "text_delta", text: "Ya está." }, usage(5), done],
      ),
      runTool: async () => ({ response: { ok: true, tool_result: "1\t<h1>" }, action: { tool: "Read", ok: true, summary: "/index.html" } }),
      emit: (e) => events.push(e),
      sleep: async () => {},
    });
    const retry = events.find((e) => e.type === "retry") as Extract<AgentStreamEvent, { type: "retry" }>;
    expect(retry.discardChars).toBe("\n\n".length + "Ya v".length);
  });

  it("tras 5 reintentos fallidos, el turno termina con el error de siempre", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hola" }], tools: [],
      openStream: scripted([fallo("server")]),
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
      sleep: async () => {},
    });
    expect(events.filter((e) => e.type === "retry")).toHaveLength(5);
    expect(events.filter((e) => e.type === "error" && e.code === "upstream")).toHaveLength(1);
    expect(r.terminalError).toBe(true);
  });

  it("BRAZO DE CONTROL: un fallo sin código (un 400) no se reintenta", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hola" }], tools: [],
      openStream: scripted([fallo()], [{ type: "text_delta", text: "no debe llegar" }, done]),
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
      sleep: async () => { throw new Error("no debe esperar"); },
    });
    expect(events.some((e) => e.type === "retry")).toBe(false);
    expect(r.terminalError).toBe(true);
    expect(r.finalText).not.toContain("no debe llegar");
  });

  it("🔴 el ■ durante la espera, en una vuelta RETENIDA (tras la insistencia), no enseña el texto descartado", async () => {
    const ctrl = new AbortController();
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el título" }], tools: [], maxTurns: 6,
      openStream: scripted(
        // Vuelta 1: sólo prosa → insistencia; la vuelta 2 se RETIENE.
        [{ type: "text_delta", text: "¡Claro! Lo cambio." }, done],
        [{ type: "text_delta", text: "Ya está respondido: el tit" }, fallo("server")],
        [{ type: "text_delta", text: "no debe llegar" }, done],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
      signal: ctrl.signal,
      sleep: async () => { ctrl.abort(); },
    });
    const textos = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
    expect(textos).not.toContain("Ya está respondido");
    expect(events.some((e) => e.type === "error" && e.code === "cancelled")).toBe(true);
  });

  it("el ■ durante la espera corta sin lanzar otro intento", async () => {
    const ctrl = new AbortController();
    const events: AgentStreamEvent[] = [];
    let llamadas = 0;
    const guion = scripted([fallo("server")], [{ type: "text_delta", text: "no debe llegar" }, done]);
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "hola" }], tools: [],
      openStream: (m) => { llamadas += 1; return guion(m); },
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
      signal: ctrl.signal,
      sleep: async () => { ctrl.abort(); },
    });
    expect(llamadas).toBe(1);
    expect(events.some((e) => e.type === "error" && e.code === "cancelled")).toBe(true);
    expect(r.terminalError).toBe(true);
  });
});

describe("compactación dentro del turno (como el arnés de DeepSeek)", () => {
  // Sólo herramientas de lectura: un cierre sin acción no recibe la insistencia
  // (ver `puedeActuar`), así que cada guion es UNA llamada. Y 1 token de entrada
  // por llamada: la presión que se mide después es la de la conversación, no la
  // cifra fija de `usage`.
  const leer = [{ name: "Read" }];
  const uso = (o: number): StreamEvent => ({ type: "usage", inputTokens: 1, outputTokens: o, cachedTokens: 0, thinkingTokens: 0 });
  const historial = (n: number): Message[] => [
    { role: "system", content: "s" }, { role: "user", content: "manual" },
    ...Array.from({ length: n }, (_, i): Message => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(70) })),
    { role: "user", content: "ahora haz esto" },
  ];
  const compaction = { policy: { thresholdTokens: 100, retainTokens: 20 }, firstIndex: 2 };
  const esResumen = (m: Message[]) => m.at(-1)?.content.includes("You are now acting as a compaction engine") === true;

  it("BRAZO DE CONTROL: sin `compaction`, el bucle no resume nada", async () => {
    const vistos: Message[][] = [];
    const guion = scripted([{ type: "text_delta", text: "ok" }, uso(1), done]);
    await runAgentLoop({
      messages: historial(10), tools: leer,
      openStream: (m) => { vistos.push(m); return guion(m); },
      runTool: async () => { throw new Error("must not run"); }, emit: () => {},
    });
    // (Puede haber más llamadas —el aviso de cierre—, pero ninguna es un resumen.)
    expect(vistos.some(esResumen)).toBe(false);
  });

  it("por encima del umbral, la primera llamada es el resumen y la segunda va compactada", async () => {
    const vistos: Message[][] = [];
    const events: AgentStreamEvent[] = [];
    const guion = scripted(
      [{ type: "text_delta", text: "## Primary Request and Intent\n- haz esto" }, uso(10), done],
      [{ type: "text_delta", text: "Hecho." }, uso(5), done],
    );
    const r = await runAgentLoop({
      messages: historial(10), tools: leer, compaction,
      openStream: (m) => { vistos.push(structuredClone(m)); return guion(m); },
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
    });
    expect(vistos[0]!.at(-1)!.content).toContain("You are now acting as a compaction engine");
    expect(JSON.stringify(vistos[1])).toContain("<compacted-summary>");
    expect(vistos[1]!.at(-1)!.content).toBe("ahora haz esto");
    // El aviso de que empieza va ANTES de la llamada del resumen; el de que acabó, después.
    const tipos = events.map((e) => e.type);
    expect(tipos.indexOf("compaction_start")).toBeLessThan(tipos.indexOf("compaction"));
    expect(events).toContainEqual({ type: "compaction_start" });
    expect(events).toContainEqual({ type: "compaction", pruned: 0, summarized: true, discardChars: 0 });
    expect(r.finalText).toBe("Hecho.");
    expect(r.usage.outputTokens).toBe(15); // el resumen se cobra
    expect(events.some((e) => e.type === "text" && e.text.includes("Primary Request"))).toBe(false); // el resumen NO se le enseña al dueño
  });

  it("un resumen que intenta llamar una herramienta se descarta, se cobra lo que usó y el turno sigue sin resumen", async () => {
    const vistos: Message[][] = [];
    const guion = scripted(
      [{ type: "function_call", name: "Read", args: { file_path: "/index.html" } }, uso(1), done],
      [{ type: "text_delta", text: "Hecho." }, uso(5), done],
    );
    const r = await runAgentLoop({
      messages: historial(10), tools: leer, compaction,
      openStream: (m) => { vistos.push(structuredClone(m)); return guion(m); },
      runTool: async () => { throw new Error("must not run"); }, emit: () => {},
    });
    expect(JSON.stringify(vistos[1])).not.toContain("<compacted-summary>");
    expect(r.finalText).toBe("Hecho.");
    expect(r.usage.outputTokens).toBe(6);
  });

  it("con el ■ ya dado, no arranca una llamada de resumen", async () => {
    const vistos: Message[][] = [];
    const events: AgentStreamEvent[] = [];
    const ctrl = new AbortController();
    ctrl.abort();
    const guion = scripted([{ type: "done", stopReason: { kind: "cancelled" } }]);
    await runAgentLoop({
      messages: historial(10), tools: leer, compaction, signal: ctrl.signal,
      openStream: (m) => { vistos.push(structuredClone(m)); return guion(m); },
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
    });
    expect(vistos.some(esResumen)).toBe(false);
    expect(events.some((e) => e.type === "compaction_start")).toBe(false);
  });

  it("un desborde del proveedor compacta sin mirar el umbral y repite el paso una vez", async () => {
    const vistos: Message[][] = [];
    const events: AgentStreamEvent[] = [];
    const desborde: StreamEvent = { type: "done", stopReason: { kind: "error", error: "http_400", code: "context_window_exceeded" } };
    const guion = scripted(
      [desborde],
      [{ type: "text_delta", text: "## Primary Request and Intent\n- r" }, uso(3), done],
      [{ type: "text_delta", text: "Hecho." }, uso(5), done],
    );
    // historial(10): con 4 mensajes el resumen (preámbulo + etiquetas, ~110 tokens) no encogería y se rechazaría.
    const r = await runAgentLoop({
      messages: historial(10), tools: leer, compaction: { policy: { thresholdTokens: 1_000_000, retainTokens: 20 }, firstIndex: 2 },
      openStream: (m) => { vistos.push(structuredClone(m)); return guion(m); },
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
    });
    expect(vistos).toHaveLength(3);
    expect(JSON.stringify(vistos[2])).toContain("<compacted-summary>");
    expect(r.finalText).toBe("Hecho.");
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("el segundo desborde del mismo turno ya no se reintenta: error claro", async () => {
    const desborde: StreamEvent = { type: "done", stopReason: { kind: "error", error: "http_400", code: "context_window_exceeded" } };
    const events: AgentStreamEvent[] = [];
    // historial(10), para que el PRIMER desborde sí se recupere y lo que se prueba sea el segundo.
    const r = await runAgentLoop({
      messages: historial(10), tools: leer, compaction: { policy: { thresholdTokens: 1_000_000, retainTokens: 20 }, firstIndex: 2 },
      openStream: scripted([desborde], [{ type: "text_delta", text: "r" }, uso(1), done], [desborde]),
      runTool: async () => { throw new Error("must not run"); },
      emit: (e) => events.push(e),
    });
    expect(r.terminalError).toBe(true);
    expect(events.filter((e) => e.type === "error")).toHaveLength(1);
  });

  it("BRAZO DE CONTROL: sin `compaction`, un desborde es un error como siempre (no se resume)", async () => {
    const desborde: StreamEvent = { type: "done", stopReason: { kind: "error", error: "http_400", code: "context_window_exceeded" } };
    const vistos: Message[][] = [];
    const r = await runAgentLoop({
      messages: historial(10), tools: leer,
      openStream: (m) => { vistos.push(m); return scripted([desborde])(m); },
      runTool: async () => { throw new Error("must not run"); }, emit: () => {},
    });
    expect(vistos).toHaveLength(1);
    expect(r.terminalError).toBe(true);
  });

  it("🔴 la transcripción del turno sobrevive a la compactación: lleva sus llamadas y respuestas, no el resumen", async () => {
    const guion = scripted(
      [{ type: "text_delta", text: "## Primary Request and Intent\n- haz esto" }, uso(1), done],
      [{ type: "function_call", name: "Read", args: { file_path: "/index.html" } }, uso(1), done],
      [{ type: "text_delta", text: "Hecho." }, uso(1), done],
    );
    const r = await runAgentLoop({
      messages: historial(10), tools: leer, compaction,
      openStream: guion,
      runTool: async () => ({ response: { ok: true, tool_result: "<html></html>" } }),
      emit: () => {},
    });
    const t = r.transcripcion ?? [];
    expect(t.some((m) => m.functionCalls?.[0]?.name === "Read")).toBe(true);
    expect(t.some((m) => m.functionResponses?.[0]?.name === "Read")).toBe(true);
    expect(t.at(-1)).toMatchObject({ role: "assistant", content: "Hecho." });
    expect(JSON.stringify(t)).not.toContain("<compacted-summary>");
  });

  it("lo que el modelo aún no vio no se poda, aunque detrás llegue una corrección del dueño", async () => {
    const vistos: Message[][] = [];
    const largo = "r".repeat(20_000);
    let direcciones = 0;
    const guion = scripted(
      [{ type: "function_call", name: "Read", args: { file_path: "/index.html" } }, uso(1), done],
      // El resumen de la vuelta 2 se descarta (llama una herramienta): así la
      // llamada siguiente lleva la conversación tal cual, podada o no.
      [{ type: "function_call", name: "Read", args: {} }, uso(1), done],
      [{ type: "text_delta", text: "Hecho." }, uso(1), done],
    );
    await runAgentLoop({
      messages: [{ role: "system", content: "s" }, { role: "user", content: "manual" }, { role: "user", content: "lee la página" }],
      tools: leer,
      compaction: { policy: { thresholdTokens: 1_000, retainTokens: 10 }, firstIndex: 2 },
      leerDireccion: () => (direcciones++ === 1 ? "mejor en azul" : null),
      openStream: (m) => { vistos.push(structuredClone(m)); return guion(m); },
      runTool: async () => ({ response: { ok: true, tool_result: largo } }),
      emit: () => {},
    });
    // La llamada de la vuelta 2 (no el resumen): la que lleva la corrección al final.
    const vuelta2 = vistos.find((m) => !esResumen(m) && m.at(-1)!.content.includes("mejor en azul"));
    expect(vuelta2).toBeDefined();
    expect(JSON.stringify(vuelta2)).toContain(largo);
  });
});

describe("sobreQue: el resumen de la tarjeta de cada llamada", () => {
  it("pieza 5: la tarjeta de buscar en charlas pasadas enseña lo que se busca", () => {
    expect(sobreQue({ query: "horario de la tienda" })).toBe("horario de la tienda");
    expect(sobreQue({ query: "x".repeat(100) })).toHaveLength(60);
  });
});

describe("la retención de resultados grandes (spill-policy de DeepSeek)", () => {
  async function correr(tool: string, conSpill: boolean) {
    const ficheros: Record<string, string> = {};
    let vista: Record<string, unknown> | undefined;
    const guion = scripted(
      [{ type: "function_call", name: tool, args: { query: "x" } }, usage(1), done],
      [{ type: "text_delta", text: "listo" }, usage(1), done],
    );
    await runAgentLoop({
      messages: [{ role: "user", content: "busca" }],
      tools: [],
      ...(conSpill ? { spill: { maxInlineTokens: 200, save: async (p: string, t: string) => ((ficheros[p] = t), true) } } : {}),
      openStream: (m) => {
        const ultima = m[m.length - 1];
        if (ultima?.functionResponses) vista = ultima.functionResponses[0]!.response;
        return guion(m);
      },
      runTool: async () => ({ response: { ok: true, tool_result: "Z".repeat(5000) } }),
      emit: () => undefined,
    });
    return { ficheros, vista: vista! };
  }

  it("🔴 un resultado de más de maxInlineTokens llega recortado con su aviso, y el entero queda en /tmp/spill", async () => {
    const { ficheros, vista } = await correr("session_event_read", true);
    const ruta = Object.keys(ficheros)[0]!;
    expect(ruta).toMatch(/^\/tmp\/spill\/\d+-0-session_event_read\.txt$/);
    expect(ficheros[ruta]).toBe("Z".repeat(5000));
    expect(String(vista.tool_result)).toContain(`Full formatted result stored at: ${ruta}`);
    expect(String(vista.tool_result).length).toBeLessThan(5000);
    expect(vista.ok).toBe(true);
  });

  it("Read no se recorta (como el `read` de DeepSeek), ni nada sin dónde guardar", async () => {
    expect(String((await correr("Read", true)).vista.tool_result)).toHaveLength(5000);
    expect(String((await correr("session_event_read", false)).vista.tool_result)).toHaveLength(5000);
  });
});

// ─── PIEZA 7 · EL MODO PLAN ─────────────────────────────────────────────────
// En modo plan no cambiar nada es lo que se pide: el empujón de «anunciaste un
// cambio y no lo hiciste» no puede mandarle a editar a media exploración.
describe("el modo plan no recibe la insistencia", () => {
  const insistencia = (m: Message[]) =>
    m.some((x) => x.role === "user" && typeof x.content === "string" && x.content.includes("you ended the turn WITHOUT"));
  const leerYContar = async (planModeActive: (() => boolean) | undefined) => {
    const vistos: Message[][] = [];
    const stream = scripted(
      [{ type: "function_call", name: "Read", args: { file_path: "/index.html" } }, done],
      [{ type: "text_delta", text: "Ya miré la página; ahora te propongo el plan." }, done],
      [{ type: "text_delta", text: "OK" }, done],
    );
    await runAgentLoop({
      messages: [{ role: "user", content: "añade reseñas" }], tools: [],
      openStream: (m) => { vistos.push([...m]); return stream(m); },
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
      ...(planModeActive ? { planModeActive } : {}),
    });
    return vistos;
  };

  it("🔴 en modo plan, leer y contar cierra sin empujón", async () => {
    expect((await leerYContar(() => true)).some(insistencia)).toBe(false);
  });

  it("BRAZO DE CONTROL: fuera del modo plan, el mismo turno lo recibe", async () => {
    expect((await leerYContar(() => false)).some(insistencia)).toBe(true);
    expect((await leerYContar(undefined)).some(insistencia)).toBe(true);
  });
});

// ─── PIEZA 8 · EL ENCARGO ───────────────────────────────────────────────────
// El `deferContext` de DeepSeek: lo que una herramienta deja para el paso
// siguiente (el cierre de un encargo) viaja en el mensaje de las respuestas.
describe("el encargo en el bucle", () => {
  it("el aviso de una herramienta llega al modelo con las respuestas de la tanda", async () => {
    const vistos: Message[][] = [];
    const stream = scripted(
      [{ type: "function_call", name: "update_goal", args: { goal_id: "goal-1", revision: 1, action: "complete" } }, done],
      [{ type: "text_delta", text: "Hecho." }, done],
    );
    await runAgentLoop({
      messages: [{ role: "user", content: "<goal_round>…</goal_round>" }], tools: [],
      openStream: (m) => { vistos.push([...m]); return stream(m); },
      runTool: async () => ({ response: { ok: true }, notice: "<goal_complete>\nescribe el cierre\n</goal_complete>" }),
      emit: () => {},
    });
    const conRespuestas = vistos[1]!.at(-1)!;
    expect(conRespuestas.functionResponses?.[0]?.name).toBe("update_goal");
    expect(conRespuestas.content).toContain("<goal_complete>\nescribe el cierre\n</goal_complete>");
  });

  it("get_goal, create_goal y update_goal no gastan presupuesto de acciones", async () => {
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxToolCalls: 1,
      openStream: scripted([
        { type: "function_call", name: "editar_pagina", args: {} },
        { type: "function_call", name: "get_goal", args: {} },
        { type: "function_call", name: "create_goal", args: { objective: "la tienda" } },
        { type: "function_call", name: "update_goal", args: { goal_id: "g", revision: 1, action: "complete" } },
        done,
      ], [{ type: "text_delta", text: "Listo." }, done]),
      runTool: async () => ({ response: { ok: true } }),
      emit: () => {},
    });
    expect(r.terminalError).toBe(false);
  });
});

describe("runAgentLoop — la página a medias (plans/crear-es-len)", () => {
  it("un Write de /index.html emite page_preview mientras llegan los trozos, y después el html de siempre", async () => {
    const contenido = "<!doctype html><title>T</title>" + "<p>x</p>".repeat(400); // > 1.500 caracteres
    const args = JSON.stringify({ file_path: "/index.html", content: contenido });
    const mitad = Math.floor(args.length / 2);
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "hazme la página" }], tools: [],
      openStream: scripted(
        [
          { type: "function_call_delta", index: 0, name: "Write", argsDelta: args.slice(0, mitad) },
          { type: "function_call_delta", index: 0, name: "Write", argsDelta: args.slice(mitad) },
          { type: "function_call", name: "Write", args: JSON.parse(args) as Record<string, unknown> },
          done,
        ],
        [{ type: "text_delta", text: "Lista." }, done],
      ),
      runTool: async () => ({ response: { ok: true }, updatedHtml: contenido }),
      emit: (e) => events.push(e),
    });
    const tipos = events.map((e) => e.type);
    expect(tipos).toContain("page_preview");
    expect(tipos.indexOf("page_preview")).toBeLessThan(tipos.indexOf("html"));
    expect(events.find((e) => e.type === "page_preview")).toMatchObject({ page: null });
  });

  it("un Write de /js/app.js no emite ninguna vista previa", async () => {
    const args = JSON.stringify({ file_path: "/js/app.js", content: "x".repeat(4000) });
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call_delta", index: 0, name: "Write", argsDelta: args }, { type: "function_call", name: "Write", args: JSON.parse(args) as Record<string, unknown> }, done],
        [{ type: "text_delta", text: "ok" }, done],
      ),
      runTool: async () => ({ response: { ok: true } }),
      emit: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === "page_preview")).toBe(false);
  });
});

describe("runAgentLoop — sin medición obligatoria al cerrar (plans/crear-es-len)", () => {
  it("un turno que mutó cierra sin la tarjeta verificar_diseno: mirar lo decide Len, como en Claude Code y DeepSeek", async () => {
    const events: AgentStreamEvent[] = [];
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "Write", args: { file_path: "/index.html", content: "<h1>v2</h1>" } }, done],
        [{ type: "text_delta", text: "Listo." }, done],
      ),
      runTool: async () => ({ response: { ok: true }, updatedHtml: "<h1>v2</h1>" }),
      emit: (e) => events.push(e),
    });
    expect(r.finalText).toContain("Listo");
    expect(events.some((e) => e.type === "action" && (e as { tool?: string }).tool === "verificar_diseno")).toBe(false);
  });
});
