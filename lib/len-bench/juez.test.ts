// lib/len-bench/juez.test.ts — el juez con un modelo de mentira: $0.
import { describe, expect, it, vi } from "vitest";
import { PRESUPUESTO_DE_RESULTADOS, RESULTADO_VACIADO, type MensajeDelHistorial } from "@/lib/agent/transcripcion";
import type { ContextoDeCalificacion } from "./tipos";
import { createJudgeCall, gastoDelJuez, judgeIdentity, judgeVerdict, juez, pedidosYPagina, promptDelJuez, textoDelFoco, trazaDeLasFilas, VOTOS_DEL_JUEZ, votoDe } from "./juez";

// LA CALIBRACIÓN (spec §9 fila 7): el juez se compara con las etiquetas FUERA de una corrida, y tiene que ser el
// mismo juez — el mismo prompt, los mismos tres votos, la misma mayoría — que el del banco.
describe("judgeVerdict — el juez del banco, fuera de una corrida", () => {
  it("pregunta tres veces con el prompt del banco, gana la mayoría y suma lo que costó", async () => {
    const vistos: string[] = [];
    const llamar = async (_s: string, u: string) => {
      vistos.push(u);
      return { texto: vistos.length === 2 ? "FAIL" : "PASS", usd: 0.001 };
    };
    const r = await judgeVerdict("Cada cosa pedida está hecha.", "pedidos_y_pagina", "1. haz mi página", llamar);
    expect(r.paso).toBe(true);
    expect(r.votos).toEqual([true, false, true]);
    expect(r.usd).toBeCloseTo(0.003, 12);
    expect(vistos).toEqual(Array(VOTOS_DEL_JUEZ).fill(promptDelJuez("Cada cosa pedida está hecha.", "pedidos_y_pagina", "1. haz mi página")));
  });
});

// EL FOCO DE LA BATERÍA 1 (plan local 2026-11-15, tarea 9): lo que pidió el dueño, numerado, y lo que se lee en
// la página publicada. Pequeño a propósito («un criterio con juez por caso como mucho, con foco pequeño», spec §5).
describe("pedidosYPagina — lo que ve el juez de la batería de clientes", () => {
  // The page arrives already PAINTED (innerText, graders.browser.test.ts covers that what a script builds is there).
  it("los mensajes del dueño, numerados, y el texto pintado de lo publicado, sin líneas vacías de más", () => {
    const t = pedidosYPagina(
      [
        { quien: "dueno", texto: "haz mi página" },
        { quien: "len", texto: "Listo." },
        { quien: "dueno", texto: "ponle el horario" },
      ],
      "Mi   taller\n\n\n  \nAbierto de 9 a 6",
    );
    expect(t).toContain("1. haz mi página");
    expect(t).toContain("2. ponle el horario");
    expect(t).not.toContain("Listo.");
    expect(t).toMatch(/El texto visible de la página publicada:\nMi taller\nAbierto de 9 a 6$/);
  });
});
import { PROVIDER_DIALECTS } from "@/lib/ai/providers";
import { rateFor, usdDeTurno } from "@/lib/ai/tarifas-eval";
import { MODEL_POLICY } from "@/lib/generation/model-policy";
import type { createFireworksStreamClient } from "@/lib/ai/fireworks-stream-client";

// EL JUEZ EN DEEPINFRA, DE OTRA FAMILIA (Jesús, 15/11: Qwen3.8-Flash, luego Qwen3.8-27B; tras la calibración, GLM-5.3). Un cliente de mentira recoge lo que se
// le pide: se comprueba la petición, no al proveedor (eso lo hace `npm run modelos:comprobar`).
describe("createJudgeCall — a quién y cómo se le pregunta", () => {
  type Opciones = Parameters<typeof createFireworksStreamClient>[0];
  function clienteDeMentira(usage = { inputTokens: 12_000, cachedTokens: 8_000, outputTokens: 1 }) {
    const vistos: { opciones: Opciones; peticiones: { requestId: string; operation: string; maxOutputTokens?: number; temperature?: number }[] } = { opciones: {}, peticiones: [] };
    const makeClient = ((opciones: Opciones) => {
      vistos.opciones = opciones;
      return {
        modelId: "x",
        async *stream(request: { requestId: string; operation: string; maxOutputTokens?: number; temperature?: number }) {
          vistos.peticiones.push(request);
          yield { type: "text_delta", text: "PASS" };
          yield { type: "usage", ...usage, thinkingTokens: 0 };
          yield { type: "done", stopReason: { kind: "stop" } };
        },
      };
    }) as unknown as typeof createFireworksStreamClient;
    return { vistos, makeClient };
  }

  it("llama a DeepInfra con el modelo de su papel y su clave, 16 tokens, temperatura 1", async () => {
    const { vistos, makeClient } = clienteDeMentira();
    const r = await createJudgeCall({ makeClient, env: { DEEPINFRA_API_KEY: "clave" } })("sistema", "prompt");
    expect(r.texto).toBe("PASS");
    expect(vistos.opciones).toMatchObject({
      apiKey: "clave",
      endpoint: PROVIDER_DIALECTS.deepinfra.endpoint,
      modelId: MODEL_POLICY.judge.providers[0]!.modelId,
      affinityField: PROVIDER_DIALECTS.deepinfra.affinityField,
      effortStyle: PROVIDER_DIALECTS.deepinfra.effortStyle,
    });
    expect(vistos.peticiones[0]).toMatchObject({ operation: "len_bench_juez", maxOutputTokens: 16, temperature: 1 });
  });

  it("los tres votos de un mismo prompt llevan la misma clave de caché; otro prompt, otra", async () => {
    const { vistos, makeClient } = clienteDeMentira();
    const llamar = createJudgeCall({ makeClient, env: { DEEPINFRA_API_KEY: "clave" } });
    await llamar("s", "el mismo");
    await llamar("s", "el mismo");
    await llamar("s", "otro");
    const [a, b, c] = vistos.peticiones.map((p) => p.requestId);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("cuesta lo que dice su tarifa, con lo leído de caché a precio de caché", async () => {
    const { makeClient } = clienteDeMentira({ inputTokens: 12_000, cachedTokens: 8_000, outputTokens: 1 });
    const r = await createJudgeCall({ makeClient, env: { DEEPINFRA_API_KEY: "clave" } })("s", "p");
    expect(r.usd).toBeCloseTo(usdDeTurno({ entrada: 12_000, cacheada: 8_000, salida: 1 }, rateFor(MODEL_POLICY.judge.modelId)), 12);
  });

  it("sin clave de DeepInfra lo dice, y no cae a Fireworks", async () => {
    const { vistos, makeClient } = clienteDeMentira();
    await expect(createJudgeCall({ makeClient, env: {} })("s", "p")).rejects.toThrow(/DEEPINFRA_API_KEY/);
    expect(vistos.peticiones).toHaveLength(0);
  });
});

describe("what the evaluator's fingerprint reads from the judge (evaluator-fingerprint.ts)", () => {
  it("a judge grader says its criterion and its focus; a deterministic one says neither", () => {
    const g = juez({ nombre: "cumple", criterio: "Cada cosa pedida está hecha.", foco: "traza" }, async () => ({ texto: "PASS", usd: 0 }));
    expect(g.criterio).toBe("Cada cosa pedida está hecha.");
    expect(g.foco).toBe("traza");
    expect(juez({ nombre: "x", criterio: "c" }, async () => ({ texto: "PASS", usd: 0 })).foco).toBe("ultimo_mensaje");
  });
  it("the judge's identity is its model, the prompt it is asked with and its votes", () => {
    const id = judgeIdentity();
    expect(id.votes).toBe(VOTOS_DEL_JUEZ);
    expect(id.model.length).toBeGreaterThan(0);
    expect(id.prompt).toContain("PASS o FAIL");
  });
});

const ctx = (len: string[], dueno = "¿cómo van las visitas?") =>
  ({
    conversacion: len.flatMap((t) => [
      { quien: "dueno" as const, texto: dueno },
      { quien: "len" as const, texto: t },
    ]),
  }) as unknown as ContextoDeCalificacion;

/** Un turno tal y como lo vio el modelo: lo que la herramienta devolvió va dentro. */
const TRAZA: MensajeDelHistorial[] = [
  { role: "user", content: "¿cómo van las visitas?" },
  { role: "assistant", content: "", functionCalls: [{ name: "get_visits", args: {} }] },
  {
    role: "user",
    content: "",
    functionResponses: [{ name: "get_visits", response: { ok: true, today: 3, published_note: "Estas son de cuando estuvo publicada." } }],
  },
  { role: "assistant", content: "Hoy llevas 3. Son de cuando estuvo publicada." },
];

/** Un modelo que contesta, en orden, lo que se le da. */
const responde = (...r: string[]) => {
  let i = 0;
  return vi.fn(async () => ({ texto: r[i++ % r.length]!, usd: 0.001 }));
};

describe("votoDe — una palabra, como el suyo", () => {
  it("PASS es PASS; FAIL, o PASS y FAIL juntos, no", () => {
    expect(votoDe("PASS")).toBe(true);
    expect(votoDe(" pass.")).toBe(true);
    expect(votoDe("FAIL")).toBe(false);
    expect(votoDe("PASS... no, FAIL")).toBe(false);
    expect(votoDe("no sé")).toBe(false);
  });
});

describe("juez", () => {
  const CRITERIO = "No inventa de dónde salen los números.";

  it("vota TRES veces y gana la mayoría, y lo explica con los votos", async () => {
    const llamar = responde("PASS", "FAIL", "PASS");
    const r = await juez({ nombre: "sin-suposiciones", criterio: CRITERIO }, llamar).calificar(ctx(["Hoy llevas 3 visitas."]));
    expect(llamar).toHaveBeenCalledTimes(VOTOS_DEL_JUEZ);
    expect(r).toMatchObject({ paso: true, explicacion: "votos del juez: PASS FAIL PASS", votos: [true, false, true] });
  });

  it("dos FAIL de tres suspenden", async () => {
    const r = await juez({ nombre: "x", criterio: CRITERIO }, responde("FAIL", "PASS", "FAIL")).calificar(ctx(["algo"]));
    expect(r.paso).toBe(false);
  });

  it("sin mensaje de Len no hay nada que juzgar, y no se paga", async () => {
    const llamar = responde("PASS");
    const r = await juez({ nombre: "x", criterio: CRITERIO }, llamar).calificar({ conversacion: [{ quien: "dueno", texto: "hola" }] } as unknown as ContextoDeCalificacion);
    expect(llamar).not.toHaveBeenCalled();
    expect(r.paso).toBe(false);
  });

  it("el gasto se cuenta APARTE", async () => {
    const antes = gastoDelJuez();
    await juez({ nombre: "x", criterio: CRITERIO }, responde("PASS")).calificar(ctx(["algo"]));
    expect(gastoDelJuez() - antes).toBeCloseTo(0.003, 6);
  });

  it("no avisa de entradas largas: el suyo sólo lo hace cuando juzga un fichero, y aquí no hay ese foco", async () => {
    const r = await juez({ nombre: "x", criterio: CRITERIO }, responde("PASS")).calificar(ctx(["a".repeat(20_000)]));
    expect(r.explicacion).toBe("votos del juez: PASS PASS PASS");
  });

  it("guarda lo que vio el juez (su `evidence`): sin eso, la traza de una corrida no se puede volver a leer", async () => {
    const r = await juez({ nombre: "x", criterio: CRITERIO, foco: "traza" }, responde("PASS")).calificar({ traza: TRAZA } as unknown as ContextoDeCalificacion);
    expect(r.evidencia).toBe(TRAZA.map((m) => JSON.stringify(m)).join("\n"));
  });

  it("es de pago, y se estrena sin votar si el caso lo dice", () => {
    const g = juez({ nombre: "x", criterio: CRITERIO, puntua: false }, responde("PASS"));
    expect(g.pago).toBe(true);
    expect(g.puntua).toBe(false);
    expect(juez({ nombre: "y", criterio: CRITERIO }, responde("PASS")).puntua).toBeUndefined();
  });
});

describe("lo que ve el juez", () => {
  it("por defecto, el ÚLTIMO mensaje de Len (su `last_message`)", () => {
    expect(textoDelFoco(ctx(["primero", "último"]), "ultimo_mensaje")).toBe("último");
  });
  it("con foco «traza», el turno entero como lo vio el modelo, CON lo que devolvieron las herramientas: una línea JSON por mensaje, como su `trace`", () => {
    const t = textoDelFoco({ traza: TRAZA } as unknown as ContextoDeCalificacion, "traza");
    expect(t).toBe(TRAZA.map((m) => JSON.stringify(m)).join("\n"));
    expect(t).toContain('"published_note":"Estas son de cuando estuvo publicada."');
  });

  it("sin traza no hay nada que juzgar, y no se paga", async () => {
    const llamar = responde("PASS");
    const r = await juez({ nombre: "x", criterio: "y", foco: "traza" }, llamar).calificar({ traza: [] } as unknown as ContextoDeCalificacion);
    expect(llamar).not.toHaveBeenCalled();
    expect(r).toEqual({ paso: false, explicacion: "no hubo traza de Len que juzgar" });
  });
  it("el prompt lleva el criterio, el texto y la orden de una palabra", () => {
    const p = promptDelJuez("No inventa.", "ultimo_mensaje", "Hoy 3.");
    expect(p).toContain("Criterio:\nNo inventa.");
    expect(p).toContain("Salida del agente (último mensaje):\nHoy 3.");
    expect(p.endsWith("Responde con exactamente una palabra: PASS o FAIL.")).toBe(true);
  });

  it("una traza de más de 24 mensajes: los 12 primeros y los 12 últimos, y lo dice, como la suya", () => {
    const larga: MensajeDelHistorial[] = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
    const lineas = textoDelFoco({ traza: larga } as unknown as ContextoDeCalificacion, "traza").split("\n");
    expect(lineas).toHaveLength(25);
    expect(lineas[0]).toBe(JSON.stringify(larga[0]));
    expect(lineas[12]).toBe("[…6 mensajes omitidos…]");
    expect(lineas[24]).toBe(JSON.stringify(larga[29]));
  });

  it("le enseña hasta 100.000 caracteres: los 80.000 primeros y los 20.000 últimos", () => {
    const texto = `${"a".repeat(80_000)}${"b".repeat(5_000)}${"c".repeat(20_000)}`;
    const p = promptDelJuez("x", "traza", texto);
    expect(p).toContain(`${"a".repeat(80_000)}\n[…5000 caracteres omitidos…]\n${"c".repeat(20_000)}`);
    expect(p).not.toContain("bb");
    // Hasta el tope, entero.
    expect(promptDelJuez("x", "traza", "a".repeat(100_000))).toContain("a".repeat(100_000));
  });
});

describe("trazaDeLasFilas — la traza sale de las filas que escribió el servidor", () => {
  it("el pedido del dueño y todo lo del turno, en orden", () => {
    const traza = trazaDeLasFilas([
      { userText: "¿cómo van las visitas?", assistantReasoning: "Hoy llevas 3.", transcript: { mensajes: TRAZA.slice(1), leidos: [] } },
    ]);
    // El pedido del dueño lleva la marca de que abrió el turno (N39, `opensTurn`).
    expect(traza).toEqual([{ ...TRAZA[0]!, opensTurn: true }, ...TRAZA.slice(1)]);
  });

  // THE COLD RETURN: a turn that started cold left its mark on its row; the judge still sees what happened.
  it("a row marked by a cold return does not hide earlier results or reasoning from the judge", () => {
    const reads = Array.from({ length: 30 }, (_, k) => [
      { role: "assistant" as const, content: "", functionCalls: [{ name: "Read", args: { file_path: "/src/f" + k + ".ts" } }] },
      { role: "user" as const, content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "x".repeat(7_000) } }] },
    ]).flat();
    const traza = trazaDeLasFilas([
      { userText: "lee todo", assistantReasoning: "", transcript: { mensajes: [...reads, { role: "assistant", content: "leído", reasoning: "pensado" }], leidos: [] } },
      { userText: "sigue", assistantReasoning: "", transcript: { mensajes: [{ role: "assistant", content: "hecho" }], leidos: [] } },
      { userText: "y ahora", assistantReasoning: "", transcript: { mensajes: [{ role: "assistant", content: "listo" }], leidos: [], coldTrim: { v: 1, keepResults: 12, clearAtLeastTokens: 20_000 } } },
    ]);
    expect(traza.flatMap((m) => m.functionResponses ?? []).every((r) => r.response.tool_result === "x".repeat(7_000))).toBe(true);
    expect(traza.some((m) => m.reasoning === "pensado")).toBe(true);
  });

  it("una fila de antes del 2026-10-06 llega al juez con el nombre de hoy", () => {
    const vieja = TRAZA.slice(1).map((m) => ({
      ...m,
      ...(m.functionCalls ? { functionCalls: m.functionCalls.map((c) => ({ ...c, name: "ver_visitas" })) } : {}),
      ...(m.functionResponses ? { functionResponses: m.functionResponses.map((r) => ({ ...r, name: "ver_visitas" })) } : {}),
    }));
    const traza = trazaDeLasFilas([
      { userText: "¿cómo van las visitas?", assistantReasoning: "Hoy llevas 3.", transcript: { mensajes: vieja, leidos: [] } },
    ]);
    expect(traza).toEqual([{ ...TRAZA[0]!, opensTurn: true }, ...TRAZA.slice(1)]);
  });

  it("🔴 nada se vacía: el historial del turno siguiente vacía lo viejo por presupuesto, la traza del juez no", () => {
    const grande = "x".repeat(PRESUPUESTO_DE_RESULTADOS.hasta + 1);
    const traza = trazaDeLasFilas([
      {
        userText: "lee la página",
        assistantReasoning: "",
        transcript: {
          mensajes: [
            { role: "assistant", content: "", functionCalls: [{ name: "Read", args: { file_path: "/index.html" } }] },
            { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, texto: grande } }] },
          ],
          leidos: [],
        },
      },
    ]);
    expect(JSON.stringify(traza)).toContain(grande);
    expect(JSON.stringify(traza)).not.toContain(RESULTADO_VACIADO);
  });

  it("una fila sin transcripción (un servidor anterior a H4) da sólo el texto de Len, como el historial", () => {
    expect(trazaDeLasFilas([{ userText: "hola", assistantReasoning: "Hola, ¿qué hacemos?", transcript: null }])).toEqual([
      { role: "user", content: "hola", opensTurn: true },
      { role: "assistant", content: "Hola, ¿qué hacemos?" },
    ]);
  });
});
