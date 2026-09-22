import { describe, expect, it, vi } from "vitest";

import { createFireworksStreamClient, type FireworksStreamEvent } from "./fireworks-stream-client";
import { NIVEL_POR_DEFECTO, presupuestoDeEsfuerzo } from "@/lib/agent/esfuerzo";
import { olvidarModelosSinEsfuerzo } from "./esfuerzo-no-admitido";

const REQUEST = {
  messages: [{ role: "system" as const, content: "eres un editor" }, { role: "user" as const, content: "haz el hero azul" }],
  maxOutputTokens: 4096,
  temperature: 0.8,
  requestId: "project-1",
  operation: "page_edit" as const,
};

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`;
const usageChunk = (input: number, output: number, reasoning = 0) =>
  `data: ${JSON.stringify({
    choices: [],
    usage: {
      prompt_tokens: input, completion_tokens: output, total_tokens: input + output,
      completion_tokens_details: { reasoning_tokens: reasoning },
    },
  })}\n\n`;

function client(body: string, init: ResponseInit = {}) {
  const fetchImpl = vi.fn(async () => new Response(body, { status: 200, ...init }));
  return {
    fetchImpl,
    client: createFireworksStreamClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch }),
  };
}

async function drain(events: AsyncIterableIterator<FireworksStreamEvent>): Promise<FireworksStreamEvent[]> {
  const out: FireworksStreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("transporte de texto en streaming", () => {
  it("cede cada trozo en vez de esperar el turno entero", async () => {
    const { client: c } = client(
      chunk({ content: "pensando…" }) + chunk({ content: "---HTML---" }) + chunk({ content: "<edits>" }, "stop")
      + usageChunk(100, 20) + "data: [DONE]\n\n",
    );
    const events = await drain(c.stream(REQUEST));
    expect(events.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text))
      .toEqual(["pensando…", "---HTML---", "<edits>"]);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: { kind: "end_turn" } });
  });

  it("separa el pensamiento del modelo de su respuesta", async () => {
    const { client: c } = client(
      chunk({ reasoning_content: "el hero usa --accent" }) + chunk({ content: "<edits>" }, "stop") + "data: [DONE]\n\n",
    );
    const events = await drain(c.stream(REQUEST));
    expect(events[0]).toEqual({ type: "reasoning_delta", text: "el hero usa --accent" });
    expect(events[1]).toEqual({ type: "text_delta", text: "<edits>" });
  });

  it("reporta el gasto que el proveedor midió", async () => {
    const { client: c } = client(chunk({ content: "x" }, "stop") + usageChunk(1000, 300, 120) + "data: [DONE]\n\n");
    const events = await drain(c.stream(REQUEST));
    expect(events).toContainEqual({ type: "usage", inputTokens: 1000, outputTokens: 300, cachedTokens: 0, thinkingTokens: 120 });
  });

  it("distingue una respuesta truncada de una completa", async () => {
    const { client: c } = client(chunk({ content: "<!doctype html>" }, "length") + "data: [DONE]\n\n");
    const events = await drain(c.stream(REQUEST));
    expect(events.at(-1)).toEqual({ type: "done", stopReason: { kind: "max_tokens" } });
  });

  it("un stream que nunca dijo por qué terminó NO terminó", async () => {
    // Decir que sí entrega media página como si estuviera completa.
    const { client: c } = client(chunk({ content: "<!doctype html><html>" }));
    const events = await drain(c.stream(REQUEST));
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: { kind: "error" } });
  });

  it("conserva la razón real cuando el proveedor rechaza la petición", async () => {
    const fetchImpl = vi.fn(async () => new Response("model not found", { status: 404 }));
    const c = createFireworksStreamClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    const events = await drain(c.stream(REQUEST));
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: { kind: "error", error: expect.stringContaining("model not found") } });
  });

  it("sin clave no llama a nadie", async () => {
    const fetchImpl = vi.fn();
    const c = createFireworksStreamClient({ apiKey: "  ", env: {}, fetchImpl: fetchImpl as unknown as typeof fetch });
    const events = await drain(c.stream(REQUEST));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "done", stopReason: { kind: "error", error: "missing_key" } }]);
  });

  it("el modelo y el esfuerzo salen de la política, no de quien llama", async () => {
    const { client: c, fetchImpl } = client(chunk({ content: "x" }, "stop"));
    await drain(c.stream(REQUEST));
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.model).toContain("deepseek");
    expect(body.reasoning_effort).toBe("none");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(4096);
    // La petición no puede nombrar un modelo: si pudiera, la tabla dejaría de
    // ser el único sitio donde se cambia de proveedor.
    expect(Object.keys(REQUEST)).not.toContain("model");
  });

  it("arma las llamadas a herramienta partidas en trozos", async () => {
    // Llegan por índice, no por orden de llegada, y los argumentos de a pocos
    // caracteres: leerlos ingenuamente parte el JSON a la mitad.
    const { client: c } = client(
      chunk({ content: "Voy a activar reservas." })
      + chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "activar_modulo", arguments: '{"mod' } }] })
      + chunk({ tool_calls: [{ index: 0, function: { arguments: 'ulo":"bookings"}' } }] }, "tool_calls"),
    );
    const events = await drain(c.stream({ ...REQUEST, tools: [{ type: "function", function: { name: "activar_modulo" } }] }));
    // El texto sale EN VIVO y la llamada al cerrar el turno: el Agente narra y
    // luego actúa, que es lo que lo hace sentir vivo.
    expect(events[0]).toEqual({ type: "text_delta", text: "Voy a activar reservas." });
    expect(events[1]).toEqual({ type: "function_call", name: "activar_modulo", args: { modulo: "bookings" } });
    expect(events.at(-1)).toEqual({ type: "done", stopReason: { kind: "end_turn" } });
  });

  it("conserva el orden de varias llamadas en un turno", async () => {
    const { client: c } = client(
      chunk({ tool_calls: [{ index: 1, id: "b", function: { name: "publicar", arguments: "{}" } }] })
      + chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "leer_estado", arguments: "{}" } }] }, "tool_calls"),
    );
    const events = await drain(c.stream(REQUEST));
    expect(events.filter((e) => e.type === "function_call").map((e) => (e as { name: string }).name))
      .toEqual(["leer_estado", "publicar"]);
  });

  it("no ejecuta a medias una llamada cuyos argumentos no son JSON", async () => {
    const { client: c } = client(
      chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "editar_pagina", arguments: '{"edits":' } }] }, "tool_calls"),
    );
    const events = await drain(c.stream(REQUEST));
    expect(events.some((e) => e.type === "function_call")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: { kind: "error" } });
  });

  it("manda las herramientas y los turnos de herramienta en el formato del cable", async () => {
    const { client: c, fetchImpl } = client(chunk({ content: "ok" }, "stop"));
    await drain(c.stream({
      ...REQUEST,
      tools: [{ type: "function", function: { name: "leer_estado" } }],
      messages: [
        { role: "user", content: "activa reservas" },
        { role: "assistant", content: "", toolCalls: [{ id: "a", name: "leer_estado", argumentsJson: "{}" }] },
        { role: "tool", content: '{"ok":true}', toolCallId: "a" },
      ],
    }));
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.tool_choice).toBe("auto");
    expect(body.messages[1]).toMatchObject({ role: "assistant", tool_calls: [{ id: "a", type: "function", function: { name: "leer_estado", arguments: "{}" } }] });
    expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "a", content: '{"ok":true}' });
  });

  // 🔴 ESTA PRUEBA AFIRMABA LO CONTRARIO hasta el 2026-09-11 («`auto` NO manda
  // reasoning_effort — el campo no viaja»). No se relajó para que pasara: la
  // regla se invirtió al leer bien Claude Code. Lo que allí se omite es el
  // PRESUPUESTO de pensamiento, y lo decide el MODELO; el NIVEL que elige la
  // persona se resuelve (al defecto del modelo, o `high`) y se manda.
  // Medido, además: omitirlo daba 237 tokens de razonamiento con rango 495.
  it("`auto` SÍ manda reasoning_effort: el número del nivel al que resuelve", async () => {
    const { client: c, fetchImpl } = client(chunk({ content: "x" }, "stop"));
    await drain(c.stream({ ...REQUEST, operation: "agent_turn", esfuerzo: "auto" }));
    const enviado = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(typeof enviado.reasoning_effort).toBe("number");
    expect(enviado.reasoning_effort).toBe(
      presupuestoDeEsfuerzo(NIVEL_POR_DEFECTO, REQUEST.maxOutputTokens),
    );
  });

  it("un nivel explícito manda un NÚMERO, no el nombre", async () => {
    const { client: c, fetchImpl } = client(chunk({ content: "x" }, "stop"));
    await drain(c.stream({ ...REQUEST, operation: "agent_turn", esfuerzo: "medium" }));
    const enviado = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(typeof enviado.reasoning_effort).toBe("number");
    expect(enviado.reasoning_effort).toBe(60);
  });

  // 🔴 LA PUERTA DEL PAPEL QUE NO PIENSA. Con `auto` resolviendo a un número,
  // caer a `auto` cuando `esfuerzoDisponible` dice que no encendería el
  // pensamiento justo al modelo que declaró no tenerlo. `null` es «sin
  // postura», y tiene que salir `"none"` — apagado A PROPÓSITO. Omitir el campo
  // tampoco valdría: sin él el proveedor piensa por su cuenta (medido, 237).
  it("`null` NO es `auto`: manda \"none\", ni número ni campo ausente", async () => {
    const { client: c, fetchImpl } = client(chunk({ content: "x" }, "stop"));
    await drain(c.stream({ ...REQUEST, operation: "agent_turn", esfuerzo: null }));
    const enviado = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(enviado).toHaveProperty("reasoning_effort");
    expect(enviado.reasoning_effort).toBe("none");
  });

  // BRAZO DE CONTROL de la de arriba: que `auto` mande número no puede
  // significar que mande CUALQUIER número. Si el defecto se moviera al tope de
  // la escalera, subir de nivel dejaría de significar nada — que es el bug de
  // la etiqueta falsa que todo esto vino a arreglar.
  it("`auto` NO manda el máximo: quedan niveles por encima", async () => {
    const { client: c, fetchImpl } = client(chunk({ content: "x" }, "stop"));
    await drain(c.stream({ ...REQUEST, operation: "agent_turn", esfuerzo: "auto" }));
    const conAuto = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    ).reasoning_effort;
    expect(conAuto).toBeLessThan(presupuestoDeEsfuerzo("max", REQUEST.maxOutputTokens));
  });

  // EL BRAZO DE CONTROL de las dos pruebas de arriba: sin él, un futuro
  // refactor que vuelva incondicional el reemplazo por operación (R5) pasaría
  // en verde. `REQUEST.operation` es "page_edit" SIN postura, así que debe
  // seguir leyendo la tabla y mandando la CADENA.
  //
  // ⚠️ Desde el 2026-09-12 lo que decide NO es la operación, es si el turno
  // TRAE postura. Esta prueba sigue siendo válida y sigue siendo el control —
  // lo que agarra ahora es que la AUSENCIA de postura no se confunda con una.
  it("`page_edit` SIN postura sigue mandando la cadena \"none\" — no un número", async () => {
    const { client: c, fetchImpl } = client(chunk({ content: "x" }, "stop"));
    await drain(c.stream(REQUEST));
    const enviado = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(enviado.reasoning_effort).toBe("none");
    expect(typeof enviado.reasoning_effort).not.toBe("number");
  });

  // 🔴 EL ENSANCHE, Y SU RAZÓN DE SER. Antes de esto la postura sólo la miraba
  // `agent_turn`: a Crear se le podía pasar un esfuerzo y el cable lo IGNORABA,
  // mandando igualmente el `"none"` de la tabla. O sea que el experimento de
  // «¿le compra algo pensar a Crear?» no se podía ni plantear — y el que se
  // planteó en su día usó un NOMBRE (`high`), que sobre este modelo no ordena:
  // `high` da 22 tokens de razonamiento y `low` da 145.
  //
  // Es la forma de Claude Code: una sola postura, `nombre | entero`,
  // que cada ámbito puede anular. Aquí el nombre lo resuelve a número.
  it("`page_edit` CON postura manda el número — la postura no es sólo del Agente", async () => {
    const { client: c, fetchImpl } = client(chunk({ content: "x" }, "stop"));
    await drain(c.stream({ ...REQUEST, esfuerzo: "medium" }));
    const enviado = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(typeof enviado.reasoning_effort).toBe("number");
    expect(enviado.reasoning_effort).toBe(
      presupuestoDeEsfuerzo("medium", REQUEST.maxOutputTokens),
    );
  });

  // Y `null` sigue significando lo mismo fuera del Agente: NO es `auto`, es
  // «este turno no piensa». Sin esta prueba, ensanchar la condición podría
  // haber hecho que una superficie nueva mandara el número del defecto.
  it("`page_edit` con postura `null` manda \"none\", no el número de `auto`", async () => {
    const { client: c, fetchImpl } = client(chunk({ content: "x" }, "stop"));
    await drain(c.stream({ ...REQUEST, esfuerzo: null }));
    const enviado = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(enviado.reasoning_effort).toBe("none");
  });

  it("no inventa un final cuando el transporte se cae", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("socket hang up"); });
    const c = createFireworksStreamClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    const events = await drain(c.stream(REQUEST));
    expect(events).toEqual([{ type: "done", stopReason: { kind: "error", error: "socket hang up" } }]);
  });
});

describe("varias imágenes en un turno", () => {
  const IMG = (n: string) => ({ mimeType: "image/jpeg", dataBase64: n });
  const cuerpoDe = (fetchImpl: { mock: { calls: unknown[] } }) =>
    JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
  const bloques = (fetchImpl: { mock: { calls: unknown[] } }) => {
    const cuerpo = cuerpoDe(fetchImpl) as { messages: { role: string; content: unknown }[] };
    const ultimo = cuerpo.messages.filter((m) => m.role === "user").pop();
    return ultimo?.content as { type: string; text?: string }[];
  };

  it("etiqueta cada imagen cuando son varias — el patrón que documenta Anthropic", async () => {
    const { client: c, fetchImpl } = client(chunk({ content: "ok" }, "stop"));
    await drain(c.stream({ ...REQUEST, images: [IMG("a"), IMG("b"), IMG("c")] }));

    // texto del usuario, «Imagen 1:», img, «Imagen 2:», img, «Imagen 3:», img
    expect(bloques(fetchImpl).map((b) => b.type)).toEqual([
      "text", "text", "image_url", "text", "image_url", "text", "image_url",
    ]);
    expect(bloques(fetchImpl).filter((b) => b.type === "text").map((b) => b.text)).toEqual([
      "haz el hero azul", "Imagen 1:", "Imagen 2:", "Imagen 3:",
    ]);
  });

  it("cada etiqueta va DELANTE de su imagen, no detrás", async () => {
    // El orden es lo único que convierte la etiqueta en un nombre. Detrás, el
    // modelo lee «imagen, Imagen 1:» y la etiqueta nombra a la SIGUIENTE.
    const { client: c, fetchImpl } = client(chunk({ content: "ok" }, "stop"));
    await drain(c.stream({ ...REQUEST, images: [IMG("primera"), IMG("segunda")] }));

    const lista = bloques(fetchImpl) as { type: string; text?: string; image_url?: { url: string } }[];
    const i = lista.findIndex((b) => b.text === "Imagen 2:");
    expect(lista[i + 1].image_url?.url).toContain("segunda");
  });

  it("con UNA sola imagen el cable no cambia: sin etiqueta", async () => {
    // El camino de una imagen es el único medido. Una etiqueta de más ahí sería
    // un cambio de comportamiento sin medir a cambio de nada.
    const { client: c, fetchImpl } = client(chunk({ content: "ok" }, "stop"));
    await drain(c.stream({ ...REQUEST, images: [IMG("sola")] }));

    expect(bloques(fetchImpl).map((b) => b.type)).toEqual(["text", "image_url"]);
  });

  it("sin imágenes el contenido sigue siendo una cadena, no una lista", async () => {
    const { client: c, fetchImpl } = client(chunk({ content: "ok" }, "stop"));
    await drain(c.stream({ ...REQUEST }));

    const cuerpo = cuerpoDe(fetchImpl) as { messages: { role: string; content: unknown }[] };
    expect(cuerpo.messages.filter((m) => m.role === "user").pop()?.content).toBe("haz el hero azul");
  });
});

// ─── LA DEGRADACION SILENCIOSA ──────────────────────────────────────────────
//
// Claude Code, cuando el proveedor rechaza el campo de esfuerzo, marca el
// modelo y REPITE sin el campo — una degradacion silenciosa. Sin esto, un modelo que
// no acepte el parametro tumbaria TODOS los turnos del Agente hasta que alguien
// lo notara, y el papel ha cambiado de modelo dos veces en tres semanas.
//
// El cuerpo del 400 es el REAL de Fireworks, sondeado el 2026-09-13.
describe("cuando el proveedor rechaza el esfuerzo", () => {
  const RECHAZO =
    '{"error":{"message":"Extra inputs are not permitted, field: \'reasoning_effort\', value: 100"}}';

  /** Falla la primera vez con 400 y contesta bien la segunda. */
  function clienteQueRechazaUnaVez() {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n === 1) return new Response(RECHAZO, { status: 400 });
      return new Response(chunk({ content: "ok" }, "stop"), { status: 200 });
    });
    return {
      fetchImpl,
      client: createFireworksStreamClient({
        apiKey: "k",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    };
  }

  const cuerpoDe = (fetchImpl: { mock: { calls: unknown[] } }, i: number) =>
    JSON.parse((fetchImpl.mock.calls[i] as unknown as [string, { body: string }])[1].body);

  it("REPITE sin el campo en vez de tirarle el turno al usuario", async () => {
    olvidarModelosSinEsfuerzo();
    const { client: c, fetchImpl } = clienteQueRechazaUnaVez();
    const eventos = await drain(c.stream({ ...REQUEST, operation: "agent_turn", esfuerzo: "high" }));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // La primera lo llevaba; la segunda NO.
    expect(cuerpoDe(fetchImpl, 0)).toHaveProperty("reasoning_effort");
    expect(cuerpoDe(fetchImpl, 1)).not.toHaveProperty("reasoning_effort");
    // Y el turno SOBREVIVE, que es el punto entero.
    expect(eventos.at(-1)).toMatchObject({ type: "done", stopReason: { kind: "end_turn" } });
  });

  it("marca el modelo: el turno siguiente ya no paga el 400", async () => {
    olvidarModelosSinEsfuerzo();
    const primero = clienteQueRechazaUnaVez();
    await drain(primero.client.stream({ ...REQUEST, operation: "agent_turn", esfuerzo: "high" }));

    // Un cliente nuevo, mismo modelo: no debe volver a mandar el campo.
    const fetchImpl = vi.fn(async () => new Response(chunk({ content: "ok" }, "stop"), { status: 200 }));
    const c = createFireworksStreamClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    await drain(c.stream({ ...REQUEST, operation: "agent_turn", esfuerzo: "high" }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cuerpoDe(fetchImpl, 0)).not.toHaveProperty("reasoning_effort");
  });

  // 🔴 EL BRAZO DE CONTROL. Sin el, «repite ante un 400» pasaria por bueno, y
  // eso es otra cosa muy distinta: duplicaria CADA fallo del proveedor.
  it("un 400 que NO va del esfuerzo no se reintenta", async () => {
    olvidarModelosSinEsfuerzo();
    const fetchImpl = vi.fn(async () => new Response('{"error":{"message":"Model not found"}}', { status: 404 }));
    const c = createFireworksStreamClient({ apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch });
    const eventos = await drain(c.stream({ ...REQUEST, operation: "agent_turn", esfuerzo: "high" }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(eventos.at(-1)).toMatchObject({ type: "done", stopReason: { kind: "error" } });
  });
});
