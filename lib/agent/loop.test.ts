import { describe, expect, it } from "vitest";
import type { Message, StreamEvent } from "@/lib/ai-gateway";
import { runAgentLoop, type AgentStreamEvent } from "./loop";
import { etiquetarConPosiciones } from "./ficheros/posiciones";

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
      [{ type: "function_call", name: "activar_modulo", args: { modulo: "members" } }, usage(10, 30), done],
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
    expect(assistantTurn?.functionCalls?.[0]).toEqual({ name: "activar_modulo", args: { modulo: "members" } });
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
  // UNA PROMESA ROTA SE DICE, Y SE VE (2026-09-18, Tarea 4).
  //
  // Los ojos ya recomprueban las promesas que la página cumplió antes. Lo que
  // faltaba es que, cuando una deja de cumplirse, salga de los ojos: hasta aquí
  // moría en el veredicto.
  //
  // Va ANTES de las ramas del veredicto y fuera de todas: un turno puede salir
  // «bien» y haberse llevado por delante el carrito de hace seis turnos.
  it("🔴 una promesa rota sale en ámbar aunque el turno salga BIEN", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_html", args: {} }, done],
        [{ type: "text_delta", text: "hecho" }, done],
      ),
      runTool: async () => ({ response: { ok: true }, updatedHtml: "<html></html>" }),
      verifyTurn: async () => ({
        estado: "bien" as const,
        conMedida: true,
        regresiones: [{ id: "p1", paso: 1, mensaje: "#total ya no cambia al pulsar #agregar" }],
      }),
      emit: (e) => events.push(e),
    });
    const ambar = events.find(
      (e) => e.type === "action" && e.status === "warning" && e.summary === "regresion",
    );
    expect(ambar).toBeDefined();
    expect((ambar as { motivo?: string }).motivo).toContain("#total ya no cambia");
    // Y SE DICE: el texto va a la conversación, que es como entra en el
    // historial que el modelo lee en el turno siguiente — los ojos corren al
    // cerrar, así que no puede arreglarlo sobre la marcha.
    const dicho = events.filter((e) => e.type === "text").map((e) => e.text).join(" ");
    expect(dicho).toContain("#total ya no cambia");
  });

  // CONTRA-PRUEBA: un veredicto sin regresiones no pinta nada. Sin esto, una
  // tarjeta ámbar en cada turno sano enseñaría al dueño a no mirarlas.
  it("CONTRA-PRUEBA: sin regresiones no hay tarjeta ámbar de la suite", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_html", args: {} }, done],
        [{ type: "text_delta", text: "hecho" }, done],
      ),
      runTool: async () => ({ response: { ok: true }, updatedHtml: "<html></html>" }),
      verifyTurn: async () => ({ estado: "bien" as const, conMedida: true }),
      emit: (e) => events.push(e),
    });
    expect(
      events.some((e) => e.type === "action" && e.summary === "regresion"),
    ).toBe(false);
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
      runTool: async () => ({ response: { ok: true, error: "no es un fallo" } }),
      emit: (e) => events.push(e),
    });
    for (const e of events) {
      if (e.type === "action") expect("motivo" in e).toBe(false);
    }
  });

  it("caps runaway loops at maxTurns", async () => {
    const events: AgentStreamEvent[] = [];
    // editar_pagina is a mutating tool — Read/elegir_foto are read-only
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
    // editar_pagina is a budgeted (non-read-only) tool — Read/elegir_foto
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
        [fc("Read", { file_path: "/menu/index.html" }), fc("Grep", { pattern: "600 11" }), fc("Glob", { pattern: "*/index.html" }), fc("mirar_pagina", {}), done],
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
      name: i % 2 === 0 ? "elegir_foto" : "editar_pagina",
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

  // EL BORRADOR DE RESPUESTA (plans/len-resultados/): mismo camino que publicar,
  // otra espera. El modelo lee «nada enviado», nunca algo que suene a hecho.
  it("el borrador de preparar_respuesta sale como confirm y el modelo lee que NADA se envió", async () => {
    const events: AgentStreamEvent[] = [];
    const callsSeen: Message[][] = [];
    const stream = scripted(
      [{ type: "function_call", name: "preparar_respuesta", args: { para: "chat", id: "c1", texto: "Sí, abrimos el domingo" } }, done],
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
        action: { tool: "preparar_respuesta", ok: true, summary: "Juan" },
        confirm: borrador,
      }),
      emit: (e) => events.push(e),
    });

    expect(events.find((e) => e.type === "confirm")).toEqual({ type: "confirm", ...borrador });
    const frTurn = callsSeen[1].find((m) => m.functionResponses);
    const fr = (frTurn as { functionResponses: { name: string; response: Record<string, unknown> }[] })
      .functionResponses[0];
    expect(fr.response.estado).toBe("borrador_en_una_tarjeta_nada_enviado");
    expect(fr.response).not.toHaveProperty("subdominio");
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

  // EL GEMELO LLEGA A LOS OJOS. Len 2.0 (T9): lo hace el bucle —el gemelo CON
  // POSICIONES de lo guardado—, en un solo sitio, así que ninguna herramienta
  // puede olvidarse de traerlo. Sin él los ojos medirían el documento guardado
  // y lo que encuentren no traería línea.
  it("el gemelo con posiciones de la mutación llega a los ojos", async () => {
    let visto: { html: string; taggedHtml?: string } | null = null;
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: editThenClose(),
      runTool: async () => ({
        response: { ok: true },
        updatedHtml: "<!doctype html><html><body>v2</body></html>",
      }),
      verifyTurn: async (info) => { visto = info; return { estado: "bien" as const }; },
      emit: () => {},
    });
    expect(visto).not.toBeNull();
    expect(visto!.taggedHtml).toBe(etiquetarConPosiciones("<!doctype html><html><body>v2</body></html>"));
    expect(visto!.taggedHtml).toContain('<body data-op-id="L1C22">');
    // Y el guardado sigue viajando aparte: es lo que se FOTOGRAFIA.
    expect(visto!.html).toContain("v2");
    expect(visto!.html).not.toContain("data-op-id");
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
  // todas ellas enseñarían «solo el JavaScript» de turnos que sí midieron — un
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

describe("runAgentLoop — lo medido vuelve al modelo", () => {
  // Una tanda que edita: es la condición para medir. Len 2.0 (T9): el bucle
  // hace el GEMELO CON POSICIONES de lo guardado, así que cada nodo que el
  // navegador señala trae su línea del fichero.
  const edita = (): StreamEvent[] => [
    { type: "function_call", name: "Edit", args: {} },
    done,
  ];
  const VISIBLE = '<html>\n<body>\n<div class="grid">x</div>\n</body>\n</html>';
  const GEMELO = etiquetarConPosiciones(VISIBLE);
  const herramientaQueEdita = async () => ({
    response: { ok: true },
    action: { tool: "Edit", ok: true, summary: "editado" },
    updatedHtml: VISIBLE,
    page: null as string | null,
  });
  const desbordado = {
    mobileOverflow: true,
    overflowCulprit: "div.grid",
    overflowCulpritRight: 482,
    overflowCulpritKind: "caja" as const,
    // La línea y la columna del <div> en el fichero: su id en el gemelo.
    overflowCulpritOpId: "L3C1",
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
    // El aviso está en el sobre, anclado a su línea...
    expect(conRespuestas?.content).toContain("<new-diagnostics>");
    expect(conRespuestas?.content).toContain("/index.html:\n  ⚠ [Line 3:1]");
    expect(conRespuestas?.content).toContain("482px");
    // ...y NO dentro de la respuesta de la herramienta, que es suya.
    expect(JSON.stringify(conRespuestas?.functionResponses)).not.toContain("482px");
  });

  it("se le mide el GEMELO CON POSICIONES, que es donde viven las líneas", async () => {
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
    expect(medidos).toEqual([GEMELO]);
    expect(GEMELO).toContain('<div data-op-id="L3C1" class="grid">');
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
    expect(contenido).toContain("found no defects");
    expect(contenido).toContain("That is ALL this measurement looks at");
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
    expect(contenido).toContain("<measurement-limits>");
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
    expect(contenido).toContain("found no defects");
    expect(contenido).toContain("<measurement-limits>");
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
    expect(contenido).toContain("<new-diagnostics>");
    expect(contenido).toContain("403 origen_invalido");
    expect(contenido).toContain("`/api/d/<store>`, without a subdomain");
    expect(contenido).not.toContain("found no defects");
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
    expect(contenido).not.toContain("<measurement-limits>");
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
    expect(contenido).not.toContain("found no defects");
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
        return { ...(await herramientaQueEdita()), updatedHtml: VISIBLE.replace(">x<", `>x${n}<`) };
      },
      emit: () => {},
      medirParaElModelo: async () => desbordado,
    });
    // La ÚLTIMA foto lleva el historial entero. Contar sobre `vistos.flat()`
    // contaría el mismo mensaje una vez por vuelta.
    const ultima = vistos.at(-1) ?? [];
    const sobres = ultima.filter((m) => m.functionResponses).map((m) => m.content);
    expect(sobres).toHaveLength(2);
    expect(sobres.filter((c) => c && c.includes("[Line 3:1]"))).toHaveLength(1);
  });

  // ── LA LÍNEA BASE ───────────────────────────────────────────────────────
  //
  // La forma de Claude Code: se mide ANTES de editar y sólo se reporta la
  // diferencia. Len 2.0 (T9): la base es la de CADA fichero —cómo estaba antes
  // de la primera escritura del turno sobre él, que la herramienta trae en
  // `htmlPrevio`—, no sólo la de la página con la que arrancó el turno.
  describe("la línea base", () => {
    const BASE = '<html>\n<body>\n<div class="grid">antes</div>\n</body>\n</html>';
    const GEMELO_BASE = etiquetarConPosiciones(BASE);
    const conBase = async () => ({ ...(await herramientaQueEdita()), htmlPrevio: BASE });
    const sobresDe = (vistos: Message[][]) =>
      (vistos.at(-1) ?? []).filter((m) => m.functionResponses).map((m) => m.content as string);

    it("🔴 un defecto que YA venía en el fichero NO se le dice", async () => {
      const vistos: Message[][] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "cambia el título" }],
        tools: [],
        openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
        runTool: conBase,
        emit: () => {},
        // La misma medida para lo guardado Y para la base: el desborde estaba
        // ahí antes de que el modelo tocara nada.
        medirParaElModelo: async () => desbordado,
      });
      const sobres = sobresDe(vistos);
      expect(sobres.join("")).not.toContain("[Line 3:1]");
      expect(sobres.every((c) => c === "")).toBe(true);
    });

    it("CONTRA-PRUEBA: si la base estaba limpia, el defecto ES suyo y se le dice", async () => {
      const vistos: Message[][] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
        runTool: conBase,
        emit: () => {},
        medirParaElModelo: async (html) => (html === GEMELO_BASE ? {} : desbordado),
      });
      expect(sobresDe(vistos).join("")).toContain("[Line 3:1]");
    });

    it("🔴 la base NO se mide cuando la página salió bien — es el caso normal y no paga render", async () => {
      const medidos: string[] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: scripted(edita(), [{ type: "text_delta", text: "ok" }, done]),
        runTool: conBase,
        emit: () => {},
        medirParaElModelo: async (html) => {
          medidos.push(html);
          return {};
        },
      });
      expect(medidos).toEqual([GEMELO]);
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
          return { ...(await herramientaQueEdita()), updatedHtml: VISIBLE.replace(">x<", `>x${n}<`), htmlPrevio: BASE };
        },
        emit: () => {},
        medirParaElModelo: async (html) => {
          medidos.push(html);
          return html === GEMELO_BASE ? {} : desbordado;
        },
      });
      expect(medidos.filter((h) => h === GEMELO_BASE)).toHaveLength(1);
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
          return { ...(await herramientaQueEdita()), updatedHtml: VISIBLE.replace(">x<", `>x${n}<`), htmlPrevio: BASE };
        },
        emit: () => {},
        // La base no se puede medir NUNCA; lo guardado sí.
        medirParaElModelo: async (html) => {
          medidos.push(html);
          return html === GEMELO_BASE ? null : desbordado;
        },
      });
      expect(medidos.filter((h) => h === GEMELO_BASE)).toHaveLength(1);
    });

    it("🔴 cada fichero se resta contra SU base, no contra la de otra página", async () => {
      const vistos: Message[][] = [];
      const MENU_ANTES = '<html>\n<body>\n<div class="grid">menú viejo</div>\n</body>\n</html>';
      await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: mirando(
          vistos,
          scripted(
            [
              { type: "function_call", name: "Edit", args: { file_path: "/index.html" } },
              { type: "function_call", name: "Edit", args: { file_path: "/menu/index.html" } },
              done,
            ],
            [{ type: "text_delta", text: "ok" }, done],
          ),
        ),
        runTool: async (_n, a) =>
          a.file_path === "/menu/index.html"
            ? { ...(await herramientaQueEdita()), page: "menu", htmlPrevio: MENU_ANTES }
            : { ...(await herramientaQueEdita()), htmlPrevio: BASE },
        emit: () => {},
        // La Home venía limpia; /menu ya se desbordaba.
        medirParaElModelo: async (html) => (html === GEMELO_BASE ? {} : desbordado),
      });
      const sobre = sobresDe(vistos).join("");
      expect(sobre).toContain("/index.html:\n  ⚠ [Line 3:1]");
      expect(sobre).not.toContain("/menu/index.html:");
    });

    it("sin `htmlPrevio` no se sabe cómo estaba: lo medido se dice entero", async () => {
      const vistos: Message[][] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
        runTool: herramientaQueEdita,
        emit: () => {},
        medirParaElModelo: async () => desbordado,
      });
      expect(sobresDe(vistos).join("")).toContain("[Line 3:1]");
    });

    it("🔴 se pidió base y no se pudo medir ⇒ no se habla: sin base, «nuevo» no se puede saber", async () => {
      const vistos: Message[][] = [];
      await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: mirando(vistos, scripted(edita(), [{ type: "text_delta", text: "ok" }, done])),
        runTool: conBase,
        emit: () => {},
        medirParaElModelo: async (html) => (html === GEMELO_BASE ? null : desbordado),
      });
      expect(sobresDe(vistos).join("")).not.toContain("[Line 3:1]");
    });
  });

  // LO QUE DEJÓ LA ESCRITURA —un enlace que marca otro número, una red social
  // que nadie dio— viaja en el MISMO sobre que lo medido, y una sola vez.
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

// ─── EL RECUENTO DE COBERTURA EN LA TARJETA ──────────────────────────────────
//
// 🔴 MEDIDO en producción el 2026-09-20 (`proj=2d6cad43`, turno del 19/09): Len
// creó una página `viajes` y después retocó la Home. Los ojos verifican
// `lastMutation` —la ÚLTIMA página mutada— así que miraron la Home, y la página
// de viajes, que era el ENTREGABLE, no se miró nunca. La tarjeta decía «sin
// fallos medidos» y el usuario lo leyó como «se miró y está bien».
//
// Esto NO arregla la cobertura: sigue mirándose una sola página. Lo que prueba
// es que el turno lo DICE, que es la forma de Claude Code — su informe de
// `preview` abre siempre con `N of M captures`, antes de cualquier juicio.
describe("runAgentLoop — cuántas páginas se miraron", () => {
  const dosPaginasLuegoCierra = () =>
    scripted(
      [{ type: "function_call", name: "editar_pagina", args: { resumen: "viajes" } }, done],
      [{ type: "function_call", name: "editar_pagina", args: { resumen: "pie" } }, done],
      [{ type: "text_delta", text: "Listo." }, done],
    );

  function editaEn(paginas: (string | null)[]) {
    let i = 0;
    return async () => {
      const page = paginas[Math.min(i, paginas.length - 1)] ?? null;
      i += 1;
      return {
        response: { ok: true },
        updatedHtml: "<!doctype html><html><body>v" + i + "</body></html>",
        page,
      };
    };
  }

  // `Extract` y no un `&`: sumarle campos al UNION deja un tipo que sigue
  // pudiendo ser el evento de texto, y entonces `summary` no existe. Lo cazó
  // `tsc` con las pruebas ya en verde — vitest transpila sin comprobar tipos.
  type TarjetaAccion = Extract<AgentStreamEvent, { type: "action" }>;

  function tarjetaDeVerificacion(events: AgentStreamEvent[]): TarjetaAccion | undefined {
    return events.find(
      (e): e is TarjetaAccion =>
        e.type === "action" && e.tool === "verificar_diseno" && e.status !== "running",
    );
  }

  it("🔴 tocó dos páginas: los ojos reciben LAS DOS, y la tarjeta lo dice", async () => {
    const events: AgentStreamEvent[] = [];
    let visto: { page: string | null; otrasPaginas?: readonly { page: string | null }[] } | null =
      null;
    await runAgentLoop({
      messages: [{ role: "user", content: "haz una página de viajes" }], tools: [],
      openStream: dosPaginasLuegoCierra(),
      runTool: editaEn(["viajes", null]),
      verifyTurn: async (info) => {
        visto = info;
        return { estado: "bien" as const, conMedida: true };
      },
      emit: (e) => events.push(e),
    });
    // 🔴 LO QUE IMPORTA: la página de viajes LLEGA a los ojos. Antes del
    // 2026-09-20 sólo llegaba la última mutada —la Home— y el entregable no se
    // miraba nunca.
    expect(visto).not.toBeNull();
    expect(visto!.page).toBe(null); // la principal sigue siendo la última mutada
    expect(visto!.otrasPaginas?.map((p) => p.page)).toEqual(["viajes"]);
    const card = tarjetaDeVerificacion(events);
    expect(card!.paginasTocadas).toBe(2);
    expect(card!.paginasMiradas).toBe(2);
  });

  // EL TOPE, y que lo que deja fuera NO se calla. La tarjeta dice «4 de 5», que
  // es la disciplina del informe de `preview` de Claude Code: nunca
  // recortar en silencio.
  it("🔴 con más páginas que el tope, se miran las primeras y la tarjeta confiesa", async () => {
    const events: AgentStreamEvent[] = [];
    let visto: { otrasPaginas?: readonly { page: string | null }[] } | null = null;
    await runAgentLoop({
      messages: [{ role: "user", content: "monta el sitio entero" }], tools: [],
      openStream: scripted(
        // Argumentos DISTINTOS en cada vuelta: el bucle poda la llamada
        // repetida idéntica, así que cinco iguales no son cinco mutaciones.
        ...Array.from({ length: 5 }, (_, i) => [
          { type: "function_call" as const, name: "editar_pagina", args: { resumen: `p${i}` } },
          done,
        ]),
        [{ type: "text_delta", text: "Listo." }, done],
      ),
      runTool: editaEn(["a", "b", "c", "d", null]),
      verifyTurn: async (info) => {
        visto = info;
        return { estado: "bien" as const, conMedida: true };
      },
      emit: (e) => events.push(e),
    });
    const card = tarjetaDeVerificacion(events);
    expect(card!.paginasTocadas).toBe(5);
    expect(card!.paginasMiradas).toBe(4);
    // Y las que se miran son las que el turno tocó PRIMERO: el entregable se
    // crea al principio, el retoque del pie va al final.
    expect(visto!.otrasPaginas?.map((p) => p.page)).toEqual(["a", "b", "c"]);
  });

  it("una sola página: la tarjeta sale como salía, sin recuento", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el hero" }], tools: [],
      openStream: dosPaginasLuegoCierra(),
      runTool: editaEn([null]),
      verifyTurn: async () => ({ estado: "bien" as const, conMedida: true }),
      emit: (e) => events.push(e),
    });
    const card = tarjetaDeVerificacion(events);
    expect(card).toBeDefined();
    expect(card!.paginasTocadas).toBeUndefined();
    expect(card!.paginasMiradas).toBeUndefined();
  });

  // Si NADIE miró, «sin comprobar» ya lo dice entero: «0 de 2 páginas · sin
  // comprobar» es la misma frase dos veces.
  it("CONTRA-PRUEBA: cuando nadie miró, no se añade recuento", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "haz una página de viajes" }], tools: [],
      openStream: dosPaginasLuegoCierra(),
      runTool: editaEn(["viajes", null]),
      verifyTurn: async () => ({ estado: "no_mirado" as const, motivo: "Chrome no arrancó" }),
      emit: (e) => events.push(e),
    });
    const card = tarjetaDeVerificacion(events);
    expect(card!.summary).toBe("no-mirado");
    expect(card!.paginasTocadas).toBeUndefined();
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

  it("una edición nula no llega a los ojos: la página no cambió", async () => {
    let ojos = 0;
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(
        [{ type: "function_call", name: "editar_texto", args: { resumen: "teléfono" } }, done],
        [{ type: "text_delta", text: "No hacía falta: ya estaba." }, done],
      ),
      runTool: async () => nula,
      verifyTurn: async () => { ojos += 1; return { estado: "bien" as const }; },
      emit: () => {},
    });
    expect(ojos).toBe(0);
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

describe("H05 — un turno que topa dice que no se miró", () => {
  it("🔴 el cierre por tope sabe que la página no se comprobó", async () => {
    let recibido = "";
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxTurns: 1,
      openStream: scripted([{ type: "function_call", name: "editar_texto", args: { resumen: "a" } }, done]),
      runTool: async () => ({ response: { ok: true, cambio: "cambio" }, updatedHtml: "<p/>", page: null }),
      verifyTurn: async () => ({ estado: "bien" as const }),
      closeOut: (m) => {
        recibido = String(m.at(-1)?.content ?? "");
        return (async function* () { yield { type: "text_delta" as const, text: "Topé." }; })();
      },
      emit: () => {},
    });
    expect(recibido).toContain("HAS NOT BEEN CHECKED");
  });

  it("BRAZO DE CONTROL: sin ojos cableados, el tope no inventa una tarjeta", async () => {
    const events: AgentStreamEvent[] = [];
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [], maxTurns: 1,
      openStream: scripted([{ type: "function_call", name: "editar_texto", args: { resumen: "a" } }, done]),
      runTool: async () => ({ response: { ok: true, cambio: "cambio" }, updatedHtml: "<p/>", page: null }),
      closeOut: () => (async function* () { yield { type: "text_delta" as const, text: "Topé." }; })(),
      emit: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === "action" && e.tool === "verificar_diseno")).toBe(false);
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

describe("H04 — el cierre se redacta con lo medido delante", () => {
  const edita = [{ type: "function_call" as const, name: "editar_texto", args: { resumen: "titular" } }, done];
  const cierra = [{ type: "text_delta" as const, text: "Listo." }, done];
  const runTool = async () => ({ response: { ok: true, cambio: "cambio" }, updatedHtml: "<p>v2</p>", page: null });

  it("una promesa rota sola también le llega al modelo antes de hablar", async () => {
    let recibido = "";
    await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(edita, cierra),
      runTool,
      verifyTurn: async () => ({
        estado: "bien" as const,
        regresiones: [{ id: "p1", paso: 1, mensaje: "#total ya no cambia al pulsar #agregar" }],
      }),
      closeOut: (m) => {
        recibido = m.map((x) => (typeof x.content === "string" ? x.content : "")).join(" | ");
        return (async function* () { yield { type: "text_delta" as const, text: "Ojo: el total dejó de sumar." }; })();
      },
      emit: () => {},
    });
    expect(recibido).toContain("#total ya no cambia");
  });

  it("BRAZO DE CONTROL: una OBSERVACIÓN no gasta la segunda redacción", async () => {
    let redacciones = 0;
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "x" }], tools: [],
      openStream: scripted(edita, cierra),
      runTool,
      verifyTurn: async () => ({ estado: "observado" as const, notas: ["las tarjetas no tienen foto"] }),
      closeOut: () => {
        redacciones += 1;
        return (async function* () { yield { type: "text_delta" as const, text: "no debería" }; })();
      },
      emit: () => {},
    });
    expect(redacciones).toBe(0);
    expect(r.finalText).toBe("Listo.");
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

  it("G3 · al topar se mira la página, y la edición nula no llega como hecha", async () => {
    const events: AgentStreamEvent[] = [];
    let ojos = 0;
    let cierre = "";
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "teléfono, titular y otra" }], tools, maxTurns: 2,
      openStream: scripted(
        llama("editar_texto", { resumen: "teléfono en el pie" }),
        llama("editar_texto", { resumen: "titular" }),
        llama("editar_texto", { resumen: "otra" }),
      ),
      runTool: async (_n, a) => a.resumen === "teléfono en el pie" ? nula("teléfono en el pie") : real(String(a.resumen)),
      verifyTurn: async () => { ojos += 1; return { estado: "bien" as const }; },
      closeOut: (m) => {
        cierre = ultimoDelUsuario(m);
        return (async function* () { yield { type: "text_delta" as const, text: "Cambié el titular." }; })();
      },
      emit: (e) => events.push(e),
    });
    expect(r.topeAlcanzado).toBe("turn_limit");
    expect(cierre, "el cierre recibía la edición nula como «SÍ se aplicó»").not.toContain("«teléfono en el pie»");
    const mirada = events.find((e) => e.type === "action" && e.tool === "verificar_diseno" && e.status !== "running");
    expect(mirada, `un turno que topa no se miraba (ojos llamados = ${ojos})`).toBeDefined();
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

  it("G6 · el cierre se escribe con el veredicto de los ojos delante", async () => {
    const events: AgentStreamEvent[] = [];
    let recibido = "";
    const r = await runAgentLoop({
      messages: [{ role: "user", content: "pon el titular en blanco" }], tools,
      openStream: scripted(
        llama("editar_texto", { resumen: "titular" }),
        dice("Listo, quedó perfecto y se lee de maravilla."),
      ),
      runTool: async () => real("titular"),
      verifyTurn: async () => ({ estado: "roto" as const, critique: "- el titular (#fff sobre #fff) es ilegible a 1.00:1" }),
      closeOut: (m) => {
        recibido = m.map((x) => (typeof x.content === "string" ? x.content : "")).join("\n");
        return (async function* () {
          yield { type: "text_delta" as const, text: "Cambié el titular, pero quedó ilegible: blanco sobre blanco." };
        })();
      },
      emit: (e) => events.push(e),
    });
    expect(recibido, "el modelo nunca leía el veredicto antes de hablar").toContain("ilegible a 1.00:1");
    // H4 (2026-09-26): lo medido se DICE —decisión de Jesús del 04/09—, pero el
    // cierre ya no le pide al modelo que ofrezca arreglarlo: ofrecer trabajo que
    // nadie pidió es ensanchar el alcance («Delivering work» de Claude Code).
    expect(recibido).toContain("what problem the page has");
    expect(recibido).not.toMatch(/ofr[eé]cete/);
    const iVeredicto = events.findIndex((e) => e.type === "action" && e.tool === "verificar_diseno" && e.status === "warning");
    const iUltimoTexto = events.map((e) => e.type).lastIndexOf("text");
    expect(iVeredicto).toBeGreaterThanOrEqual(0);
    expect(iUltimoTexto, "lo último que redactó el modelo iba ANTES de los ojos").toBeGreaterThan(iVeredicto);
    expect(r.finalText, "el final era «perfecto» con la lista de defectos pegada debajo").not.toMatch(
      /perfecto[\s\S]*- el titular \(#fff sobre #fff\)/,
    );
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
      [pensado("busco la marca"), { type: "function_call", name: "activar_modulo", args: { modulo: "members" } }, usage(5), done],
      [pensado("ahora el pie"), { type: "function_call", name: "activar_modulo", args: { modulo: "bookings" } }, usage(5), done],
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
      [{ type: "function_call", name: "activar_modulo", args: { modulo: "members" } }, done],
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
        [pensado("SECRETO-PENSADO"), { type: "function_call", name: "activar_modulo", args: { modulo: "members" } }, done],
        [pensado("SECRETO-PENSADO"), { type: "text_delta", text: "Listo." }, done],
      ),
      runTool: async (name) => ({ response: { ok: true }, action: { tool: name, ok: true, summary: name } }),
      emit: (e) => eventos.push(e),
    });
    expect(JSON.stringify(eventos)).not.toContain("SECRETO-PENSADO");
  });
});

describe("F1 · las lecturas del principio de la vuelta, en paralelo detrás de la palanca de la terminal", () => {
  const vuelta = [
    { type: "function_call", name: "Read", args: { file_path: "/a" } },
    { type: "function_call", name: "Read", args: { file_path: "/b" } },
    { type: "function_call", name: "Edit", args: { file_path: "/c" } },
    { type: "function_call", name: "Read", args: { file_path: "/d" } },
    usage(10),
    done,
  ] as StreamEvent[];

  async function correr(palanca: string | undefined) {
    const antes = process.env.OPENLEN_TERMINAL;
    if (palanca === undefined) delete process.env.OPENLEN_TERMINAL;
    else process.env.OPENLEN_TERMINAL = palanca;
    const log: string[] = [];
    let enVuelo = 0;
    let maxEnVuelo = 0;
    let respuestas: string[] = [];
    const guion = scripted(vuelta, [{ type: "text_delta", text: "fin" }, usage(1), done]);
    try {
      await runAgentLoop({
        messages: [{ role: "user", content: "x" }],
        tools: [],
        openStream: (messages) => {
          const ultima = messages[messages.length - 1];
          if (ultima?.functionResponses) respuestas = ultima.functionResponses.map((f) => String(f.response.tool_result));
          return guion(messages);
        },
        runTool: async (name, a) => {
          enVuelo++;
          maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
          log.push(`empieza ${name} ${String(a.file_path)}`);
          await new Promise((r) => setTimeout(r, 20));
          enVuelo--;
          log.push(`acaba ${name} ${String(a.file_path)}`);
          return { response: { ok: true, tool_result: `${name} ${String(a.file_path)}` } };
        },
        emit: () => undefined,
      });
    } finally {
      if (antes === undefined) delete process.env.OPENLEN_TERMINAL;
      else process.env.OPENLEN_TERMINAL = antes;
    }
    return { log, maxEnVuelo, respuestas };
  }

  it("con la palanca: las dos lecturas del principio a la vez; el Edit y la lectura de detrás, en serie después; las respuestas, en el orden del modelo", async () => {
    const { log, maxEnVuelo, respuestas } = await correr("1");
    expect(maxEnVuelo).toBe(2);
    expect(log.slice(0, 2)).toEqual(["empieza Read /a", "empieza Read /b"]);
    expect(log.indexOf("empieza Edit /c")).toBeGreaterThan(log.indexOf("acaba Read /b"));
    expect(log.indexOf("empieza Read /d")).toBeGreaterThan(log.indexOf("acaba Edit /c"));
    expect(respuestas).toEqual(["Read /a", "Read /b", "Edit /c", "Read /d"]);
  });

  it("sin la palanca, todo en serie como hoy (brazo de control)", async () => {
    const { maxEnVuelo, respuestas } = await correr(undefined);
    expect(maxEnVuelo).toBe(1);
    expect(respuestas).toEqual(["Read /a", "Read /b", "Edit /c", "Read /d"]);
  });
});
